//! The desktop's API client: access token in memory, refresh token in the OS keychain, one refresh at a time,
//! one replay after a 401. A refused refresh ends the session on this computer.
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};

use crate::store::TokenStore;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("offline")]
    Offline,
    #[error("signed out")]
    SignedOut,
    #[error("{status}: {code}")]
    Http { status: u16, code: String },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub name: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    access_token: String,
    refresh_token: Option<String>,
    device_id: String,
    user: Me,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub name: String,
    pub platform: String,
    pub app_version: String,
}

pub struct Client {
    pub api_url: String,
    http: reqwest::Client,
    store: Arc<dyn TokenStore>,
    access: RwLock<Option<String>>,
    refreshing: Mutex<()>,
    pub me: RwLock<Option<Me>>,
    pub device_id: RwLock<Option<String>>,
}

impl Client {
    pub fn new(api_url: &str, store: Arc<dyn TokenStore>) -> Self {
        Self {
            api_url: api_url.trim_end_matches('/').to_owned(),
            http: reqwest::Client::builder()
                .user_agent(concat!("ORVYN-Desktop/", env!("CARGO_PKG_VERSION")))
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .expect("http client"),
            store,
            access: RwLock::new(None),
            refreshing: Mutex::new(()),
            me: RwLock::new(None),
            device_id: RwLock::new(None),
        }
    }

    pub fn has_session(&self) -> bool {
        self.store.get().is_some()
    }

    pub async fn access_token(&self) -> Option<String> {
        self.access.read().await.clone()
    }

    async fn adopt(&self, s: SessionResponse) -> Me {
        *self.access.write().await = Some(s.access_token);
        if let Some(r) = &s.refresh_token {
            self.store.set(Some(r));
        }
        *self.device_id.write().await = Some(s.device_id);
        *self.me.write().await = Some(s.user.clone());
        s.user
    }

    pub async fn redeem(&self, code: &str, verifier: &str, device: &DeviceInfo) -> Result<Me, ApiError> {
        let r = self
            .http
            .post(format!("{}/auth/link/redeem", self.api_url))
            .json(&serde_json::json!({ "code": code, "verifier": verifier, "device": device }))
            .send()
            .await
            .map_err(|_| ApiError::Offline)?;
        if !r.status().is_success() {
            return Err(http_error(r).await);
        }
        let s: SessionResponse = r.json().await.map_err(|_| ApiError::Offline)?;
        Ok(self.adopt(s).await)
    }

    /// Single flight. `stale` is the token the caller saw rejected: if another task already replaced it while we
    /// waited for the lock, we reuse theirs. `None` always asks the server.
    pub async fn refresh(&self, stale: Option<String>) -> Result<(), ApiError> {
        let _guard = self.refreshing.lock().await;
        let current = self.access.read().await.clone();
        if stale.is_some() && current.is_some() && current != stale {
            return Ok(());
        }
        let Some(token) = self.store.get() else {
            return Err(ApiError::SignedOut);
        };
        let r = self
            .http
            .post(format!("{}/auth/refresh", self.api_url))
            .json(&serde_json::json!({ "refreshToken": token }))
            .send()
            .await
            .map_err(|_| ApiError::Offline)?;
        match r.status().as_u16() {
            200 => {
                let s: SessionResponse = r.json().await.map_err(|_| ApiError::Offline)?;
                self.adopt(s).await;
                Ok(())
            }
            401 | 403 => {
                self.forget().await;
                Err(ApiError::SignedOut)
            }
            _ => Err(http_error(r).await),
        }
    }

    pub async fn call<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<T, ApiError> {
        if self.access.read().await.is_none() {
            self.refresh(None).await?;
        }
        let mut attempt = 0;
        loop {
            let token = self.access.read().await.clone();
            // (a 401 below refreshes with `token` as the stale one, so concurrent 401s refresh once)
            let mut req = self.http.request(method.clone(), format!("{}{path}", self.api_url));
            if let Some(t) = &token {
                req = req.bearer_auth(t);
            }
            if let Some(b) = &body {
                req = req.json(b);
            }
            let r = req.send().await.map_err(|_| ApiError::Offline)?;
            if r.status().as_u16() == 401 && attempt == 0 {
                attempt += 1;
                self.refresh(token).await?;
                continue;
            }
            if !r.status().is_success() {
                return Err(http_error(r).await);
            }
            let text = r.text().await.map_err(|_| ApiError::Offline)?;
            return serde_json::from_str(if text.is_empty() { "null" } else { &text }).map_err(|_| ApiError::Offline);
        }
    }

