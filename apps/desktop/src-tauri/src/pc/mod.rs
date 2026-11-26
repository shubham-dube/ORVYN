//! This PC from a phone or browser (spec 0021 step 3, ADR-0019). A session: the other side names a pairing, this PC
//! answers with a fresh random half of the session's name, and from then on every message is encrypted and numbered.
//! The first one must be the PIN. Nothing runs before that.
pub mod deck;
pub mod pairs;
pub mod seal;
pub mod term;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{mpsc, Notify};

use deck::Hands;
use pairs::{Pairs, Pin};
use seal::{b64, random, Channel};
use term::Terms;

pub const IDLE_MS: i64 = 15 * 60_000;
/// A connection that never says its PIN.
const SILENT_MS: i64 = 60_000;
const SESSIONS_MAX: usize = 12;
/// Sent but not yet confirmed by the other side.
const WINDOW: u64 = 96 * 1024;
const CHUNK: usize = 12 * 1024;
const LOG_MAX: u64 = 512 * 1024;

/// To the server: passed on to one device of mine.
#[derive(Debug, Clone, Serialize)]
pub struct Frame {
    #[serde(rename = "type")]
    kind: &'static str,
    pub to: String,
    pub s: String,
    pub d: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    /// someone gave the right PIN
    Opened(String),
    WrongPin(String),
    Locked(String),
    /// what I waited for in this terminal has ended
    Done(String),
    /// how many sessions are open now
    Sessions(usize),
}

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum Ask {
    Auth {
        pin: String,
        #[serde(default)]
        name: String,
    },
    Ping,
    New {
        cols: u16,
        rows: u16,
        shell: Option<String>,
    },
    Attach {
        id: String,
        cols: u16,
        rows: u16,
        /// what it already has
        #[serde(default)]
        from: u64,
    },
    Detach {
        id: String,
    },
    In {
        id: String,
        d: String,
    },
    Size {
        id: String,
        cols: u16,
        rows: u16,
    },
    Watch {
        id: String,
        on: bool,
    },
    Ack {
        id: String,
        end: u64,
    },
    Close {
        id: String,
    },
    /// volume and so on, as they are now
    Deck,
    Do {
        what: String,
        #[serde(default)]
        v: Option<u8>,
    },
    Open {
        url: String,
    },
    /// read it, or set it
    Clip {
        #[serde(default)]
        text: Option<String>,
    },
    Shot,
    Files {
        #[serde(default)]
        path: Option<String>,
    },
    Get {
        path: String,
    },
    /// parts of a file or picture that arrived
    Got {
        id: u64,
        n: usize,
    },
    Bye,
}

/// A file or a picture on its way, part by part.
struct Blob {
    id: u64,
    bytes: Vec<u8>,
    sent: usize,
    got: usize,
}

const PART: usize = 24 * 1024;
const PARTS_WAITING: usize = 4;

struct View {
    sent: u64,
    acked: u64,
    told_exit: bool,
}

struct Session {
    from: String,
    pair: String,
    chan: Channel,
    ok: bool,
    /// the last thing a person did
    active: i64,
    views: HashMap<String, View>,
    blob: Option<Blob>,
    blobs: u64,
}

struct Inner {
    pairs: Pairs,
    sessions: HashMap<String, Session>,
}

pub struct Remote {
    inner: Mutex<Inner>,
    terms: Terms,
    wake: Arc<Notify>,
    out: mpsc::UnboundedSender<Frame>,
    tell: Box<dyn Fn(Event) + Send + Sync>,
    log: PathBuf,
    hands: Box<dyn Hands>,
    pub pc_name: String,
    clock: Box<dyn Fn() -> i64 + Send + Sync>,
}

impl Remote {
    pub fn new(
        pairs: Pairs,
        log: PathBuf,
        pc_name: String,
        out: mpsc::UnboundedSender<Frame>,
        tell: Box<dyn Fn(Event) + Send + Sync>,
        clock: Box<dyn Fn() -> i64 + Send + Sync>,
        hands: Box<dyn Hands>,
    ) -> Arc<Self> {
        let wake = Arc::new(Notify::new());
        let w = wake.clone();
        Arc::new(Self {
            inner: Mutex::new(Inner {
                pairs,
                sessions: HashMap::new(),
            }),
            terms: Terms::new(Arc::new(move || w.notify_one())),
            wake,
            out,
            tell,
            log,
            hands,
            pc_name,
            clock,
        })
    }

    fn now(&self) -> i64 {
        (self.clock)()
    }

    // ------------------------------------------------------------ at the PC

