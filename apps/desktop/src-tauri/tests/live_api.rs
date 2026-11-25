//! The desktop client against a real API (dev mailbox on). Run with:
//!   ORVYN_LIVE_API=http://localhost:4100 cargo test --test live_api
//! CI starts the API exactly like the web e2e (apps/web/e2e/start-api.mjs).
use orvyn_desktop::activity::{Queue, Sample, Tracker};
use orvyn_desktop::api::{Client, DeviceInfo};
use orvyn_desktop::live::{self, LiveEvent, Notification, ServerMessage};
use orvyn_desktop::loopback::Loopback;
use orvyn_desktop::notify::Shown;
use orvyn_desktop::pkce::Pkce;
use orvyn_desktop::quickadd::{self, Hlc};
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

    // 3b. quick add from the PC: the same parser and sync as every device
    let hlc = std::sync::Mutex::new(Hlc::new("wtestpc"));
    let title = quickadd::add(&client, "Pay rent tomorrow 6pm !!!", &hlc, "2030-01-01")
        .await
        .unwrap();
    assert_eq!(title, "Pay rent");
    let made = quickadd::add(&client, "buy milk @Errands", &hlc, "2030-01-01")
        .await
        .unwrap();
    assert_eq!(made, "Buy milk");
    let pulled: Value = http
        .get(format!("{base}/sync/pull?cursor=0"))
        .bearer_auth(&owner)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let changes = pulled["changes"].as_array().unwrap();
    let task = |t: &str| {
        changes
            .iter()
            .rev()
            .find(|c| c["entity"] == "today.task" && c["data"]["title"] == t)
            .unwrap()["data"]
            .clone()
    };
    let rent = task("Pay rent");
    assert!(rent["dueAt"].is_string() && rent["dueDate"].is_null());
    assert_eq!(rent["priority"], 3);
    assert_eq!(rent["source"], "desktop");
    let milk = task("Buy milk");
    assert_eq!(milk["dueDate"], "2030-01-01", "no day named: lands in Today");
    let project = changes
        .iter()
        .find(|c| c["entity"] == "today.project" && c["data"]["name"] == "Errands")
        .unwrap();
    assert_eq!(milk["projectId"], project["entityId"]);

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

    // 4b. what a PC that was away missed: each once, then nothing
    let missed = |since: Option<String>| {
        let client = client.clone();
        async move {
            let q = since.map(|t| format!("?since={t}")).unwrap_or_default();
            let v: Value = client
                .call(reqwest::Method::GET, &format!("/notifications/missed{q}"), None)
                .await
                .unwrap();
            v
        }
    };
    let start = missed(None).await["until"].as_str().unwrap().to_owned();
    http.post(format!("{base}/notifications/test"))
        .bearer_auth(&owner)
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    let m = missed(Some(start)).await;
    let got: Vec<Notification> = serde_json::from_value(m["items"].clone()).unwrap();
    let path = std::env::temp_dir().join(format!("orvyn-live-{}.json", std::process::id()));
    let mut shown = Shown::load(&path);
    assert!(got.iter().filter(|n| shown.first(n)).count() >= 1);
    let after = missed(m["until"].as_str().map(str::to_owned)).await;
    let after: Vec<Notification> = serde_json::from_value(after["items"].clone()).unwrap();
    assert!(after.iter().all(|n| !shown.first(n)));
    shown.clear();

    // 4c. My Day: an hour in a program reaches the day, once, even when the running span is sent again and again
    let end = chrono::Utc::now().timestamp_millis();
    let (mut tracker, mut queue) = (Tracker::default(), Queue::load(&path));
    for i in 0..=60 {
        let closed = tracker.step(&Sample {
            t: end - (60 - i) * 60_000,
            app: "Code.exe".into(),
            title: "a.rs - orvyn - Visual Studio Code".into(),
            idle_ms: 0,
            locked: false,
            playing: false,
            keys: 10,
            clicks: 1,
            scrolls: 0,
        });
        assert!(closed.is_none());
        if i % 20 == 0 {
            queue.send(&client, tracker.open.as_ref()).await.unwrap();
        }
    }
    queue.add(tracker.stop().unwrap());
    queue.send(&client, None).await.unwrap();
    assert!(queue.is_empty());
    let day = |ms: i64| {
        chrono::DateTime::from_timestamp_millis(ms)
            .unwrap()
            .format("%Y-%m-%d")
            .to_string()
    };
    let (mut ms, mut keys) = (0, 0);
    let mut dates = vec![day(end - 3_600_000), day(end)];
    dates.dedup(); // the hour may cross midnight
    for date in dates {
        let d: Value = client
            .call(reqwest::Method::GET, &format!("/activity/day?date={date}&tz=UTC"), None)
            .await
            .unwrap();
        ms += d["activeMs"].as_i64().unwrap();
        keys += d["keys"].as_i64().unwrap();
        assert!(d["places"].as_array().unwrap().iter().all(|p| p["place"] == "VS Code"));
    }
    assert!((ms - 3_600_000).abs() < 1000, "{ms}");
    assert!((608..=612).contains(&keys), "{keys}");

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