    /// A file's bytes for Drop; its id.
    pub async fn upload(&self, bytes: Vec<u8>, mime: &str, name: &str) -> Result<String, ApiError> {
        if self.access.read().await.is_none() {
            self.refresh(None).await?;
        }
        let name: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect();
        for attempt in 0..2 {
            let token = self.access.read().await.clone();
            let r = self
                .http
                .post(format!("{}/files", self.api_url))
                .bearer_auth(token.as_deref().unwrap_or_default())
                .header("content-type", mime)
                .header("x-file-name", &name)
                .header("x-file-purpose", "drop")
                .body(bytes.clone())
                .send()
                .await
                .map_err(|_| ApiError::Offline)?;
            if r.status().as_u16() == 401 && attempt == 0 {
                self.refresh(token).await?;
                continue;
            }
            if !r.status().is_success() {
                return Err(http_error(r).await);
            }
            let v: Value = r.json().await.map_err(|_| ApiError::Offline)?;
            return v["id"].as_str().map(str::to_owned).ok_or(ApiError::Offline);
        }
        Err(ApiError::SignedOut)
    }

    pub async fn sign_out(&self) {
        let _ = self
            .call::<Value>(reqwest::Method::POST, "/auth/sign-out", Some(serde_json::json!({})))
            .await;
        self.forget().await;
    }

    pub async fn forget(&self) {
        *self.access.write().await = None;
        *self.me.write().await = None;
        *self.device_id.write().await = None;
        self.store.set(None);
    }
}

async fn http_error(r: reqwest::Response) -> ApiError {
    let status = r.status().as_u16();
    let code = r
        .json::<Value>()
        .await
        .ok()
        .and_then(|v| v["error"]["code"].as_str().map(str::to_owned))
        .unwrap_or_else(|| format!("http_{status}"));
    ApiError::Http { status, code }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::MemoryStore;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A tiny HTTP server: /auth/refresh hands out "fresh"; /me accepts only "fresh".
    async fn fake_api(refreshes: Arc<AtomicUsize>, refresh_status: u16) -> String {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = l.accept().await.unwrap();
                let refreshes = refreshes.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = s.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let (status, body) = if req.starts_with("POST /auth/refresh") {
                        refreshes.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                        if refresh_status == 200 {
                            (200, r#"{"accessToken":"fresh","expiresIn":900,"refreshToken":"r2","deviceId":"d","user":{"id":"u","email":"a@example.test","name":"","role":"owner"}}"#.to_owned())
                        } else {
                            (refresh_status, r#"{"error":{"code":"session_revoked"}}"#.to_owned())
                        }
                    } else if req.to_lowercase().contains("authorization: bearer fresh") {
                        (200, r#"{"ok":true}"#.to_owned())
                    } else {
                        (401, r#"{"error":{"code":"token_expired"}}"#.to_owned())
                    };
                    let resp = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    let _ = s.write_all(resp.as_bytes()).await;
                });
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn concurrent_401s_refresh_once_then_replay() {
        let refreshes = Arc::new(AtomicUsize::new(0));
        let base = fake_api(refreshes.clone(), 200).await;
        let store = Arc::new(MemoryStore::default());
        store.set(Some("r1"));
        let c = Arc::new(Client::new(&base, store.clone()));
        *c.access.write().await = Some("expired".into());
        let calls = (0..5).map(|_| {
            let c = c.clone();
            tokio::spawn(async move { c.call::<Value>(reqwest::Method::GET, "/me", None).await })
        });
        for r in futures_util::future::join_all(calls).await {
            assert_eq!(r.unwrap().unwrap()["ok"], true);
        }
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        assert_eq!(store.get().as_deref(), Some("r2"), "refresh tokens rotate");
    }

    #[tokio::test]
    async fn a_refused_refresh_forgets_the_session() {
        let base = fake_api(Arc::new(AtomicUsize::new(0)), 401).await;
        let store = Arc::new(MemoryStore::default());
        store.set(Some("stolen"));
        let c = Client::new(&base, store.clone());
        *c.access.write().await = Some("still-in-memory".into());
        assert!(matches!(c.refresh(None).await, Err(ApiError::SignedOut)));
        assert!(store.get().is_none());
        assert!(c.access_token().await.is_none());
    }
}