    pub fn pairs<T>(&self, f: impl FnOnce(&mut Pairs) -> T) -> T {
        f(&mut self.inner.lock().unwrap().pairs)
    }

    pub fn new_code(&self) -> Result<String, String> {
        let now = self.now();
        self.pairs(|p| p.pair(&self.pc_name, now))
    }

    /// Off ends the sessions and the shells.
    pub fn set_on(&self, on: bool) -> Result<(), String> {
        self.pairs(|p| p.set_on(on))?;
        if !on {
            self.end_all("off");
            self.terms.close_all();
        }
        self.write_log(if on { "switched on" } else { "switched off" });
        Ok(())
    }

    pub fn set_pin(&self, pin: &str) -> Result<(), String> {
        self.pairs(|p| p.set_pin(pin))?;
        self.end_all("ended");
        self.write_log("PIN changed");
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut i = self.inner.lock().unwrap();
        let name = i.pairs.name(id).unwrap_or_default();
        let gone: Vec<_> = i
            .sessions
            .iter()
            .filter(|(_, s)| s.pair == id)
            .map(|(k, _)| k.clone())
            .collect();
        for s in gone {
            self.end(&mut i, &s, "removed");
        }
        let r = i.pairs.remove(id);
        drop(i);
        self.write_log(&format!("removed {name}"));
        r
    }

    pub fn end_all(&self, why: &str) {
        let mut i = self.inner.lock().unwrap();
        let all: Vec<_> = i.sessions.keys().cloned().collect();
        for s in all {
            self.end(&mut i, &s, why);
        }
    }

    /// Signed out here: nothing of this person stays for the next one.
    pub fn leave(&self) {
        self.end_all("off");
        self.terms.close_all();
        self.pairs(|p| p.clear());
        let _ = std::fs::remove_file(&self.log);
    }

    pub fn sessions(&self) -> usize {
        self.inner.lock().unwrap().sessions.values().filter(|s| s.ok).count()
    }

    pub fn last_log(&self, lines: usize) -> Vec<String> {
        let t = std::fs::read_to_string(&self.log).unwrap_or_default();
        t.lines().rev().take(lines).map(str::to_owned).collect()
    }

    fn write_log(&self, what: &str) {
        use std::io::Write;
        if std::fs::metadata(&self.log).is_ok_and(|m| m.len() > LOG_MAX) {
            let _ = std::fs::rename(&self.log, self.log.with_extension("old.txt"));
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&self.log) {
            let at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(f, "{at}  {what}");
        }
    }

    // ------------------------------------------------------------ from the other side

    /// A frame the server passed on. Whatever is not exactly right is ignored or ends the session.
    pub fn handle(&self, from: &str, s: &str, d: &str) {
        match d.split_once('.') {
            Some(("o", pair)) => self.hello(from, s, pair),
            Some(("m", _)) => self.message(from, s, d),
            _ => {}
        }
    }

    fn send(&self, to: &str, s: &str, d: String) {
        let _ = self.out.send(Frame {
            kind: "pc",
            to: to.into(),
            s: s.into(),
            d,
        });
    }

    fn hello(&self, from: &str, s: &str, pair: &str) {
        let now = self.now();
        let mut i = self.inner.lock().unwrap();
        let Some(key) = i.pairs.key(pair, now) else {
            return; // not this PC's, or removed
        };
        if i.sessions.contains_key(s) {
            return;
        }
        if !i.pairs.on() || i.pairs.locked() {
            let why = if i.pairs.locked() { "x.locked" } else { "x.off" };
            return self.send(from, s, why.into());
        }
        if i.sessions.len() >= SESSIONS_MAX {
            let oldest = i
                .sessions
                .iter()
                .min_by_key(|(_, x)| (x.ok, x.active))
                .map(|(k, _)| k.clone());
            if let Some(k) = oldest {
                self.end(&mut i, &k, "ended");
            }
        }
        let mine = b64(&random::<16>());
        i.sessions.insert(
            s.into(),
            Session {
                from: from.into(),
                pair: pair.into(),
                chan: Channel::new(key, format!("{s}.{mine}"), 'p'),
                ok: false,
                active: now,
                views: HashMap::new(),
                blob: None,
                blobs: 0,
            },
        );
        self.send(from, s, format!("r.{mine}"));
    }

