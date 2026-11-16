//! The loopback redirect (RFC 8252 §7.3): a one-shot listener on 127.0.0.1 that receives `?code=…&state=…` from the
//! browser after the person approves, answers with a friendly page, and hands the code back — only if the state
//! matches what we sent.
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum LoopbackError {
    #[error("timed out waiting for approval")]
    Timeout,
    #[error("the approval did not match this request")]
    StateMismatch,
    #[error("no code in the callback")]
    NoCode,
    #[error("network: {0}")]
    Io(String),
}

pub struct Loopback {
    listener: TcpListener,
    pub redirect_uri: String,
}

impl Loopback {
    pub async fn bind() -> Result<Self, LoopbackError> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| LoopbackError::Io(e.to_string()))?;
        let port = listener
            .local_addr()
            .map_err(|e| LoopbackError::Io(e.to_string()))?
            .port();
        Ok(Self {
            listener,
            redirect_uri: format!("http://127.0.0.1:{port}/callback"),
        })
    }

    /// Waits for the browser's redirect. Requests to other paths (favicon…) get a 404 and we keep waiting.
    pub async fn wait_for_code(self, expected_state: &str, timeout: Duration) -> Result<String, LoopbackError> {
        tokio::time::timeout(timeout, async {
            loop {
                let (mut sock, _) = self.listener.accept().await.map_err(|e| LoopbackError::Io(e.to_string()))?;
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).await.map_err(|e| LoopbackError::Io(e.to_string()))?;
                let request = String::from_utf8_lossy(&buf[..n]);
                let target = request.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("");
                if !target.starts_with("/callback") {
                    let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                    continue;
                }
                let result = parse_callback(target, expected_state);
                let page = page(result.is_ok());
                let _ = sock
                    .write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{page}",
                            page.len()
                        )
                        .as_bytes(),
                    )
                    .await;
                return result;
            }
        })
        .await
        .map_err(|_| LoopbackError::Timeout)?
    }
}

pub fn parse_callback(target: &str, expected_state: &str) -> Result<String, LoopbackError> {
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| LoopbackError::NoCode)?;
    let get = |k: &str| {
        url.query_pairs()
            .find(|(name, _)| name == k)
            .map(|(_, v)| v.into_owned())
    };
    if get("state").as_deref() != Some(expected_state) {
        return Err(LoopbackError::StateMismatch);
    }
    get("code").filter(|c| !c.is_empty()).ok_or(LoopbackError::NoCode)
}

fn page(ok: bool) -> String {
    let (title, line) = if ok {
        (
            "ORVYN is connected",
            "You can close this tab — ORVYN lives in your tray now.",
        )
    } else {
        ("That didn’t work", "Start again from the ORVYN tray icon.")
    };
    format!(
        "<!doctype html><meta name=viewport content='width=device-width'><title>{title}</title>\
<body style=\"margin:0;min-height:100vh;display:grid;place-items:center;font-family:'Segoe UI Variable','Segoe UI',system-ui,sans-serif;\
color:#0f1b2a;background:radial-gradient(60% 50% at 10% 0%,#9ad0ff,transparent 70%),radial-gradient(60% 50% at 100% 40%,#a6f0d8,transparent 70%),#eaf3fb\">\
<div style=\"padding:32px 36px;border-radius:28px;background:rgba(255,255,255,.66);border:1px solid rgba(255,255,255,.8);\
box-shadow:0 24px 60px rgba(30,41,90,.18);backdrop-filter:blur(30px);text-align:center;max-width:360px\">\
<div style=\"width:56px;height:56px;margin:0 auto 16px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#d6e6fe,#3b82f6 45%,#06b6d4);box-shadow:0 0 30px rgba(59,130,246,.5)\"></div>\
<h1 style=\"margin:0 0 6px;font-size:22px;letter-spacing:-.02em\">{title}</h1><p style=\"margin:0;color:#475569\">{line}</p></div></body>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_our_state() {
        assert_eq!(parse_callback("/callback?code=abc&state=s1", "s1"), Ok("abc".into()));
        assert_eq!(
            parse_callback("/callback?code=abc&state=evil", "s1"),
            Err(LoopbackError::StateMismatch)
        );
        assert_eq!(parse_callback("/callback?state=s1", "s1"), Err(LoopbackError::NoCode));
        assert_eq!(parse_callback("/callback?code=a%2Bb&state=s1", "s1"), Ok("a+b".into()));
    }

    #[tokio::test]
    async fn receives_the_browser_redirect_and_ignores_other_requests() {
        let lb = Loopback::bind().await.unwrap();
        let uri = lb.redirect_uri.clone();
        assert!(uri.starts_with("http://127.0.0.1:"));
        let waiter = tokio::spawn(async move { lb.wait_for_code("st", Duration::from_secs(5)).await });
        let http = reqwest::Client::new();
        let base = uri.trim_end_matches("/callback");
        assert_eq!(
            http.get(format!("{base}/favicon.ico")).send().await.unwrap().status(),
            404
        );
        let page = http
            .get(format!("{uri}?code=the-code&state=st"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(page.contains("ORVYN is connected"));
        assert_eq!(waiter.await.unwrap(), Ok("the-code".into()));
    }

    #[tokio::test]
    async fn gives_up_after_the_timeout() {
        let lb = Loopback::bind().await.unwrap();
        assert_eq!(
            lb.wait_for_code("st", Duration::from_millis(50)).await,
            Err(LoopbackError::Timeout)
        );
    }
}
