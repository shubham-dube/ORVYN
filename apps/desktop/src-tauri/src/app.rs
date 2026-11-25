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

use crate::activity::{Queue, Sample, Tracker};
use crate::api::{ApiError, Client, DeviceInfo};
use crate::live::{self, LiveEvent, Notification, ServerMessage};
use crate::loopback::Loopback;
use crate::notify::{self, Choice, Shown};
use crate::pc::pairs::{KeyringKeys, Pairs};
use crate::pc::{Event as PcEvent, Remote};
use crate::pkce::Pkce;
use crate::quickadd::{self, Hlc, Prefs, SHORTCUTS};
use crate::store::{KeyringStore, MemoryStore, TokenStore};
use crate::watch::Watcher;

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
    shown: std::sync::Mutex<Shown>,
    tracker: std::sync::Mutex<Tracker>,
    queue: Mutex<Queue>,
    /// looking at the PC while this is here
    watcher: std::sync::Mutex<Option<Watcher>>,
    samples: mpsc::Sender<Sample>,
    /// this PC from my other devices
    remote: Arc<Remote>,
    outgoing: live::Outgoing,
}

struct Items {
    status: MenuItem<Wry>,
    connect: MenuItem<Wry>,
    test: MenuItem<Wry>,
    /// while a terminal session is open
    end: MenuItem<Wry>,
    track: CheckMenuItem<Wry>,
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
        .invoke_handler(tauri::generate_handler![
            quick_add,
            quick_add_hide,
            pc_state,
            pc_set_on,
            pc_set_pin,
            pc_pair,
            pc_remove,
            pc_unlock,
            pc_end
        ])
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
            notify::register(h);
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
                end: MenuItem::with_id(h, "pc-end", "No terminal session open", false, None::<&str>)?,
                test: MenuItem::with_id(h, "test", "Send a test notification", false, None::<&str>)?,
                pause: CheckMenuItem::with_id(h, "pause", "Pause notifications for 1 hour", true, false, None::<&str>)?,
                track: CheckMenuItem::with_id(
                    h,
                    "track",
                    "Track my day on this PC",
                    true,
                    prefs.track.unwrap_or(true),
                    None::<&str>,
                )?,
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
            let day = MenuItem::with_id(h, "day", "My day", true, None::<&str>)?;
            let pc = MenuItem::with_id(h, "pc", "This PC from my phone…", true, None::<&str>)?;
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
                    &day,
                    &add,
                    &shortcut_menu,
                    &items.connect,
                    &items.test,
                    &sep()?,
                    &pc,
                    &items.end,
                    &sep()?,
                    &items.track,
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

