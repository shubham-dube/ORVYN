//! The desktop client against a real API (dev mailbox on). Run with:
//!   ORVYN_LIVE_API=http://localhost:4100 cargo test --test live_api
//! CI starts the API exactly like the web e2e (apps/web/e2e/start-api.mjs).
use orvyn_desktop::api::{Client, DeviceInfo};
use orvyn_desktop::live::{self, LiveEvent, ServerMessage};
use orvyn_desktop::loopback::Loopback;
use orvyn_desktop::pkce::Pkce;
use orvyn_desktop::store::{MemoryStore, TokenStore};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

fn api() -> Option<String> {
    std::env::var("ORVYN_LIVE_API").ok()
}

/// The owner signs in on "another device" the normal way (email code via the dev mailbox).
async fn owner_token(http: &reqwest::Client, base: &str) -> String {
    let email = "owner@example.test";
    http.post(format!("{base}/auth/email/start"))
        .json(&json!({ "email": email }))
        .send()
        .await
        .unwrap();
    let mail: Value = http
        .get(format!("{base}/dev/mailbox?email={email}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let code: String = mail["subject"]
        .as_str()
        .unwrap()
        .chars()
        .filter(char::is_ascii_digit)
        .take(6)
        .collect();
    let s: Value = http
        .post(format!("{base}/auth/email/verify"))
        .json(&json!({ "email": email, "code": code, "device": { "name": "Phone", "platform": "android", "appVersion": "1" } }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    s["accessToken"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn connect_through_the_web_app_then_live_notifications_then_remote_sign_out() {
    let Some(base) = api() else {
        eprintln!("skipped: set ORVYN_LIVE_API");
        return;
    };
    let http = reqwest::Client::new();
    let owner = owner_token(&http, &base).await;

    // 1. the app opens /connect; the person approves on the web app (simulated: the web app calls link/start)
    let lb = Loopback::bind().await.unwrap();
    let p = Pkce::new();
    let approved: Value = http
        .post(format!("{base}/auth/link/start"))
        .bearer_auth(&owner)
        .json(&json!({ "challenge": p.challenge, "redirectUri": lb.redirect_uri, "state": p.state }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(approved["client"], "desktop");
    // 2. the browser follows the redirect to our loopback listener
    let redirect = approved["redirect"].as_str().unwrap().to_owned();
    let state = p.state.clone();
    let waiting = tokio::spawn(async move { lb.wait_for_code(&state, Duration::from_secs(10)).await });
    let page = http.get(&redirect).send().await.unwrap().text().await.unwrap();
    assert!(page.contains("ORVYN is connected"));
    let code = waiting.await.unwrap().unwrap();

    // 3. redeem with our verifier → our own device session, refresh token in the store
    let store = Arc::new(MemoryStore::default());
    let client = Arc::new(Client::new(&base, store.clone()));
    let device = DeviceInfo {
        name: "ORVYN on TEST-PC".into(),
        platform: "windows".into(),
        app_version: "0.1.0".into(),
    };
    let me = client.redeem(&code, &p.verifier, &device).await.unwrap();
    assert_eq!(me.email, "owner@example.test");
    assert!(store.get().is_some());
    let devices: Vec<Value> = client.call(reqwest::Method::GET, "/me/devices", None).await.unwrap();
    assert!(devices
        .iter()
        .any(|d| d["name"] == "ORVYN on TEST-PC" && d["platform"] == "windows" && d["current"] == true));

    // the same code can't be used twice
    let again = Client::new(&base, Arc::new(MemoryStore::default()));
    assert!(again.redeem(&code, &p.verifier, &device).await.is_err());

    // 4. live: a notification sent from the phone arrives on the PC
    let (tx, mut rx) = tokio::sync::mpsc::channel(64);
    let task = tokio::spawn(live::run(client.clone(), tx));
    loop {
        if matches!(next(&mut rx).await, LiveEvent::Connected) {
            break;
        }
    }
    http.post(format!("{base}/notifications/test"))
        .bearer_auth(&owner)
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    loop {
        if let LiveEvent::Message(ServerMessage::NotifyNew { notification }) = next(&mut rx).await {
            assert_eq!(notification.title, "Hello from ORVYN");
            break;
        }
    }

    // 5. signing this PC out from the phone cuts it off live and it can't refresh
    let id = client.device_id.read().await.clone().unwrap();
    http.delete(format!("{base}/me/devices/{id}"))
        .bearer_auth(&owner)
        .send()
        .await
        .unwrap();
    loop {
        match next(&mut rx).await {
            LiveEvent::Message(ServerMessage::SessionRevoked) | LiveEvent::SignedOut => break,
            _ => {}
        }
    }
    assert!(client.refresh(None).await.is_err());
    task.abort();
}

async fn next(rx: &mut tokio::sync::mpsc::Receiver<LiveEvent>) -> LiveEvent {
    tokio::time::timeout(Duration::from_secs(10), rx.recv())
        .await
        .expect("event in time")
        .expect("channel open")
}