    fn message(&self, from: &str, s: &str, d: &str) {
        let now = self.now();
        let mut guard = self.inner.lock().unwrap();
        let i = &mut *guard;
        let Some(x) = i.sessions.get_mut(s).filter(|x| x.from == from) else {
            return self.send(from, s, "x.gone".into());
        };
        let ask = x.chan.open(d).map(|t| serde_json::from_str::<Ask>(&t));
        let Some(Ok(ask)) = ask else {
            // changed, repeated, missing one, or nonsense: start again
            return self.end(i, s, "gone");
        };
        if !x.ok {
            let Ask::Auth { pin, name } = ask else {
                return self.end(i, s, "gone");
            };
            let pair = x.pair.clone();
            let known = i.pairs.name(&pair).filter(|n| !n.is_empty()).unwrap_or(name.clone());
            match i.pairs.check_pin(&pin) {
                Pin::Right => {
                    i.pairs.used(&pair, &name, now);
                    x.ok = true;
                    x.active = now;
                    let m = json!({ "t": "hello", "pc": self.pc_name, "shells": term::shells(), "terms": self.terms.list() });
                    self.say(x, s, &m);
                    let n = i.sessions.values().filter(|x| x.ok).count();
                    drop(guard);
                    self.write_log(&format!("{known}: session opened"));
                    (self.tell)(Event::Opened(known));
                    (self.tell)(Event::Sessions(n));
                }
                Pin::Wrong { left } => {
                    self.say(x, s, &json!({ "t": "badpin", "left": left }));
                    drop(guard);
                    self.write_log(&format!("{known}: wrong PIN ({left} left)"));
                    (self.tell)(Event::WrongPin(known));
                }
                Pin::Locked => {
                    let all: Vec<_> = i.sessions.keys().cloned().collect();
                    for s in all {
                        self.end(i, &s, "locked");
                    }
                    drop(guard);
                    self.write_log(&format!("{known}: wrong PIN, locked"));
                    (self.tell)(Event::Locked(known));
                }
            }
            return;
        }
        if !matches!(ask, Ask::Ack { .. } | Ask::Got { .. } | Ask::Ping) {
            x.active = now;
        }
        match ask {
            Ask::Auth { .. } => {}
            Ask::Ping => self.say(x, s, &json!({ "t": "pong" })),
            Ask::New { cols, rows, shell } => match self.terms.start(shell.as_deref(), cols, rows, now) {
                Ok(t) => {
                    x.views.insert(
                        t.id.clone(),
                        View {
                            sent: 0,
                            acked: 0,
                            told_exit: false,
                        },
                    );
                    let m = json!({ "t": "opened", "id": t.id, "terms": self.terms.list() });
                    self.say(x, s, &m);
                    let who = i.pairs.name(&i.sessions[s].pair).unwrap_or_default();
                    self.write_log(&format!("{who}: started {}", t.view().name));
                }
                Err(e) => self.say(x, s, &json!({ "t": "error", "text": e })),
            },
            Ask::Attach { id, cols, rows, from } => match self.terms.get(&id) {
                Some(t) => {
                    t.resize(cols, rows);
                    x.views.insert(
                        id,
                        View {
                            sent: from,
                            acked: from,
                            told_exit: false,
                        },
                    );
                }
                None => self.say(x, s, &json!({ "t": "terms", "terms": self.terms.list() })),
            },
            Ask::Detach { id } => {
                x.views.remove(&id);
            }
            Ask::In { id, d } => {
                if let Some(t) = self.terms.get(&id) {
                    t.type_in(&d);
                }
            }
            Ask::Size { id, cols, rows } => {
                if let Some(t) = self.terms.get(&id) {
                    t.resize(cols, rows);
                }
            }
            Ask::Watch { id, on } => {
                if let Some(t) = self.terms.get(&id) {
                    t.set_watch(on);
                }
                self.tell_terms(i);
            }
            Ask::Ack { id, end } => {
                if let Some(v) = x.views.get_mut(&id) {
                    v.acked = end.min(v.sent).max(v.acked);
                }
            }
            Ask::Close { id } => {
                self.terms.close(&id);
                let m = json!({ "t": "terms", "terms": self.terms.list() });
                for (s, x) in i.sessions.iter_mut().filter(|(_, x)| x.ok) {
                    x.views.remove(&id);
                    self.say(x, s, &m);
                }
            }
            Ask::Got { id, n } => {
                if let Some(b) = x.blob.as_mut().filter(|b| b.id == id) {
                    b.got = n.min(b.sent).max(b.got);
                    if b.got * PART >= b.bytes.len() {
                        x.blob = None;
                    }
                }
            }
            Ask::Bye => self.end(i, s, "ended"),
            other => {
                let (answer, note) = self.deck(x, other);
                self.say(x, s, &answer);
                if let Some(what) = note {
                    let who = i.pairs.name(&i.sessions[s].pair).unwrap_or_default();
                    self.write_log(&format!("{who}: {what}"));
                }
            }
        }
        self.wake.notify_one();
    }

