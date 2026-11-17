//! Quick add from anywhere on the PC (spec 0002 M5): a global shortcut opens a small box; what's typed is read by
//! the same parser as every other device (`POST /today/parse`) and saved as a task through sync.
use serde_json::{json, Map, Value};
use std::sync::Mutex;

use crate::api::{ApiError, Client};

/// Hybrid logical clock in the shared format "<ms, 15 digits>:<counter, 5>:<node>" (packages/contracts/src/hlc.ts).
pub struct Hlc {
    node: String,
    last_ms: u64,
    counter: u32,
}

impl Hlc {
    pub fn new(node: &str) -> Self {
        let node: String = node
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
            .take(40)
            .collect();
        Self {
            node: if node.is_empty() { "desktop".into() } else { node },
            last_ms: 0,
            counter: 0,
        }
    }

    pub fn tick(&mut self, wall_ms: u64) -> String {
        if wall_ms > self.last_ms {
            self.last_ms = wall_ms;
            self.counter = 0;
        } else {
            self.counter += 1;
        }
        format!("{:015}:{:05}:{}", self.last_ms, self.counter, self.node)
    }
}

/// The task fields for what the parser understood; `fallback_day` (local YYYY-MM-DD) when no day was named,
/// so a quick add lands in Today like it does from the Orb on the phone.
pub fn task_fields(parsed: &Value, fallback_day: &str) -> Map<String, Value> {
    let mut f = Map::new();
    let due_at = parsed["dueAt"].clone();
    f.insert("title".into(), parsed["title"].clone());
    f.insert("dueAt".into(), due_at.clone());
    f.insert(
        "dueDate".into(),
        if due_at.is_null() {
            match &parsed["dueDate"] {
                Value::Null => Value::String(fallback_day.into()),
                d => d.clone(),
            }
        } else {
            Value::Null
        },
    );
    for k in ["durationMin", "rrule", "projectId"] {
        f.insert(k.into(), parsed[k].clone());
    }
    f.insert("priority".into(), parsed.get("priority").cloned().unwrap_or(json!(0)));
    f.insert("tags".into(), parsed.get("tags").cloned().unwrap_or(json!([])));
    f.insert("source".into(), json!("desktop"));
    f
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn local_day() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn mutation(hlc: &Mutex<Hlc>, entity: &str, id: &str, fields: Map<String, Value>) -> Value {
    let stamp = hlc.lock().map(|mut h| h.tick(now_ms())).unwrap_or_default();
    json!({
        "mutationId": uuid::Uuid::now_v7().to_string(),
        "entity": entity,
        "entityId": id,
        "op": "upsert",
        "fields": fields,
        "hlc": stamp,
    })
}

/// Parse, then save. Returns the title that was saved. An unknown @project is created on the way (as everywhere).
pub async fn add(client: &Client, text: &str, hlc: &Mutex<Hlc>, fallback_day: &str) -> Result<String, ApiError> {
    let parsed: Value = client
        .call(reqwest::Method::POST, "/today/parse", Some(json!({ "text": text })))
        .await?;
    let mut fields = task_fields(&parsed, fallback_day);
    let mut mutations = vec![];
    if let (Value::Null, Value::String(name)) = (&parsed["projectId"], &parsed["projectName"]) {
        let pid = uuid::Uuid::now_v7().to_string();
        let mut p = Map::new();
        p.insert("name".into(), json!(name));
        mutations.push(mutation(hlc, "today.project", &pid, p));
        fields.insert("projectId".into(), json!(pid));
    }
    let title = fields["title"].as_str().unwrap_or(text).to_owned();
    mutations.push(mutation(hlc, "today.task", &uuid::Uuid::now_v7().to_string(), fields));
    let r: Value = client
        .call(
            reqwest::Method::POST,
            "/sync/push",
            Some(json!({ "mutations": mutations })),
        )
        .await?;
    if let Some(reason) = r["rejected"].get(0).and_then(|x| x["reason"].as_str()) {
        return Err(ApiError::Http {
            status: 422,
            code: reason.to_owned(),
        });
    }
    Ok(title)
}

/// Shortcuts the person can pick from the tray (none is forced: "Off" is a choice too).
pub const SHORTCUTS: [&str; 3] = ["Ctrl+Shift+Space", "Ctrl+Alt+Space", "Alt+Shift+T"];

#[derive(serde::Serialize, serde::Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    /// None until chosen (then the first suggestion is offered); Some("") = off
    pub quick_add_shortcut: Option<String>,
}

impl Prefs {
    pub fn load(path: &std::path::Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &std::path::Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
    }

    /// The shortcut in effect: the person's choice, or the first suggestion until they choose; None = off.
    pub fn shortcut(&self) -> Option<&str> {
        match self.quick_add_shortcut.as_deref() {
            None => Some(SHORTCUTS[0]),
            Some("") => None,
            Some(s) => Some(s),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hlc_matches_the_shared_format_and_never_goes_back() {
        let mut h = Hlc::new("w ORVYN-on PC!");
        let a = h.tick(1_794_000_000_000);
        let b = h.tick(1_794_000_000_000);
        let c = h.tick(1_700_000_000_000); // clock went backwards
        assert_eq!(a, "001794000000000:00000:wORVYN-onPC");
        assert_eq!(b, "001794000000000:00001:wORVYN-onPC");
        assert!(c > b);
    }

    #[test]
    fn parsed_text_becomes_task_fields() {
        let timed = json!({"title":"Call mom","dueAt":"2026-11-17T12:30:00.000Z","dueDate":null,"durationMin":30,"rrule":null,"priority":2,"tags":["family"],"projectId":null});
        let f = task_fields(&timed, "2026-11-17");
        assert_eq!(f["dueDate"], Value::Null);
        assert_eq!(f["dueAt"], "2026-11-17T12:30:00.000Z");
        assert_eq!(f["priority"], 2);
        assert_eq!(f["source"], "desktop");
        let plain = json!({"title":"Buy milk","dueAt":null,"dueDate":null});
        assert_eq!(
            task_fields(&plain, "2026-11-17")["dueDate"],
            "2026-11-17",
            "lands in Today"
        );
        let dated = json!({"title":"Pay rent","dueAt":null,"dueDate":"2026-12-01","rrule":"FREQ=MONTHLY;BYMONTHDAY=1"});
        let f = task_fields(&dated, "2026-11-17");
        assert_eq!(f["dueDate"], "2026-12-01");
        assert_eq!(f["rrule"], "FREQ=MONTHLY;BYMONTHDAY=1");
    }

    #[test]
    fn every_offered_shortcut_is_one_windows_understands() {
        use std::str::FromStr;
        for sc in SHORTCUTS {
            assert!(tauri_plugin_global_shortcut::Shortcut::from_str(sc).is_ok(), "{sc}");
        }
    }

    #[test]
    fn the_shortcut_is_the_persons_choice() {
        let dir = std::env::temp_dir().join(format!("orvyn-prefs-{}", std::process::id()));
        let path = dir.join("prefs.json");
        assert_eq!(
            Prefs::load(&path).shortcut(),
            Some("Ctrl+Shift+Space"),
            "a suggestion until chosen"
        );
        Prefs {
            quick_add_shortcut: Some("Alt+Shift+T".into()),
        }
        .save(&path)
        .unwrap();
        assert_eq!(Prefs::load(&path).shortcut(), Some("Alt+Shift+T"));
        Prefs {
            quick_add_shortcut: Some(String::new()),
        }
        .save(&path)
        .unwrap();
        assert_eq!(Prefs::load(&path).shortcut(), None, "off");
        let _ = std::fs::remove_dir_all(dir);
    }
}
