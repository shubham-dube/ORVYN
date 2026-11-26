//! One quick box (spec 0021 #6): a task, `spent 240 lunch`, `drop: …`, `?passport`. What is typed offline is kept here
//! and saved later, once, as of when it was typed. Also the clipboard and a snip into Drop (#7).
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::api::{ApiError, Client};
use crate::quickadd::{mutation, task_fields, Hlc};

#[derive(Debug, PartialEq, Clone, Copy, Serialize, Deserialize)]
pub enum Kind {
    Task,
    Money,
    Drop,
}

/// What the words mean, before any server is asked.
#[derive(Debug, PartialEq)]
pub enum Typed<'a> {
    Save(Kind, &'a str),
    Find(&'a str),
}

pub fn read(text: &str) -> Option<Typed<'_>> {
    let t = text.trim();
    let after = |p: &str| {
        t.get(..p.len())
            .filter(|s| s.eq_ignore_ascii_case(p))
            .map(|_| t[p.len()..].trim())
    };
    let typed = if let Some(q) = t.strip_prefix('?') {
        Typed::Find(q.trim())
    } else if let Some(d) = after("drop:") {
        Typed::Save(Kind::Drop, d)
    } else if money(t) {
        Typed::Save(Kind::Money, t)
    } else {
        Typed::Save(Kind::Task, t)
    };
    match &typed {
        Typed::Save(_, s) | Typed::Find(s) if s.is_empty() => None,
        _ => Some(typed),
    }
}

/// Only words that can't be a task: "pay rent 5000" stays one.
fn money(t: &str) -> bool {
    let mut words = t.split_whitespace();
    let first = words.next().unwrap_or("").to_lowercase();
    let amount = t.chars().any(|c| c.is_ascii_digit());
    amount && matches!(first.as_str(), "spent" | "paid" | "received" | "got" | "earned")
}

/// One thing typed, with the ids it will have: sent twice, it is saved once.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Kept {
    pub kind: Kind,
    pub text: String,
    /// unix ms: "tomorrow" means the day after this
    pub at: i64,
    ids: [String; 4],
}

impl Kept {
    pub fn new(kind: Kind, text: &str, at: i64) -> Self {
        Self {
            kind,
            text: text.chars().take(500).collect(),
            at,
            ids: std::array::from_fn(|_| uuid::Uuid::now_v7().to_string()),
        }
    }

    fn day(&self) -> String {
        chrono::DateTime::from_timestamp_millis(self.at)
            .unwrap_or_default()
            .with_timezone(&chrono::Local)
            .format("%Y-%m-%d")
            .to_string()
    }

    fn iso(&self) -> String {
        chrono::DateTime::from_timestamp_millis(self.at)
            .unwrap_or_default()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }

    /// Saves it; the words to show.
    pub async fn save(&self, client: &Client, hlc: &std::sync::Mutex<Hlc>) -> Result<String, ApiError> {
        let [m1, e1, m2, e2] = &self.ids;
        let (said, muts) = match self.kind {
            Kind::Task => {
                let parsed: Value = client
                    .call(
                        reqwest::Method::POST,
                        "/today/parse",
                        Some(json!({ "text": self.text, "at": self.iso() })),
                    )
                    .await?;
                let mut fields = task_fields(&parsed, &self.day());
                let mut muts = vec![];
                if let (Value::Null, Value::String(name)) = (&parsed["projectId"], &parsed["projectName"]) {
                    let mut p = Map::new();
                    p.insert("name".into(), json!(name));
                    muts.push(mutation(hlc, m2, "today.project", e2, p));
                    fields.insert("projectId".into(), json!(e2));
                }
                let title = fields["title"].as_str().unwrap_or(&self.text).to_owned();
                muts.push(mutation(hlc, m1, "today.task", e1, fields));
                (title, muts)
            }
            Kind::Money => {
                let p: Value = client
                    .call(
                        reqwest::Method::POST,
                        "/money/parse",
                        Some(json!({ "text": self.text, "at": self.iso() })),
                    )
                    .await?;
                let Value::Object(mut f) = p["fields"].clone() else {
                    return Err(ApiError::Http {
                        status: 422,
                        code: "no_amount".into(),
                    });
                };
                f.insert("source".into(), json!("manual"));
                let said = p["said"].as_str().unwrap_or("Saved in Money").to_owned();
                (said, vec![mutation(hlc, m1, "money.transaction", e1, f)])
            }
            Kind::Drop => {
                let link = url::Url::parse(&self.text)
                    .is_ok_and(|u| matches!(u.scheme(), "http" | "https") && !self.text.contains(char::is_whitespace));
                let f = json!({
                    "kind": if link { "link" } else { "text" },
                    "text": if link { "" } else { &self.text },
                    "url": if link { json!(self.text) } else { Value::Null },
                    "source": "desktop",
                    "status": "new",
                });
                let Value::Object(f) = f else { unreachable!() };
                ("In Drop".into(), vec![mutation(hlc, m1, "drop.item", e1, f)])
            }
        };
        push(client, muts).await?;
        Ok(said)
    }
}