    /// The answer, and what the log says.
    fn deck(&self, x: &mut Session, ask: Ask) -> (serde_json::Value, Option<String>) {
        let state = || json!({ "t": "deck", "sound": self.hands.sound() });
        let failed = |e: String| json!({ "t": "error", "text": e });
        let done = |r: Result<(), String>, what: &str| match r {
            Ok(()) => (json!({ "t": "did", "what": what }), Some(what.to_owned())),
            Err(e) => (failed(e), None),
        };
        match ask {
            Ask::Do { what, v } => {
                let r = match what.as_str() {
                    "lock" => return done(self.hands.lock(), "lock"),
                    "sleep" => return done(self.hands.sleep(), "sleep"),
                    "mute" => self.hands.set_sound(None, Some(v != Some(0))),
                    "volume" => self.hands.set_sound(v, None),
                    _ => Err("This PC doesn’t know that".into()),
                };
                (r.map_or_else(failed, |_| state()), None)
            }
            Ask::Open { url } => match deck::web_link(&url) {
                Ok(u) => done(self.hands.open(&u), "open"),
                Err(e) => (failed(e), None),
            },
            Ask::Clip { text: Some(t) } if t.len() > deck::CLIP_MAX => (failed("That is too long".into()), None),
            Ask::Clip { text: Some(t) } => done(self.hands.set_clip(&t), "clipboard set"),
            Ask::Clip { text: None } => match self.hands.clip() {
                Ok(t) => {
                    let t: String = t.chars().take(deck::CLIP_MAX / 4).collect();
                    (json!({ "t": "clip", "text": t }), Some("clipboard read".into()))
                }
                Err(e) => (failed(e), None),
            },
            Ask::Shot => match self.hands.shot() {
                Ok(b) => (
                    Self::start_blob(x, "screen.jpg", b),
                    Some("looked at the screen".into()),
                ),
                Err(e) => (failed(e), None),
            },
            Ask::Files { path } => {
                let p = path.map(PathBuf::from).unwrap_or_else(deck::home);
                match deck::list(&p) {
                    Ok((mut all, mut cut)) => {
                        let parent = p.parent().map(|q| q.to_string_lossy().into_owned());
                        // one message is at most 64 KB
                        while serde_json::to_string(&all).map_or(0, |t| t.len()) > 32 * 1024 {
                            all.truncate(all.len() * 3 / 4);
                            cut = true;
                        }
                        (
                            json!({ "t": "files", "path": p.to_string_lossy(), "parent": parent, "list": all, "cut": cut }),
                            None,
                        )
                    }
                    Err(e) => (failed(e), None),
                }
            }
            Ask::Get { path } => {
                let p = PathBuf::from(&path);
                let name = p.file_name().map(|n| n.to_string_lossy().into_owned());
                match deck::read(&p) {
                    Ok(b) => (
                        Self::start_blob(x, name.as_deref().unwrap_or("file"), b),
                        Some(format!("fetched {path}")),
                    ),
                    Err(e) => (failed(e), None),
                }
            }
            _ => (state(), None),
        }
    }

    /// The newest wins: asking again drops what was on its way.
    fn start_blob(x: &mut Session, name: &str, bytes: Vec<u8>) -> serde_json::Value {
        x.blobs += 1;
        let m = json!({ "t": "blob", "id": x.blobs, "name": name, "size": bytes.len(), "part": PART });
        x.blob = (!bytes.is_empty()).then_some(Blob {
            id: x.blobs,
            bytes,
            sent: 0,
            got: 0,
        });
        m
    }

    fn tell_terms(&self, i: &mut Inner) {
        let m = json!({ "t": "terms", "terms": self.terms.list() });
        for (s, x) in i.sessions.iter_mut().filter(|(_, x)| x.ok) {
            self.say(x, s, &m);
        }
    }

    fn look(&self) {
        let done = self.terms.ended();
        if !done.is_empty() {
            self.tell_terms(&mut self.inner.lock().unwrap());
        }
        for id in done {
            (self.tell)(Event::Done(id));
        }
    }

    fn say(&self, x: &mut Session, s: &str, m: &serde_json::Value) {
        let d = x.chan.seal(&m.to_string());
        self.send(&x.from, s, d);
    }

    /// Says why in words only this PC and the other side can read, when there are any.
    fn end(&self, i: &mut Inner, s: &str, why: &str) {
        let Some(mut x) = i.sessions.remove(s) else { return };
        self.say(&mut x, s, &json!({ "t": "end", "why": why }));
        self.send(&x.from, s, format!("x.{why}"));
        if x.ok {
            let who = i.pairs.name(&x.pair).unwrap_or_default();
            self.write_log(&format!("{who}: session ended ({why})"));
            (self.tell)(Event::Sessions(i.sessions.values().filter(|x| x.ok).count()));
        }
    }