            let dir = prefs_path.parent().map(std::path::Path::to_owned).unwrap_or_default();
            let (samples, looks) = mpsc::channel(16);
            let (frames, outgoing) = mpsc::unbounded_channel();
            let (pc_events, mut happened) = mpsc::unbounded_channel::<PcEvent>();
            let remote = Remote::new(
                Pairs::load(dir.join("pc.json"), Box::new(KeyringKeys)),
                dir.join("terminal-log.txt"),
                std::env::var("COMPUTERNAME").unwrap_or_else(|_| "My PC".into()),
                frames,
                Box::new(move |e| {
                    let _ = pc_events.send(e);
                }),
                Box::new(|| chrono::Utc::now().timestamp_millis()),
            );
            let state = Arc::new(State {
                shown: std::sync::Mutex::new(Shown::load(&dir.join("shown.json"))),
                tracker: std::sync::Mutex::default(),
                queue: Mutex::new(Queue::load(&dir.join("activity.json"))),
                watcher: std::sync::Mutex::new(None),
                samples,
                remote: remote.clone(),
                outgoing: Arc::new(Mutex::new(outgoing)),
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
            tauri::async_runtime::spawn(record(state.clone(), looks));
            tauri::async_runtime::spawn(remote.run());
            let (pc_app, pc_state) = (app.handle().clone(), state.clone());
            tauri::async_runtime::spawn(async move {
                while let Some(e) = happened.recv().await {
                    pc_event(&pc_app, &pc_state, e);
                }
            });

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
                stop_tracking(&s);
                let _ = flush(&s).await; // what was recorded is the person's: it goes before they leave
                s.client.sign_out().await;
                leave(&s).await;
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
        "day" => {
            let _ = app.opener().open_url(format!("{WEB_URL}/day"), None::<&str>);
        }
        "track" => {
            let mut p = Prefs::load(&s.prefs_path);
            let on = !p.track.unwrap_or(true);
            p.track = Some(on);
            let _ = p.save(&s.prefs_path);
            let _ = s.items.track.set_checked(on);
            if on {
                start_tracking(&s);
            } else {
                stop_tracking(&s);
                tauri::async_runtime::spawn(async move {
                    let _ = flush(&s).await;
                });
            }
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
        "quit" => {
            tauri::async_runtime::spawn(async move {
                stop_tracking(&s);
                let _ = tokio::time::timeout(Duration::from_secs(3), flush(&s)).await;
                app.exit(0);
            });
        }
        "pc" => show_pc(&app),
        "pc-end" => s.remote.end_all("ended"),
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
    let mut p = Prefs::load(&s.prefs_path);
    p.quick_add_shortcut = Some(chosen.clone().unwrap_or_default());
    let _ = p.save(&s.prefs_path);
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
    if Prefs::load(&s.prefs_path).track.unwrap_or(true) {
        start_tracking(&s);
    }
    let (tx, mut rx) = mpsc::channel::<LiveEvent>(64);
    let client = s.client.clone();
    let st = s.clone();
    tauri::async_runtime::spawn(async move {
        let task = tauri::async_runtime::spawn(live::run(client, tx, st.outgoing.clone()));
        *st.live_task.lock().await = Some(task);
        let mut again = tokio::time::interval(CATCH_UP_EVERY);
        again.tick().await; // the first tick is at once; connecting catches up
        loop {
            let ev = tokio::select! {
                ev = rx.recv() => match ev { Some(ev) => ev, None => break },
                _ = again.tick() => {
                    catch_up(&app, &st).await;
                    continue;
                }
            };
            match ev {
                LiveEvent::Connected => {
                    st.live.store(true, Ordering::Relaxed);
                    catch_up(&app, &st).await;
                }
                LiveEvent::Disconnected => {
                    st.live.store(false, Ordering::Relaxed);
                    st.remote.end_all("gone"); // the shells go on
                }
                LiveEvent::SignedOut => {
                    st.live.store(false, Ordering::Relaxed);
                    st.client.forget().await;
                    leave(&st).await;
                }
                LiveEvent::Message(ServerMessage::SessionRevoked) => {
                    stop_live(&st).await;
                    st.client.forget().await;
                    leave(&st).await;
                }
                LiveEvent::Message(ServerMessage::NotifyNew { notification }) => pop(&app, &st, &notification),
                LiveEvent::Message(ServerMessage::NotifyRead { id } | ServerMessage::NotifyDismissed { id }) => {
                    notify::clear(&app, &id)
                }
                LiveEvent::Message(ServerMessage::Pc { from, s, d }) => {
                    // checking the PIN takes a moment, on purpose
                    tokio::task::block_in_place(|| st.remote.handle(&from, &s, &d));
                    continue;
                }
                LiveEvent::Message(_) => {}
            }
            refresh_menu(&st);
        }
    });
}

/// After quiet hours and after a pause too, not only after a lost connection.
const CATCH_UP_EVERY: Duration = Duration::from_secs(15 * 60);
/// A long absence shows the newest ones and says how many more wait.
const CATCH_UP_MAX: usize = 5;

#[derive(serde::Deserialize)]
struct Missed {
    items: Vec<Notification>,
    until: String,
}

/// Whatever arrived while this PC slept or was offline, each once (spec 0021 #5).
async fn catch_up(app: &AppHandle, s: &Arc<State>) {
    if s.paused_until.load(Ordering::Relaxed) > now() {
        return; // comes when the pause ends
    }
    let path = {
        let shown = s.shown.lock().unwrap();
        let q: String = match shown.since() {
            Some(t) => url::form_urlencoded::Serializer::new(String::new())
                .append_pair("since", t)
                .finish(),
            None => String::new(),
        };
        format!("/notifications/missed?{q}")
    };
    let Ok(m) = s.client.call::<Missed>(reqwest::Method::GET, &path, None).await else {
        return; // asked again later from the same moment
    };
    let new: Vec<_> = {
        let mut shown = s.shown.lock().unwrap();
        shown.set_since(m.until);
        m.items.into_iter().filter(|n| shown.first(n)).collect()
    };
    let (urgent, rest): (Vec<_>, Vec<_>) = new.into_iter().partition(|n| n.alarm || n.priority == "urgent");
    let more = rest.len().saturating_sub(CATCH_UP_MAX);
    if more > 0 {
        toast(
            app,
            s,
            &note(
                &format!("{more} more while you were away"),
                "Open the inbox to see them.",
                "/notifications",
            ),
        );
    }
    for n in rest.iter().skip(more).chain(&urgent) {
        toast(app, s, n);
    }
}

/// One that just arrived. Paused ones aren't marked as shown, so they come when the pause ends.
fn pop(app: &AppHandle, s: &Arc<State>, n: &Notification) {
    let paused = s.paused_until.load(Ordering::Relaxed) > now() && n.priority != "urgent";
    if !n.silent && !paused && s.shown.lock().unwrap().first(n) {
        toast(app, s, n);
    }
}

/// A toast of the app's own (not on the server).
fn note(title: &str, body: &str, url: &str) -> Notification {
    Notification {
        id: String::new(),
        title: title.into(),
        body: body.into(),
        url: Some(url.into()),
        priority: "normal".into(),
        actions: vec![],
        alarm: false,
        silent: false,
        updated_at: None,
    }
}

fn toast(app: &AppHandle, s: &Arc<State>, n: &Notification) {
    let (app2, st, n2) = (app.clone(), s.clone(), n.clone());
    notify::show(app, n, move |choice| {
        tauri::async_runtime::spawn(chosen(app2.clone(), st.clone(), n2.clone(), choice));
    });
}

async fn chosen(app: AppHandle, s: Arc<State>, n: Notification, choice: Choice) {
    let (what, body) = match &choice {
        Choice::Open(to) => {
            let to = to.as_deref().or(n.url.as_deref()).unwrap_or("/");
            let to = url::Url::parse(WEB_URL).and_then(|u| u.join(to));
            if let Some(to) = to.ok().filter(|u| matches!(u.scheme(), "https" | "http")) {
                let _ = app.opener().open_url(to.as_str(), None::<&str>);
            }
            ("read".to_owned(), serde_json::json!({}))
        }
        Choice::Dismiss => ("dismiss".to_owned(), serde_json::json!({})),
        Choice::Action(id, typed) => (
            format!("actions/{id}"),
            match typed {
                Some(t) => serde_json::json!({ "text": t }),
                None => serde_json::json!({}),
            },
        ),
    };
    if n.id.is_empty() {
        return;
    }
    let done = s
        .client
        .call::<serde_json::Value>(
            reqwest::Method::POST,
            &format!("/notifications/{}/{what}", n.id),
            Some(body),
        )
        .await;
    // never silently lost: say so, with what was typed. Not sent again by itself: it may have arrived.
    if let (Err(e), Choice::Action(_, typed)) = (done, choice) {
        let why = match e {
            ApiError::Http { code, .. } if code == "reply_required" => "Type an answer first.".to_owned(),
            ApiError::Offline => "ORVYN didn’t answer, so it may not have arrived.".to_owned(),
            _ => "It didn’t go through.".to_owned(),
        };
        let body = match typed {
            Some(t) => format!("{why} You wrote: {t}"),
            None => why,
        };
        toast(
            &app,
            &s,
            &note(
                &format!("Check this: {}", n.title),
                &body,
                n.url.as_deref().unwrap_or("/"),
            ),
        );
    }
}

// ---------------------------------------------------------------- this PC from my phone (ADR-0019)

fn show_pc(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("pc") {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    // made when asked for and gone when closed: a hidden page would only use memory
    let _ = WebviewWindowBuilder::new(app, "pc", WebviewUrl::App("pc.html".into()))
        .title("This PC from my phone")
        .inner_size(560.0, 720.0)
        .center()
        .content_protected(true) // the code must not end up in a recording or a shared screen
        .build();
}

fn pc_event(app: &AppHandle, s: &Arc<State>, e: PcEvent) {
    let say = |title: String, body: &str| toast(app, s, &note(&title, body, "/pc"));
    match e {
        PcEvent::Opened(who) => say(
            format!("{who} opened a terminal session on this PC"),
            "Not you? End it from the ORVYN tray icon.",
        ),
        PcEvent::WrongPin(who) => say(format!("{who} gave a wrong terminal PIN"), "Five in a row lock it."),
        PcEvent::Locked(who) => say(
            format!("Terminal locked: {who} gave five wrong PINs"),
            "Unlock it here, from the ORVYN tray icon.",
        ),
        PcEvent::Sessions(n) => {
            let _ = s.items.end.set_enabled(n > 0);
            let _ = s.items.end.set_text(match n {
                0 => "No terminal session open".to_owned(),
                1 => "● A terminal session is open — end it".to_owned(),
                n => format!("● {n} terminal sessions are open — end them"),
            });
            if let Some(t) = app.tray_by_id("orvyn") {
                let _ = t.set_tooltip(Some(if n > 0 { "ORVYN ● terminal open" } else { "ORVYN" }));
            }
        }
    }
    let _ = app.emit_to("pc", "pc:changed", ());
}

#[derive(serde::Serialize)]
struct PcState {
    connected: bool,
    admin: bool,
    on: bool,
    pin: bool,
    locked: bool,
    sessions: usize,
    pairs: Vec<crate::pc::pairs::Pair>,
    log: Vec<String>,
}

/// Only this app's own window may change any of this.
fn from_pc_window(w: &tauri::WebviewWindow) -> Result<Arc<State>, String> {
    if w.label() != "pc" {
        return Err("Not from here".into());
    }
    Ok(state(w.app_handle()))
}

#[tauri::command]
fn pc_state(w: tauri::WebviewWindow) -> Result<PcState, String> {
    let s = from_pc_window(&w)?;
    let (on, pin, locked, pairs) = s.remote.pairs(|p| (p.on(), p.has_pin(), p.locked(), p.list()));
    Ok(PcState {
        connected: s.client.has_session(),
        admin: is_admin(),
        on,
        pin,
        locked,
        sessions: s.remote.sessions(),
        pairs,
        log: s.remote.last_log(30),
    })
}

#[tauri::command]
fn pc_set_on(w: tauri::WebviewWindow, on: bool) -> Result<(), String> {
    let s = from_pc_window(&w)?;
    if on && is_admin() {
        return Err("ORVYN is running as administrator. Start it normally first.".into());
    }
    if on && !s.client.has_session() {
        return Err("Connect ORVYN first (tray menu)".into());
    }
    s.remote.set_on(on)
}

#[tauri::command(async)]
fn pc_set_pin(w: tauri::WebviewWindow, pin: String) -> Result<(), String> {
    from_pc_window(&w)?.remote.set_pin(&pin)
}

#[derive(serde::Serialize)]
struct PcCode {
    text: String,
    svg: String,
}

#[tauri::command]
fn pc_pair(w: tauri::WebviewWindow) -> Result<PcCode, String> {
    let text = from_pc_window(&w)?.remote.new_code()?;
    // after the #, which a browser never sends to any server
    let qr = qrcode::QrCode::new(format!("{WEB_URL}/pc#{text}")).map_err(|_| "Couldn’t draw the code".to_owned())?;
    let svg = qr
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(240, 240)
        .build();
    Ok(PcCode { text, svg })
}

#[tauri::command]
fn pc_remove(w: tauri::WebviewWindow, id: String) -> Result<(), String> {
    from_pc_window(&w)?.remote.remove(&id)
}

#[tauri::command]
fn pc_unlock(w: tauri::WebviewWindow) -> Result<(), String> {
    from_pc_window(&w)?.remote.pairs(|p| p.unlock())
}

#[tauri::command]
fn pc_end(w: tauri::WebviewWindow) -> Result<(), String> {
    from_pc_window(&w)?.remote.end_all("ended");
    Ok(())
}

/// Commands run as me, never as administrator (spec 0021).
fn is_admin() -> bool {
    #[cfg(windows)]
    return unsafe { windows::Win32::UI::Shell::IsUserAnAdmin().as_bool() };
    #[cfg(not(windows))]
    false
}

// ---------------------------------------------------------------- My Day

fn start_tracking(s: &State) {
    if s.client.has_session() {
        let mut w = s.watcher.lock().unwrap();
        if w.is_none() {
            *w = Some(Watcher::start(s.samples.clone()));
        }
    }
}

fn stop_tracking(s: &State) {
    let w = s.watcher.lock().unwrap().take();
    drop(w);
}

/// Samples become spans; spans are sent every minute.
async fn record(s: Arc<State>, mut looks: mpsc::Receiver<Sample>) {
    let mut sent = std::time::Instant::now();
    while let Some(look) = looks.recv().await {
        if s.watcher.lock().unwrap().is_none() {
            continue; // the last look of a watcher that was just stopped
        }
        let closed = s.tracker.lock().unwrap().step(&look);
        if let Some(span) = closed {
            s.queue.lock().await.add(span);
        }
        if sent.elapsed() >= Duration::from_secs(60) {
            sent = std::time::Instant::now();
            let open = s.tracker.lock().unwrap().open.clone();
            let mut q = s.queue.lock().await;
            if let Err(ApiError::Http { status: 403, .. }) = q.send(&s.client, open.as_ref()).await {
                stop_tracking(&s);
                let _ = s.items.track.set_text("Track my day (My Day isn’t on for you)");
            }
        }
    }
}

/// Ends the span in progress and sends everything.
async fn flush(s: &State) -> Result<(), ApiError> {
    let last = s.tracker.lock().unwrap().stop();
    let mut q = s.queue.lock().await;
    if let Some(span) = last {
        q.add(span);
    }
    q.send(&s.client, None).await
}

/// Signed out: nothing of this person stays for the next one.
async fn leave(s: &State) {
    stop_tracking(s);
    s.remote.leave();
    s.tracker.lock().unwrap().open = None;
    s.queue.lock().await.clear();
    s.shown.lock().unwrap().clear();
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