async fn push(client: &Client, muts: Vec<Value>) -> Result<(), ApiError> {
    let r: Value = client
        .call(reqwest::Method::POST, "/sync/push", Some(json!({ "mutations": muts })))
        .await?;
    match r["rejected"].get(0).and_then(|x| x["reason"].as_str()) {
        Some(reason) => Err(ApiError::Http {
            status: 422,
            code: reason.to_owned(),
        }),
        None => Ok(()),
    }
}

/// A picture into Drop.
pub async fn drop_picture(
    client: &Client,
    hlc: &std::sync::Mutex<Hlc>,
    jpeg: Vec<u8>,
    name: &str,
) -> Result<(), ApiError> {
    let file = client.upload(jpeg, "image/jpeg", name).await?;
    let f = json!({ "kind": "photo", "fileId": file, "fileName": name, "text": "", "source": "desktop" });
    let Value::Object(f) = f else { unreachable!() };
    let id = || uuid::Uuid::now_v7().to_string();
    push(client, vec![mutation(hlc, &id(), "drop.item", &id(), f)]).await
}

/// What waits for a connection. Lost only when the person signs out.
pub struct Waiting {
    path: PathBuf,
    list: Vec<Kept>,
}

impl Waiting {
    pub fn load(path: &Path) -> Self {
        let list = std::fs::read_to_string(path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Self {
            path: path.to_owned(),
            list,
        }
    }
    fn store(&self) -> bool {
        if let Some(d) = self.path.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        std::fs::write(&self.path, serde_json::to_vec(&self.list).unwrap_or_default()).is_ok()
    }
    /// False when it couldn't be kept: then it must not be called saved.
    pub fn add(&mut self, k: Kept) -> bool {
        self.list.push(k);
        self.store()
    }
    pub fn len(&self) -> usize {
        self.list.len()
    }
    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }
    pub fn clear(&mut self) {
        self.list.clear();
        let _ = std::fs::remove_file(&self.path);
    }
    /// Oldest first; stops when offline. What the server will never take is handed back to be shown, not dropped.
    pub async fn send(&mut self, client: &Client, hlc: &std::sync::Mutex<Hlc>) -> Vec<Kept> {
        let mut refused = vec![];
        while let Some(k) = self.list.first().cloned() {
            match k.save(client, hlc).await {
                Ok(_) => {}
                Err(ApiError::Http { status, .. })
                    if (400..500).contains(&status) && status != 429 && status != 401 =>
                {
                    refused.push(k)
                }
                Err(_) => break,
            }
            self.list.remove(0);
            self.store();
        }
        refused
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_word_decides_and_a_task_stays_a_task() {
        use Typed::*;
        assert_eq!(read("call mom 6pm"), Some(Save(Kind::Task, "call mom 6pm")));
        assert_eq!(read(" Spent 240 lunch "), Some(Save(Kind::Money, "Spent 240 lunch")));
        assert_eq!(
            read("received 5k from Ravi"),
            Some(Save(Kind::Money, "received 5k from Ravi"))
        );
        assert_eq!(read("pay rent 5000"), Some(Save(Kind::Task, "pay rent 5000")));
        assert_eq!(read("paid leave form"), Some(Save(Kind::Task, "paid leave form")));
        assert_eq!(read("DROP: an idea"), Some(Save(Kind::Drop, "an idea")));
        assert_eq!(read("?passport"), Some(Find("passport")));
        for empty in ["", "  ", "?", "drop:  "] {
            assert_eq!(read(empty), None);
        }
        assert_eq!(read("नमस्ते"), Some(Save(Kind::Task, "नमस्ते")));
    }

    #[tokio::test]
    async fn offline_keeps_it_with_its_ids_across_a_restart() {
        let path = std::env::temp_dir().join(format!("orvyn-waiting-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut w = Waiting::load(&path);
        let k = Kept::new(Kind::Task, "call mom tomorrow", 1_790_000_000_000);
        assert!(w.add(k.clone()));
        let mut again = Waiting::load(&path);
        assert_eq!(again.list, vec![k]);
        let store = std::sync::Arc::new(crate::store::MemoryStore::default());
        crate::store::TokenStore::set(&*store, Some("r"));
        let client = Client::new("http://127.0.0.1:9", store);
        let hlc = std::sync::Mutex::new(Hlc::new("t"));
        assert!(again.send(&client, &hlc).await.is_empty());
        assert_eq!(again.len(), 1);
        again.clear();
        assert!(Waiting::load(&path).is_empty());
    }
}