    // ------------------------------------------------------------ output

    /// Sends what is new, gathered for a moment, and ends what is idle.
    pub async fn run(self: Arc<Self>) {
        let mut tick = tokio::time::interval(Duration::from_secs(10));
        let mut look = tokio::time::interval(Duration::from_secs(2));
        loop {
            tokio::select! {
                _ = self.wake.notified() => {
                    self.pump();
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
                _ = tick.tick() => self.sweep(),
                _ = look.tick() => self.look(),
            }
        }
    }

    fn pump(&self) {
        let mut i = self.inner.lock().unwrap();
        let mut more = false;
        for (s, x) in i.sessions.iter_mut().filter(|(_, x)| x.ok) {
            let mut say = vec![];
            for (id, v) in x.views.iter_mut() {
                let Some(t) = self.terms.get(id) else { continue };
                let ring = t.ring.lock().unwrap();
                if v.sent > ring.end() {
                    (v.sent, v.acked) = (0, 0); // not this shell's past
                }
                if v.sent < ring.end() && v.sent - v.acked < WINDOW {
                    let (text, from, end) = ring.read(v.sent, CHUNK);
                    if end > v.sent {
                        let reset = from > v.sent; // too far behind: what is kept, from its start
                        if reset {
                            v.acked = from;
                        }
                        v.sent = end;
                        more |= end < ring.end();
                        say.push(json!({ "t": "out", "id": id, "d": text, "end": end, "reset": reset }));
                    }
                }
                if let (false, Some(code)) = (v.told_exit || v.sent < ring.end(), t.exit()) {
                    v.told_exit = true;
                    say.push(json!({ "t": "exit", "id": id, "code": code }));
                }
            }
            if let Some(b) = x.blob.as_mut() {
                let from = b.sent * PART;
                if from < b.bytes.len() && b.sent - b.got < PARTS_WAITING {
                    let to = (from + PART).min(b.bytes.len());
                    say.push(json!({ "t": "part", "id": b.id, "n": b.sent, "d": seal::b64(&b.bytes[from..to]) }));
                    b.sent += 1;
                    more |= b.sent - b.got < PARTS_WAITING;
                }
            }
            for m in say {
                self.say(x, s, &m);
            }
        }
        if more {
            self.wake.notify_one();
        }
    }

    pub fn sweep(&self) {
        let now = self.now();
        let mut i = self.inner.lock().unwrap();
        let old: Vec<_> = i
            .sessions
            .iter()
            .filter(|(_, x)| now - x.active > if x.ok { IDLE_MS } else { SILENT_MS })
            .map(|(k, _)| k.clone())
            .collect();
        for s in old {
            self.end(&mut i, &s, "idle");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::pairs::MemoryKeys;
    use super::seal::{unb64, Key};
    use super::*;
    use std::sync::atomic::{AtomicI64, Ordering};

    #[derive(Default)]
    pub struct FakeHands(Mutex<Vec<String>>);
    impl Hands for FakeHands {
        fn sound(&self) -> Option<deck::Sound> {
            Some(deck::Sound {
                volume: 40,
                muted: false,
            })
        }
        fn set_sound(&self, v: Option<u8>, m: Option<bool>) -> Result<(), String> {
            self.0.lock().unwrap().push(format!("{v:?} {m:?}"));
            Ok(())
        }
        fn lock(&self) -> Result<(), String> {
            Ok(())
        }
        fn sleep(&self) -> Result<(), String> {
            Err("not now".into())
        }
        fn open(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        fn clip(&self) -> Result<String, String> {
            Ok("from the PC".into())
        }
        fn set_clip(&self, _: &str) -> Result<(), String> {
            Ok(())
        }
        fn shot(&self) -> Result<Vec<u8>, String> {
            Ok((0..200_000u32).map(|i| i as u8).collect())
        }
    }

    struct Pc {
        remote: Arc<Remote>,
        out: mpsc::UnboundedReceiver<Frame>,
        events: Arc<Mutex<Vec<Event>>>,
        now: Arc<AtomicI64>,
    }

    fn pc(name: &str) -> Pc {
        let dir = std::env::temp_dir().join(format!("orvyn-pc-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (tx, out) = mpsc::unbounded_channel();
        let events: Arc<Mutex<Vec<Event>>> = Arc::default();
        let (ev, now) = (events.clone(), Arc::new(AtomicI64::new(1000)));
        let n = now.clone();
        let remote = Remote::new(
            Pairs::load(dir.join("pc.json"), Box::<MemoryKeys>::default()),
            dir.join("log.txt"),
            "Test PC".into(),
            tx,
            Box::new(move |e| ev.lock().unwrap().push(e)),
            Box::new(move || n.load(Ordering::Relaxed)),
            Box::<FakeHands>::default(),
        );
        remote.set_pin("826193").unwrap();
        remote.set_on(true).unwrap();
        Pc {
            remote,
            out,
            events,
            now,
        }
    }

    struct Phone {
        id: String,
        key: Key,
        s: String,
        chan: Channel,
    }

    impl Pc {
        fn next(&mut self) -> Option<Frame> {
            self.out.try_recv().ok()
        }
        fn code(&self) -> (String, Key) {
            let t = self.remote.new_code().unwrap();
            let p: Vec<_> = t.split('.').collect();
            (p[1].into(), unb64(p[2]).unwrap().try_into().unwrap())
        }
        fn connect(&mut self, id: &str, key: Key, s: &str) -> Phone {
            self.remote.handle("phone", s, &format!("o.{id}"));
            let f = self.next().unwrap();
            assert_eq!((f.to.as_str(), f.s.as_str()), ("phone", s));
            let mine = f.d.strip_prefix("r.").unwrap();
            Phone {
                id: id.into(),
                key,
                s: s.into(),
                chan: Channel::new(key, format!("{s}.{mine}"), 'c'),
            }
        }
        fn ask(&mut self, p: &mut Phone, m: serde_json::Value) -> Vec<serde_json::Value> {
            let d = p.chan.seal(&m.to_string());
            self.remote.handle("phone", &p.s, &d);
            self.read(p)
        }
        fn read(&mut self, p: &mut Phone) -> Vec<serde_json::Value> {
            let mut all = vec![];
            while let Some(f) = self.next() {
                if f.s == p.s && f.d.starts_with("m.") {
                    all.push(serde_json::from_str(&p.chan.open(&f.d).unwrap()).unwrap());
                }
            }
            all
        }
        fn signed_in(&mut self) -> Phone {
            let (id, key) = self.code();
            let mut p = self.connect(&id, key, "session-aaaaaaaaaaaa");
            let r = self.ask(&mut p, json!({ "t": "auth", "pin": "826193", "name": "Pixel" }));
            assert_eq!(r[0]["t"], "hello");
            p
        }
    }

    #[test]
    fn nothing_runs_for_an_unpaired_device_or_before_the_pin() {
        let mut t = pc("unpaired");
        t.remote.handle("phone", "s", "o.nobody");
        t.remote.handle("phone", "s", "m.0.AAAA");
        assert_eq!(t.next().unwrap().d, "x.gone");
        assert!(t.next().is_none());
        // the right pairing, the wrong key
        let (id, key) = t.code();
        let mut p = t.connect(&id, [7; 32], "session-1");
        let d = p.chan.seal(r#"{"t":"new","cols":80,"rows":24}"#);
        t.remote.handle("phone", &p.s, &d);
        // the right key, but no PIN
        let mut q = t.connect_after(&id, key, "session-2");
        let r = t.ask(&mut q, json!({ "t": "new", "cols": 80, "rows": 24 }));
        assert_eq!(r, vec![json!({ "t": "end", "why": "gone" })]);
        assert!(t.remote.terms.list().is_empty());
        // off: says so, opens nothing
        t.remote.set_on(false).unwrap();
        t.remote.handle("phone", "session-3", &format!("o.{id}"));
        assert_eq!(t.next().unwrap().d, "x.off");
    }

    impl Pc {
        /// past whatever is still waiting
        fn connect_after(&mut self, id: &str, key: Key, s: &str) -> Phone {
            while self.next().is_some() {}
            self.connect(id, key, s)
        }
    }

    #[test]
    fn a_changed_repeated_or_stolen_message_runs_nothing_and_a_recording_is_useless() {
        let mut t = pc("replay");
        let mut p = t.signed_in();
        let new = p.chan.seal(r#"{"t":"new","cols":80,"rows":24}"#);
        // someone else of the same account, with the recorded message
        t.remote.handle("another-device", &p.s, &new);
        assert_eq!(t.next().unwrap().d, "x.gone");
        assert!(t.remote.terms.list().is_empty());
        // the server replays the whole session later
        t.remote.end_all("ended");
        while t.next().is_some() {}
        t.remote.handle("phone", &p.s, &format!("o.{}", p.id));
        let mine = t.next().unwrap().d;
        assert!(mine.starts_with("r."));
        t.remote.handle("phone", &p.s, &new);
        assert!(t.remote.terms.list().is_empty());
        assert_eq!(t.remote.sessions(), 0);
        // repeated
        let (id, key) = (p.id.clone(), p.key);
        let mut q = t.connect_after(&id, key, "session-bbbbbbbbbbbb");
        assert_eq!(t.ask(&mut q, json!({ "t": "auth", "pin": "826193" }))[0]["t"], "hello");
        let ping = q.chan.seal(r#"{"t":"ping"}"#);
        t.remote.handle("phone", &q.s, &ping);
        t.remote.handle("phone", &q.s, &ping);
        assert_eq!(t.remote.sessions(), 0);
    }

    #[test]
    fn five_wrong_pins_end_everything_until_unlocked_here() {
        let mut t = pc("wrong");
        let p = t.signed_in();
        let mut q = t.connect_after(&p.id, p.key, "session-cccccccccccc");
        for left in [4, 3, 2, 1] {
            let r = t.ask(&mut q, json!({ "t": "auth", "pin": "nope" }));
            assert_eq!(r[0], json!({ "t": "badpin", "left": left }));
        }
        let r = t.ask(&mut q, json!({ "t": "auth", "pin": "nope" }));
        assert_eq!(r[0], json!({ "t": "end", "why": "locked" }));
        assert_eq!(t.remote.sessions(), 0); // the open one too
        while t.next().is_some() {}
        t.remote.handle("phone", "session-dddddddddddd", &format!("o.{}", p.id));
        assert_eq!(t.next().unwrap().d, "x.locked");
        assert!(t.events.lock().unwrap().contains(&Event::Locked("Pixel".into())));
        t.remote.pairs(|p| p.unlock()).unwrap();
        t.connect(&p.id, p.key, "session-eeeeeeeeeeee");
        assert!(t
            .remote
            .last_log(99)
            .iter()
            .any(|l| l.contains("Pixel: wrong PIN, locked")));
        assert!(!t
            .remote
            .last_log(99)
            .iter()
            .any(|l| l.contains("826193") || l.contains("nope")));
    }

    #[test]
    fn removing_a_device_ends_its_session_at_once_and_idle_ends_it_later() {
        let mut t = pc("remove");
        let mut p = t.signed_in();
        t.now.fetch_add(IDLE_MS - 1000, Ordering::Relaxed);
        t.ask(&mut p, json!({ "t": "ack", "id": "x", "end": 1 })); // not a person
        t.remote.sweep();
        assert_eq!(t.remote.sessions(), 1);
        t.now.fetch_add(2000, Ordering::Relaxed);
        t.remote.sweep();
        assert_eq!(t.read(&mut p), vec![json!({ "t": "end", "why": "idle" })]);
        let mut q = t.connect_after(&p.id, p.key, "session-ffffffffffff");
        t.ask(&mut q, json!({ "t": "auth", "pin": "826193" }));
        t.remote.remove(&p.id).unwrap();
        assert_eq!(t.read(&mut q), vec![json!({ "t": "end", "why": "removed" })]);
        assert_eq!(t.ask(&mut q, json!({ "t": "ping" })), Vec::<serde_json::Value>::new());
        t.remote.handle("phone", "session-gggggggggggg", &format!("o.{}", p.id));
        assert!(t.next().is_none());
    }

    #[test]
    fn a_shell_survives_the_phone_and_goes_on_where_it_was() {
        let mut t = pc("shell");
        let mut p = t.signed_in();
        let r = t.ask(&mut p, json!({ "t": "new", "cols": 80, "rows": 24 }));
        let id = r[0]["id"].as_str().unwrap().to_owned();
        t.ask(&mut p, json!({ "t": "in", "id": id, "d": "echo first-$(1+1)\r" }));
        let (mut text, mut end) = (String::new(), 0);
        let until = std::time::Instant::now() + Duration::from_secs(30);
        let gather = |t: &mut Pc, p: &mut Phone, text: &mut String, end: &mut u64, want: &str| {
            while !text.contains(want) && std::time::Instant::now() < until {
                std::thread::sleep(Duration::from_millis(30));
                t.remote.pump();
                for m in t.read(p) {
                    if m["t"] == "out" {
                        text.push_str(m["d"].as_str().unwrap());
                        *end = m["end"].as_u64().unwrap();
                    }
                }
            }
            assert!(!cfg!(windows) || text.contains(want), "{text:?}");
        };
        gather(&mut t, &mut p, &mut text, &mut end, "first-2");
        // the phone is gone; the shell goes on
        t.remote.end_all("ended");
        t.remote.terms.get(&id).unwrap().type_in("echo second-$(1+2)\r");
        let mut q = t.connect_after(&p.id, p.key, "session-hhhhhhhhhhhh");
        let r = t.ask(&mut q, json!({ "t": "auth", "pin": "826193" }));
        assert_eq!(r[0]["terms"][0]["id"], id.as_str());
        t.ask(
            &mut q,
            json!({ "t": "attach", "id": id, "cols": 100, "rows": 30, "from": end }),
        );
        let mut later = String::new();
        gather(&mut t, &mut q, &mut later, &mut end, "second-3");
        assert!(!later.contains("first-2") || later.contains("second-3"));
        let r = t.ask(&mut q, json!({ "t": "close", "id": id }));
        assert!(r.iter().any(|m| m["t"] == "terms" && m["terms"] == json!([])));
    }

    #[test]
    fn the_deck_answers_after_the_pin_and_refuses_what_is_not_a_link() {
        let mut t = pc("deck");
        let mut p = t.signed_in();
        assert_eq!(t.ask(&mut p, json!({ "t": "deck" }))[0]["sound"]["volume"], 40);
        assert_eq!(t.ask(&mut p, json!({ "t": "do", "what": "lock" }))[0]["t"], "did");
        assert_eq!(
            t.ask(&mut p, json!({ "t": "do", "what": "sleep" }))[0]["text"],
            "not now"
        );
        assert_eq!(t.ask(&mut p, json!({ "t": "do", "what": "format" }))[0]["t"], "error");
        assert_eq!(
            t.ask(&mut p, json!({ "t": "open", "url": "calc.exe" }))[0]["t"],
            "error"
        );
        assert_eq!(t.ask(&mut p, json!({ "t": "clip" }))[0]["text"], "from the PC");
        assert_eq!(t.ask(&mut p, json!({ "t": "clip", "text": "x" }))[0]["t"], "did");
        let long = "x".repeat(deck::CLIP_MAX + 1);
        assert_eq!(t.ask(&mut p, json!({ "t": "clip", "text": long }))[0]["t"], "error");
        assert_eq!(t.ask(&mut p, json!({ "t": "files" }))[0]["t"], "files");
        let log = t.remote.last_log(99).join("\n");
        assert!(log.contains("Pixel: lock") && log.contains("clipboard read") && !log.contains("from the PC"));
    }

    #[test]
    fn a_picture_arrives_whole_part_by_part_and_waits_for_the_other_side() {
        let mut t = pc("blob");
        let mut p = t.signed_in();
        let head = t.ask(&mut p, json!({ "t": "shot" }));
        assert_eq!(
            (head[0]["t"].as_str(), head[0]["size"].as_u64()),
            (Some("blob"), Some(200_000))
        );
        let mut all = vec![];
        for _ in 0..20 {
            t.remote.pump();
        }
        let first = t.read(&mut p);
        assert_eq!(first.len(), PARTS_WAITING);
        let mut parts = first;
        while !parts.is_empty() {
            let mut n = 0;
            for m in &parts {
                assert_eq!(m["n"].as_u64().unwrap() as usize * PART, all.len());
                all.extend(unb64(m["d"].as_str().unwrap()).unwrap());
                n = m["n"].as_u64().unwrap() + 1;
            }
            t.ask(&mut p, json!({ "t": "got", "id": 1, "n": n }));
            for _ in 0..9 {
                t.remote.pump();
            }
            parts = t.read(&mut p);
        }
        assert_eq!(all, FakeHands::default().shot().unwrap());
    }

    #[test]
    fn a_device_that_does_not_confirm_is_not_flooded() {
        let mut t = pc("window");
        let mut p = t.signed_in();
        let id = t.ask(&mut p, json!({ "t": "new", "cols": 80, "rows": 24 }))[0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        t.remote
            .terms
            .get(&id)
            .unwrap()
            .ring
            .lock()
            .unwrap()
            .push(&vec![b'x'; 200 * 1024]);
        let mut got = 0;
        let mut last = 0;
        for _ in 0..40 {
            t.remote.pump();
            for m in t.read(&mut p).iter().filter(|m| m["t"] == "out") {
                got += m["d"].as_str().unwrap().len();
                last = m["end"].as_u64().unwrap();
            }
        }
        assert!(got as u64 <= WINDOW + CHUNK as u64, "{got}");
        t.ask(&mut p, json!({ "t": "ack", "id": id, "end": last }));
        t.remote.pump();
        assert!(t.read(&mut p).iter().any(|m| m["t"] == "out"));
        t.remote.terms.close_all();
    }
}
