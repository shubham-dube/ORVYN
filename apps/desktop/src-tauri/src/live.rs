//! The live socket: authenticate with the first message, forward what the server says, reconnect with jittered
//! backoff, refresh once on 4401, stop when the session is gone.
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::Message;

use crate::api::{ApiError, Client};
use crate::pc::Frame;

/// What this PC sends to another device of mine, through the server (spec 0021).
pub type Outgoing = Arc<Mutex<mpsc::UnboundedReceiver<Frame>>>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub url: Option<String>,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub actions: Vec<NotifyAction>,
    /// rings until someone acts
    #[serde(default)]
    pub alarm: bool,
    /// in the inbox only (muted, quiet hours, in-app): nothing pops up
    #[serde(default)]
    pub silent: bool,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// A button on a notification (Done, Snooze 10 min, …). `open` = it opens a page instead of doing something.
#[derive(Debug, Clone, Deserialize)]
pub struct NotifyAction {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub open: Option<String>,
    #[serde(default)]
    pub reply: Option<ReplyBox>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReplyBox {
    #[serde(default)]
    pub placeholder: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "hello")]
    Hello,
    #[serde(rename = "notify.new")]
    NotifyNew { notification: Notification },
    #[serde(rename = "notify.read")]
    NotifyRead { id: String },
    #[serde(rename = "notify.dismissed")]
    NotifyDismissed { id: String },
    #[serde(rename = "pc")]
    Pc { from: String, s: String, d: String },
    #[serde(rename = "session.revoked")]
    SessionRevoked,
    #[serde(other)]
    Other,
}

#[derive(Debug)]
pub enum LiveEvent {
    Connected,
    Disconnected,
    Message(ServerMessage),
    SignedOut,
}

pub fn ws_url(api_url: &str) -> String {
    format!("{}/ws", api_url.replacen("http", "ws", 1))
}

/// Runs until the session ends (or the receiver is dropped).
pub async fn run(client: Arc<Client>, tx: mpsc::Sender<LiveEvent>, out: Outgoing) {
    let mut attempt: u32 = 0;
    loop {
        let token = match client.access_token().await {
            Some(t) => t,
            None => match client.refresh(None).await {
                Ok(()) => continue,
                Err(ApiError::SignedOut) => {
                    let _ = tx.send(LiveEvent::SignedOut).await;
                    return;
                }
                Err(_) => {
                    backoff(&mut attempt).await;
                    continue;
                }
            },
        };
        let close_code = session(&client, &token, &tx, &out, &mut attempt).await;
        if tx.is_closed() {
            return;
        }
        let _ = tx.send(LiveEvent::Disconnected).await;
        if close_code == Some(4401) {
            if let Err(ApiError::SignedOut) = client.refresh(Some(token)).await {
                let _ = tx.send(LiveEvent::SignedOut).await;
                return;
            }
        }
        backoff(&mut attempt).await;
    }
}

async fn session(
    client: &Client,
    token: &str,
    tx: &mpsc::Sender<LiveEvent>,
    out: &Outgoing,
    attempt: &mut u32,
) -> Option<u16> {
    let Ok((ws, _)) = tokio_tungstenite::connect_async(ws_url(&client.api_url)).await else {
        return None;
    };
    let (mut write, mut read) = ws.split();
    if write
        .send(Message::Text(
            serde_json::json!({ "type": "auth", "token": token }).to_string().into(),
        ))
        .await
        .is_err()
    {
        return None;
    }
    let mut out = out.lock().await;
    while out.try_recv().is_ok() {} // meant for a connection that is gone: both ends start again
    let mut live = false;
    loop {
        let msg = tokio::select! {
            msg = read.next() => match msg { Some(m) => m, None => return None },
            Some(f) = out.recv(), if live => {
                let Ok(text) = serde_json::to_string(&f) else { continue };
                if write.send(Message::Text(text.into())).await.is_err() {
                    return None;
                }
                continue;
            }
        };
        match msg {
            Ok(Message::Text(t)) => {
                let Ok(m) = serde_json::from_str::<ServerMessage>(&t) else {
                    continue;
                };
                if matches!(m, ServerMessage::Hello) {
                    *attempt = 0;
                    live = true;
                    let _ = tx.send(LiveEvent::Connected).await;
                }
                if tx.send(LiveEvent::Message(m)).await.is_err() {
                    return None;
                }
            }
            Ok(Message::Close(frame)) => return frame.map(|f| u16::from(f.code)),
            Ok(_) => {}
            Err(_) => return None,
        }
    }
}

async fn backoff(attempt: &mut u32) {
    let base = 1000u64.saturating_mul(1 << (*attempt).min(5)).min(30_000);
    *attempt += 1;
    let jitter = rand::thread_rng().gen_range(0.7..1.3);
    tokio::time::sleep(Duration::from_millis((base as f64 * jitter) as u64)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_server_messages_and_ignores_unknown_ones() {
        let m: ServerMessage = serde_json::from_str(
            r#"{"type":"notify.new","notification":{"id":"n1","module":"core","kind":"test","title":"Hi","body":"b","url":null,"actions":[],"priority":"normal","createdAt":"x","readAt":null,"dismissedAt":null}}"#,
        )
        .unwrap();
        assert!(matches!(m, ServerMessage::NotifyNew { ref notification } if notification.title == "Hi"));
        let r: ServerMessage = serde_json::from_str(
            r#"{"type":"notify.new","notification":{"id":"n2","title":"Pay rent","body":"In 10 min","url":"/today","priority":"normal","actions":[{"id":"done","label":"Done"},{"id":"snooze_10m","label":"Snooze 10 min"},{"id":"open","label":"Open","open":"/today"}]}}"#,
        )
        .unwrap();
        let ServerMessage::NotifyNew { notification } = r else {
            panic!()
        };
        assert_eq!(
            notification.actions.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(),
            ["done", "snooze_10m", "open"]
        );
        let m: ServerMessage = serde_json::from_str(r#"{"type":"entitlements.changed","entitlements":[]}"#).unwrap();
        assert!(matches!(m, ServerMessage::Other));
        assert_eq!(ws_url("https://api.orvyn.dubey.app"), "wss://api.orvyn.dubey.app/ws");
        assert_eq!(ws_url("http://localhost:4000"), "ws://localhost:4000/ws");
    }
}
