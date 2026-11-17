//! The tray companion: connect through the web app, then stay quietly in the tray delivering notifications.
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{mpsc, Mutex};

use crate::api::{Client, DeviceInfo};
use crate::live::{self, LiveEvent, ServerMessage};
use crate::loopback::Loopback;
use crate::notify::{self, Choice};
use crate::pkce::Pkce;
use crate::quickadd::{self, Hlc, Prefs, SHORTCUTS};
use crate::store::{KeyringStore, MemoryStore, TokenStore};

pub const API_URL: &str = match option_env!("ORVYN_API_URL") {
    Some(u) => u,
    None => "https://api.orvyn.dubey.app",
};
pub const WEB_URL: &str = match option_env!("ORVYN_WEB_URL") {
    Some(u) => u,
    None => "https://orvyn.dubey.app",
};

struct State {
    client: Arc<Client>,
    live_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    connecting: AtomicBool,
    live: AtomicBool,
    /// unix seconds until which toasts are held back ("pause for an hour")
    paused_until: AtomicI64,
    items: Items,
    hlc: std::sync::Mutex<Hlc>,
    prefs_path: std::path::PathBuf,
}

struct Items {
    status: MenuItem<Wry>,
    connect: MenuItem<Wry>,
    test: MenuItem<Wry>,
    pause: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
    /// one per suggested shortcut, then "Off"
    shortcuts: Vec<CheckMenuItem<Wry>>,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn device() -> DeviceInfo {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "PC".into());
    let platform = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    DeviceInfo {
        name: format!("ORVYN on {host}"),
        platform: platform.into(),
        app_version: env!("CARGO_PKG_VERSION").into(),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // a second launch just opens ORVYN
            let _ = app.opener().open_url(WEB_URL, None::<&str>);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        show_quick_add(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![quick_add, quick_add_hide])
        .setup(|app| {
            let store: Arc<dyn TokenStore> = match KeyringStore::new("default") {
                Ok(s) => Arc::new(s),
                Err(_) => Arc::new(MemoryStore::default()), // no keychain: works until quit, never written to disk
            };
            let h = app.handle();
            let prefs_path = app
                .path()
                .app_config_dir()
                .map(|d| d.join("prefs.json"))
                .unwrap_or_default();
            let prefs = Prefs::load(&prefs_path);
            let current = prefs.shortcut().map(str::to_owned);
            let mut shortcuts = vec![];
            for (i, sc) in SHORTCUTS.iter().enumerate() {
                shortcuts.push(CheckMenuItem::with_id(
                    h,
                    format!("sc:{i}"),
                    sc,
                    true,
                    current.as_deref() == Some(*sc),
                    None::<&str>,
                )?);
            }
            shortcuts.push(CheckMenuItem::with_id(
                h,
                "sc:off",
                "Off",
                true,
                current.is_none(),
                None::<&str>,
            )?);
            let items = Items {
                status: MenuItem::with_id(h, "status", "Not connected", false, None::<&str>)?,
                connect: MenuItem::with_id(h, "connect", "Connect to ORVYN…", true, None::<&str>)?,
                test: MenuItem::with_id(h, "test", "Send a test notification", false, None::<&str>)?,
                pause: CheckMenuItem::with_id(h, "pause", "Pause notifications for 1 hour", true, false, None::<&str>)?,
                autostart: CheckMenuItem::with_id(
                    h,
                    "autostart",
                    "Start with Windows",
                    true,
                    app.autolaunch().is_enabled().unwrap_or(false),
                    None::<&str>,
                )?,
                shortcuts,
            };
            let open = MenuItem::with_id(h, "open", "Open ORVYN", true, None::<&str>)?;
            let add = MenuItem::with_id(h, "add", "Add to Today…", true, None::<&str>)?;
            let shortcut_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = items
                .shortcuts
                .iter()
                .map(|i| i as &dyn tauri::menu::IsMenuItem<Wry>)
                .collect();
            let shortcut_menu = Submenu::with_items(h, "Quick add shortcut", true, &shortcut_refs)?;
            let quit = MenuItem::with_id(h, "quit", "Quit", true, None::<&str>)?;
            let sep = || PredefinedMenuItem::separator(h);
            let menu = Menu::with_items(
                h,
                &[
                    &items.status,
                    &sep()?,
                    &open,
                    &add,
                    &shortcut_menu,
                    &items.connect,
                    &items.test,
                    &sep()?,
                    &items.pause,
                    &items.autostart,
                    &sep()?,
                    &quit,
                ],
            )?;
            TrayIconBuilder::with_id("orvyn")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("ORVYN")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, e| on_menu(app.clone(), e.id().as_ref()))
                .build(app)?;

            let state = Arc::new(State {
                client: Arc::new(Client::new(API_URL, store)),
                live_task: Mutex::new(None),
                connecting: AtomicBool::new(false),
                live: AtomicBool::new(false),
                paused_until: AtomicI64::new(0),
                items,
                hlc: std::sync::Mutex::new(Hlc::new(&format!("win{}", std::process::id()))),
                prefs_path,
            });
            app.manage(state.clone());

            // the quick-add box: made once, hidden until the shortcut (or the tray) asks for it
            let qa = WebviewWindowBuilder::new(app, "quick-add", WebviewUrl::App("quick-add.html".into()))
                .title("Add to Today")
                .inner_size(560.0, 132.0)
                .resizable(false)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(false)
                .center()
                .build()?;
            let qa2 = qa.clone();
            qa.on_window_event(move |e| {
                if let WindowEvent::Focused(false) = e {
                    let _ = qa2.hide(); // clicking away closes it, like a launcher
                }
            });
            if let Some(sc) = current {
                if let Err(e) = app.global_shortcut().register(sc.as_str()) {
                    eprintln!("quick add shortcut {sc} unavailable: {e}"); // taken by another app: pick another
                }
            }
            if state.client.has_session() {
                start_live(app.handle().clone(), state);
            } else {
                refresh_menu(&state);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("ORVYN failed to start")
        .run(|_app, event| {
            // no windows: keep running in the tray when the (non-existent) last window closes
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = event {
                api.prevent_exit();
            }
        });
}

fn state(app: &AppHandle) -> Arc<State> {
    app.state::<Arc<State>>().inner().clone()
}

fn on_menu(app: AppHandle, id: &str) {
    let s = state(&app);
    match id {
        "open" => {
            let _ = app.opener().open_url(WEB_URL, None::<&str>);
        }
        "connect" if s.client.has_session() => {
            tauri::async_runtime::spawn(async move {
                stop_live(&s).await;
                s.client.sign_out().await;
                refresh_menu(&s);
            });
        }
        "connect" => {
            tauri::async_runtime::spawn(connect(app.clone(), s));
        }
        "test" => {
            tauri::async_runtime::spawn(async move {
                let _ = s
                    .client
                    .call::<serde_json::Value>(
                        reqwest::Method::POST,
                        "/notifications/test",
                        Some(serde_json::json!({})),
                    )
                    .await;
            });
        }
        "pause" => {
            let until = if s.paused_until.load(Ordering::Relaxed) > now() {
                0
            } else {
                now() + 3600
            };
            s.paused_until.store(until, Ordering::Relaxed);
            let _ = s.items.pause.set_checked(until > 0);
        }
        "autostart" => {
            let al = app.autolaunch();
            let on = !al.is_enabled().unwrap_or(false);
            let _ = if on { al.enable() } else { al.disable() };
            let _ = s.items.autostart.set_checked(al.is_enabled().unwrap_or(false));
        }
        "quit" => app.exit(0),
        "add" => show_quick_add(&app),
        id if id.starts_with("sc:") => set_shortcut(&app, &s, id),
        _ => {}
    }
}

fn show_quick_add(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quick-add") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.emit("quick-add:open", ());
    }
}

/// The person picks the shortcut (or Off) from the tray; it's remembered for next time.
fn set_shortcut(app: &AppHandle, s: &State, id: &str) {
    let choice = id
        .strip_prefix("sc:")
        .and_then(|i| i.parse::<usize>().ok())
        .and_then(|i| SHORTCUTS.get(i));
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut ok = true;
    if let Some(sc) = choice {
        ok = gs.register(*sc).is_ok();
    }
    let chosen = if ok { choice.map(|c| c.to_string()) } else { None };
    let _ = (Prefs {
        quick_add_shortcut: Some(chosen.clone().unwrap_or_default()),
    })
    .save(&s.prefs_path);
    for (i, item) in s.items.shortcuts.iter().enumerate() {
        let on = match &chosen {
            Some(c) => SHORTCUTS.get(i) == Some(&c.as_str()),
            None => i == SHORTCUTS.len(),
        };
        let _ = item.set_checked(on);
    }
    if !ok {
        let _ = s
            .items
            .status
            .set_text("That shortcut is taken by another app — pick another");
    }
}

/// From the quick-add box: parse and save; the box shows the answer.
#[tauri::command]
async fn quick_add(app: AppHandle, text: String) -> Result<String, String> {
    let s = state(&app);
    let text = text.trim().to_owned();
    if text.is_empty() {
        return Err("Type something first".into());
    }
    if !s.client.has_session() {
        return Err("Connect ORVYN first (tray menu)".into());
    }
    quickadd::add(&s.client, &text, &s.hlc, &quickadd::local_day())
        .await
        .map_err(|e| match e {
            crate::api::ApiError::Offline => "Couldn’t reach ORVYN — check your connection".to_owned(),
            crate::api::ApiError::SignedOut => "Connect ORVYN again (tray menu)".to_owned(),
            crate::api::ApiError::Http { code, .. } if code == "forbidden" || code.contains("not_enabled") => {
                "Today isn’t switched on for you".to_owned()
            }
            _ => "That didn’t save — try again".to_owned(),
        })
}

#[tauri::command]
fn quick_add_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("quick-add") {
        let _ = w.hide();
    }
}

/// System browser → /connect → approve → loopback receives the code → redeem with our verifier.
async fn connect(app: AppHandle, s: Arc<State>) {
    if s.connecting.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = s.items.status.set_text("Waiting for approval in your browser…");
    let result: Result<(), String> = async {
        let lb = Loopback::bind().await.map_err(|e| e.to_string())?;
        let p = Pkce::new();
        let mut url = url::Url::parse(WEB_URL)
            .map_err(|e| e.to_string())?
            .join("/connect")
            .map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("redirect_uri", &lb.redirect_uri)
            .append_pair("code_challenge", &p.challenge)
            .append_pair("state", &p.state);
        app.opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|e| e.to_string())?;
        let code = lb
            .wait_for_code(&p.state, Duration::from_secs(300))
            .await
            .map_err(|e| e.to_string())?;
        s.client
            .redeem(&code, &p.verifier, &device())
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    .await;
    s.connecting.store(false, Ordering::SeqCst);
    match result {
        Ok(()) => start_live(app, s),
        Err(_) => {
            refresh_menu(&s);
            let _ = s.items.status.set_text("Couldn’t connect — try again");
        }
    }
}

fn start_live(app: AppHandle, s: Arc<State>) {
    refresh_menu(&s);
    let (tx, mut rx) = mpsc::channel::<LiveEvent>(64);
    let client = s.client.clone();
    let st = s.clone();
    tauri::async_runtime::spawn(async move {
        let task = tauri::async_runtime::spawn(live::run(client, tx));
        *st.live_task.lock().await = Some(task);
        while let Some(ev) = rx.recv().await {
            match ev {
                LiveEvent::Connected => st.live.store(true, Ordering::Relaxed),
                LiveEvent::Disconnected => st.live.store(false, Ordering::Relaxed),
                LiveEvent::SignedOut => {
                    st.live.store(false, Ordering::Relaxed);
                    st.client.forget().await;
                }
                LiveEvent::Message(ServerMessage::SessionRevoked) => {
                    stop_live(&st).await;
                    st.client.forget().await;
                }
                LiveEvent::Message(ServerMessage::NotifyNew { notification }) => {
                    if st.paused_until.load(Ordering::Relaxed) <= now() || notification.priority == "urgent" {
                        let (app2, st2, n) = (app.clone(), st.clone(), notification.clone());
                        notify::show(&app, &notification, move |choice| {
                            let (app3, st3, n3) = (app2.clone(), st2.clone(), n.clone());
                            tauri::async_runtime::spawn(async move {
                                match choice {
                                    Choice::Open => {
                                        let to = url::Url::parse(WEB_URL)
                                            .and_then(|u| u.join(n3.url.as_deref().unwrap_or("/")));
                                        if let Ok(to) = to {
                                            let _ = app3.opener().open_url(to.as_str(), None::<&str>);
                                        }
                                        let _ = st3
                                            .client
                                            .call::<serde_json::Value>(
                                                reqwest::Method::POST,
                                                &format!("/notifications/{}/read", n3.id),
                                                Some(serde_json::json!({})),
                                            )
                                            .await;
                                    }
                                    Choice::Dismiss => {
                                        let _ = st3
                                            .client
                                            .call::<serde_json::Value>(
                                                reqwest::Method::POST,
                                                &format!("/notifications/{}/dismiss", n3.id),
                                                Some(serde_json::json!({})),
                                            )
                                            .await;
                                    }
                                    Choice::Action(a) => {
                                        let _ = st3
                                            .client
                                            .call::<serde_json::Value>(
                                                reqwest::Method::POST,
                                                &format!("/notifications/{}/actions/{}", n3.id, a),
                                                Some(serde_json::json!({})),
                                            )
                                            .await;
                                    }
                                }
                            });
                        });
                    }
                }
                LiveEvent::Message(_) => {}
            }
            refresh_menu(&st);
        }
    });
}

async fn stop_live(s: &State) {
    if let Some(t) = s.live_task.lock().await.take() {
        t.abort();
    }
    s.live.store(false, Ordering::Relaxed);
}

fn refresh_menu(s: &State) {
    let connected = s.client.has_session();
    let me = s.client.me.try_read().ok().and_then(|m| m.clone());
    let status = match (connected, s.live.load(Ordering::Relaxed)) {
        (false, _) => "Not connected".to_owned(),
        (true, true) => format!("● Live — {}", me.map(|m| m.email).unwrap_or_default()),
        (true, false) => "○ Reconnecting…".to_owned(),
    };
    let _ = s.items.status.set_text(status);
    let _ = s
        .items
        .connect
        .set_text(if connected { "Disconnect" } else { "Connect to ORVYN…" });
    let _ = s.items.test.set_enabled(connected);
}
