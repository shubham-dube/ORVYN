//! My Day, the PC's half (spec 0021 #1, ADR-0018): which program is in front and whether anyone is there. Pure logic
//! and the queue of spans waiting to be sent; `watch.rs` does the looking.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::api::{ApiError, Client};

/// Silence longer than this means the PC was asleep: the span ends where it was last seen.
const SILENCE_MS: i64 = 90_000;
/// Nobody touched anything for this long: away (or watching, when something is playing).
pub const IDLE_MS: i64 = 120_000;
/// The server refuses spans longer than a day; a new one starts well before that.
const MAX_SPAN_MS: i64 = 6 * 3_600_000;
const MIN_SPAN_MS: i64 = 2_000;
const KEEP: usize = 5_000;
const BATCH: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Active,
    Media,
    Away,
    Locked,
}

/// One look at the PC. Counts only: which keys were pressed is never read.
#[derive(Debug, Clone)]
pub struct Sample {
    pub t: i64,
    pub app: String,
    pub title: String,
    pub idle_ms: i64,
    pub locked: bool,
    pub playing: bool,
    pub keys: u32,
    pub clicks: u32,
    pub scrolls: u32,
}

impl Sample {
    pub fn kind(&self) -> Kind {
        if self.locked {
            Kind::Locked
        } else if self.idle_ms < IDLE_MS {
            Kind::Active
        } else if self.playing {
            Kind::Media
        } else {
            Kind::Away
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Span {
    pub id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub kind: Kind,
    pub app: String,
    pub title: String,
    pub keys: u32,
    pub clicks: u32,
    pub scrolls: u32,
}

impl Span {
    fn wire(&self) -> serde_json::Value {
        let count = |n: u32| n.min(1_000_000);
        serde_json::json!({
            "id": self.id, "source": "pc", "start": iso(self.start_ms), "end": iso(self.end_ms), "kind": self.kind,
            "app": self.app, "title": self.title, "keys": count(self.keys), "clicks": count(self.clicks),
            "scrolls": count(self.scrolls),
        })
    }
}

fn iso(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .unwrap_or_default()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// At most `max` UTF-16 units, which is how the server counts.
fn cut(s: &str, max: usize) -> String {
    let mut n = 0;
    s.chars()
        .take_while(|c| {
            n += c.len_utf16();
            n <= max
        })
        .collect()
}

/// A title without what changes every second: spinners, unsaved dots, unread counts.
pub fn tidy(title: &str) -> String {
    let t = title
        .trim_start_matches(|c: char| ('\u{2800}'..='\u{28FF}').contains(&c) || "●•○◐◓◑◒✳✶✻✽✢·*⏺ ".contains(c))
        .trim();
    let t = match t.strip_prefix('(').and_then(|r| r.split_once(')')) {
        Some((n, rest)) if !n.is_empty() && n.chars().all(|c| c.is_ascii_digit() || c == '+') => rest.trim(),
        _ => t,
    };
    cut(t, 300)
}

/// Titles that must not leave the PC. A browser's pages come from the extension, which is off in private windows; the
/// window title would give those away. A password manager's title can name an account.
pub fn title_for(app: &str, title: &str) -> String {
    const NO_TITLE: [&str; 15] = [
        "chrome",
        "msedge",
        "brave",
        "firefox",
        "opera",
        "opera_gx",
        "vivaldi",
        "arc",
        "tor",
        "librewolf",
        "zen",
        "keepass",
        "keepassxc",
        "1password",
        "bitwarden",
    ];
    let exe = app.to_ascii_lowercase();
    let exe = exe.strip_suffix(".exe").unwrap_or(&exe);
    if NO_TITLE.contains(&exe) {
        String::new()
    } else {
        tidy(title)
    }
}

#[derive(Default)]
pub struct Tracker {
    pub open: Option<Span>,
}

impl Tracker {
    /// Takes one look; gives back the span that just ended, if one did.
    pub fn step(&mut self, s: &Sample) -> Option<Span> {
        let kind = s.kind();
        let gone = matches!(kind, Kind::Away | Kind::Locked);
        let app = if gone { String::new() } else { cut(&s.app, 120) };
        let title = if gone {
            String::new()
        } else {
            title_for(&s.app, &s.title)
        };
        let mut start = s.t;
        let mut closed = None;
        if let Some(mut open) = self.open.take() {
            let gap = s.t - open.end_ms;
            let seen = (0..=SILENCE_MS).contains(&gap);
            if seen {
                open.end_ms = s.t;
            }
            let same = seen && open.kind == kind && open.app == app && open.title == title;
            if same && open.end_ms - open.start_ms < MAX_SPAN_MS {
                open.keys = open.keys.saturating_add(s.keys);
                open.clicks = open.clicks.saturating_add(s.clicks);
                open.scrolls = open.scrolls.saturating_add(s.scrolls);
                self.open = Some(open);
                return None;
            }
            // the idle minutes weren't used: they belong to being away, or to the film
            if seen && open.kind == Kind::Active && matches!(kind, Kind::Away | Kind::Media) {
                start = (s.t - s.idle_ms).clamp(open.start_ms, s.t);
                open.end_ms = start;
            }
            if open.end_ms - open.start_ms >= MIN_SPAN_MS {
                closed = Some(open);
            }
        }
        self.open = Some(Span {
            id: uuid::Uuid::now_v7().to_string(),
            start_ms: start,
            end_ms: s.t,
            kind,
            app,
            title,
            keys: s.keys,
            clicks: s.clicks,
            scrolls: s.scrolls,
        });
        closed
    }

    /// Switched off, signed out or quitting.
    pub fn stop(&mut self) -> Option<Span> {
        self.open.take().filter(|s| s.end_ms - s.start_ms >= MIN_SPAN_MS)
    }
}

/// Spans waiting for the network, kept across restarts.
pub struct Queue {
    path: PathBuf,
    spans: Vec<Span>,
}

impl Queue {
    pub fn load(path: &Path) -> Self {
        let spans = std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            path: path.to_owned(),
            spans,
        }
    }

    pub fn add(&mut self, s: Span) {
        self.spans.push(s);
        if self.spans.len() > KEEP {
            self.spans.drain(..self.spans.len() - KEEP);
        }
        self.save();
    }

    pub fn clear(&mut self) {
        self.spans.clear();
        let _ = std::fs::remove_file(&self.path);
    }

    pub fn len(&self) -> usize {
        self.spans.len()
    }

    pub fn is_empty(&self) -> bool {
        self.spans.is_empty()
    }

    fn save(&self) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // whole or not at all: a power cut mid-write must not lose the queue
        let tmp = self.path.with_extension("tmp");
        if let Ok(json) = serde_json::to_string(&self.spans) {
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, &self.path);
            }
        }
    }

    /// Sends what waits and the span still running (the server extends it by its id).
    pub async fn send(&mut self, client: &Client, open: Option<&Span>) -> Result<(), ApiError> {
        loop {
            let n = self.spans.len().min(BATCH);
            let last = n == self.spans.len();
            let mut batch: Vec<_> = self.spans[..n].iter().map(Span::wire).collect();
            let running = open.filter(|o| last && n < BATCH && o.end_ms - o.start_ms >= MIN_SPAN_MS);
            if let Some(o) = running {
                batch.push(o.wire());
            }
            if batch.is_empty() {
                return Ok(());
            }
            let sent = client
                .call::<serde_json::Value>(
                    reqwest::Method::POST,
                    "/activity/spans",
                    Some(serde_json::json!({ "spans": batch })),
                )
                .await;
            match sent {
                Ok(_) => {}
                // these can never be accepted: keeping them would block every later one
                Err(ApiError::Http { status: 400 | 422, .. }) => {}
                Err(ApiError::Http { status: 403, .. }) => {
                    self.clear(); // My Day isn't switched on for this person
                    return Err(ApiError::Http {
                        status: 403,
                        code: "forbidden".into(),
                    });
                }
                Err(e) => return Err(e),
            }
            self.spans.drain(..n);
            if n > 0 {
                self.save();
            }
            if last {
                return Ok(());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_794_000_000_000;
    fn look(s: i64, app: &str, title: &str) -> Sample {
        Sample {
            t: T0 + s * 1000,
            app: app.into(),
            title: title.into(),
            idle_ms: 0,
            locked: false,
            playing: false,
            keys: 1,
            clicks: 0,
            scrolls: 0,
        }
    }

    #[test]
    fn one_program_is_one_span_and_counts_add_up() {
        let mut t = Tracker::default();
        for s in (0..60).step_by(5) {
            assert!(t
                .step(&look(s, "Code.exe", "a.rs - orvyn - Visual Studio Code"))
                .is_none());
        }
        let done = t.step(&look(60, "slack.exe", "general")).unwrap();
        assert_eq!((done.end_ms - done.start_ms, done.keys), (60_000, 12));
        assert_eq!(done.app, "Code.exe");
        assert_eq!(t.open.as_ref().unwrap().start_ms, T0 + 60_000); // no gap, no overlap
    }

    #[test]
    fn going_away_gives_the_idle_minutes_back() {
        let mut t = Tracker::default();
        for s in (0..=300).step_by(5) {
            t.step(&look(s, "Code.exe", "x"));
        }
        let mut idle = look(305, "Code.exe", "x");
        idle.idle_ms = 125_000;
        let done = t.step(&idle).unwrap();
        assert_eq!(done.end_ms, T0 + 180_000);
        let open = t.open.as_ref().unwrap();
        assert_eq!((open.kind, open.start_ms), (Kind::Away, T0 + 180_000));
        assert_eq!((open.app.as_str(), open.title.as_str()), ("", ""));
        // a film playing is watching, not being away
        let mut film = look(310, "vlc.exe", "Film");
        (film.idle_ms, film.playing) = (130_000, true);
        t.step(&film);
        assert_eq!(t.open.as_ref().unwrap().kind, Kind::Media);
    }

    #[test]
    fn sleep_and_a_clock_set_back_never_count_as_time_used() {
        let mut t = Tracker::default();
        t.step(&look(0, "Code.exe", "x"));
        t.step(&look(10, "Code.exe", "x"));
        let done = t.step(&look(8 * 3600, "Code.exe", "x")).unwrap();
        assert_eq!(done.end_ms, T0 + 10_000);
        assert_eq!(t.open.as_ref().unwrap().start_ms, T0 + 8 * 3_600_000);
        t.step(&look(8 * 3600 - 600, "Code.exe", "x"));
        let o = t.open.as_ref().unwrap();
        assert!(o.end_ms >= o.start_ms);
    }

    #[test]
    fn a_day_in_one_program_is_cut_into_spans_the_server_accepts() {
        let mut t = Tracker::default();
        let mut spans = vec![];
        for s in (0..86_400).step_by(5) {
            spans.extend(t.step(&look(s, "Code.exe", "x")));
        }
        assert!(spans.len() >= 3);
        assert!(spans.iter().all(|s| s.end_ms - s.start_ms <= MAX_SPAN_MS + 5_000));
    }

    #[test]
    fn titles_are_tidied_and_private_ones_stay_here() {
        assert_eq!(tidy("⠋ building"), tidy("⠙ building"));
        assert_eq!(tidy("● a.rs - orvyn"), "a.rs - orvyn");
        assert_eq!(tidy("(12) Inbox"), "Inbox");
        assert_eq!(tidy("(draft) Plan"), "(draft) Plan");
        assert_eq!(title_for("Chrome.exe", "My bank"), "");
        assert_eq!(title_for("KeePassXC.exe", "Gmail password"), "");
        assert_eq!(title_for("Code.exe", "a.rs"), "a.rs");
        assert!(tidy(&"😀".repeat(400)).encode_utf16().count() <= 300);
    }

    #[test]
    fn the_queue_survives_a_restart_and_sends_the_shape_the_server_expects() {
        let path = std::env::temp_dir().join(format!("orvyn-q-{}.json", uuid::Uuid::now_v7()));
        let mut t = Tracker::default();
        t.step(&look(0, "Code.exe", "x"));
        t.step(&look(30, "Code.exe", "x"));
        let mut q = Queue::load(&path);
        q.add(t.stop().unwrap());
        let again = Queue::load(&path);
        assert_eq!(again.len(), 1);
        let w = again.spans[0].wire();
        assert_eq!((w["source"].as_str(), w["kind"].as_str()), (Some("pc"), Some("active")));
        assert!(w["start"].as_str().unwrap().ends_with('Z'));
        assert_eq!(w["keys"], 2);
        q.clear();
        assert!(Queue::load(&path).is_empty());
    }
}
