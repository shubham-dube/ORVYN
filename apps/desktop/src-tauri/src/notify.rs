//! Native notifications (spec 0021 #3, #4). Windows: toasts with the notification's own buttons and a box to reply in;
//! alarms ring, urgent ones stay. Elsewhere (CI, dev on Linux): a plain toast.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::live::Notification;

#[derive(Debug, Clone, PartialEq)]
pub enum Choice {
    /// the body was clicked, or a button that opens a page
    Open(Option<String>),
    Dismiss,
    /// one of the notification's own buttons, with what was typed when it asks for an answer
    Action(String, Option<String>),
}

fn esc(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .map(|c| match c {
            '&' => "&amp;".into(),
            '<' => "&lt;".into(),
            '>' => "&gt;".into(),
            '"' => "&quot;".into(),
            '\'' => "&apos;".into(),
            c => c.to_string(),
        })
        .collect()
}

/// The toast's XML. Windows allows five buttons and the notification's come first.
pub fn toast_xml(n: &Notification) -> String {
    let scenario = if n.alarm {
        " scenario=\"alarm\""
    } else if n.priority == "urgent" {
        " scenario=\"reminder\""
    } else {
        ""
    };
    let reply = n.actions.iter().find(|a| a.reply.is_some());
    let mut actions = String::new();
    if let Some(r) = reply {
        let hint = r.reply.as_ref().map(|x| x.placeholder.as_str()).unwrap_or_default();
        actions += &format!(
            "<input id=\"reply\" type=\"text\" placeHolderContent=\"{}\"/>",
            esc(hint)
        );
    }
    let mut buttons = 0;
    for a in n
        .actions
        .iter()
        .filter(|a| a.reply.is_none() || Some(a.id.as_str()) == reply.map(|r| r.id.as_str()))
        .take(5)
    {
        let args = match &a.open {
            Some(to) => format!("go:{to}"),
            None => format!("do:{}", a.id),
        };
        let typed = if a.reply.is_some() {
            " hint-inputId=\"reply\""
        } else {
            ""
        };
        actions += &format!(
            "<action content=\"{}\" arguments=\"{}\" activationType=\"foreground\"{typed}/>",
            esc(&a.label),
            esc(&args)
        );
        buttons += 1;
    }
    if buttons < 5 {
        actions += "<action content=\"Dismiss\" arguments=\"dismiss\" activationType=\"foreground\"/>";
    }
    let audio = if n.alarm {
        "<audio src=\"ms-winsoundevent:Notification.Looping.Alarm\" loop=\"true\"/>"
    } else {
        ""
    };
    format!(
        "<toast launch=\"open\"{scenario}><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text>\
         </binding></visual><actions>{actions}</actions>{audio}</toast>",
        esc(&n.title),
        esc(&n.body)
    )
}

/// What a click on the toast means.
pub fn choice(arguments: &str, typed: Option<String>) -> Choice {
    if let Some(id) = arguments.strip_prefix("do:") {
        Choice::Action(id.to_owned(), typed.filter(|t| !t.trim().is_empty()))
    } else if let Some(to) = arguments.strip_prefix("go:") {
        Choice::Open(Some(to.to_owned()))
    } else if arguments == "dismiss" {
        Choice::Dismiss
    } else {
        Choice::Open(None)
    }
}

/// Which ones have been shown, and since when to ask for missed ones. Kept across restarts (spec 0021 #5).
#[derive(Serialize, Deserialize, Default)]
struct Seen {
    since: Option<String>,
    shown: Vec<String>,
}

pub struct Shown {
    path: PathBuf,
    seen: Seen,
}

impl Shown {
    pub fn load(path: &Path) -> Self {
        Self {
            path: path.to_owned(),
            seen: std::fs::read_to_string(path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default(),
        }
    }

    pub fn since(&self) -> Option<&str> {
        self.seen.since.as_deref()
    }

    pub fn set_since(&mut self, until: String) {
        if self.seen.since.as_ref() != Some(&until) {
            self.seen.since = Some(until);
            self.save();
        }
    }

    /// True the first time. The same notification speaking again (a second chat message) counts as new.
    pub fn first(&mut self, n: &Notification) -> bool {
        let key = format!("{}|{}", n.id, n.updated_at.as_deref().unwrap_or_default());
        if self.seen.shown.contains(&key) {
            return false;
        }
        self.seen.shown.push(key);
        if self.seen.shown.len() > 500 {
            self.seen.shown.drain(..100);
        }
        self.save();
        true
    }

    /// Another person may sign in next.
    pub fn clear(&mut self) {
        self.seen = Seen::default();
        let _ = std::fs::remove_file(&self.path);
    }

    fn save(&self) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(s) = serde_json::to_string(&self.seen) {
            let _ = std::fs::write(&self.path, s);
        }
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::{Interface, Result, HSTRING};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Foundation::{IPropertyValue, TypedEventHandler};
    use windows::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    use windows::UI::Notifications::{ToastActivatedEventArgs, ToastNotification, ToastNotificationManager};

    const GROUP: &str = "orvyn";

    /// Windows shows toasts only from a program it knows; the installer's shortcut says so, this does for a plain exe.
    pub fn register(app_id: &str) {
        let key = HSTRING::from(format!("Software\\Classes\\AppUserModelId\\{app_id}"));
        let name: Vec<u16> = "ORVYN\0".encode_utf16().collect();
        unsafe {
            let _ = RegSetKeyValueW(
                HKEY_CURRENT_USER,
                &key,
                &HSTRING::from("DisplayName"),
                REG_SZ.0,
                Some(name.as_ptr().cast()),
                (name.len() * 2) as u32,
            );
        }
    }

    pub fn show<F>(app_id: &str, n: &Notification, on_choice: F) -> Result<()>
    where
        F: Fn(Choice) + Send + Sync + 'static,
    {
        let xml = XmlDocument::new()?;
        xml.LoadXml(&HSTRING::from(toast_xml(n)))?;
        let toast = ToastNotification::CreateToastNotification(&xml)?;
        toast.SetTag(&HSTRING::from(n.id.as_str()))?;
        toast.SetGroup(&HSTRING::from(GROUP))?;
        toast.Activated(&TypedEventHandler::new(
            move |_, args: windows::core::Ref<windows::core::IInspectable>| {
                if let Some(a) = args.as_ref().and_then(|a| a.cast::<ToastActivatedEventArgs>().ok()) {
                    let typed = a
                        .UserInput()
                        .and_then(|i| i.Lookup(&HSTRING::from("reply")))
                        .and_then(|v| v.cast::<IPropertyValue>())
                        .and_then(|v| v.GetString())
                        .ok()
                        .map(|s| s.to_string());
                    on_choice(choice(&a.Arguments()?.to_string(), typed));
                }
                Ok(())
            },
        ))?;
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)
    }

    /// Dealt with on another device: it leaves the screen and the Action Centre here too.
    pub fn clear(app_id: &str, id: &str) {
        let _ = ToastNotificationManager::History()
            .and_then(|h| h.RemoveGroupedTagWithId(&HSTRING::from(id), &HSTRING::from(GROUP), &HSTRING::from(app_id)));
    }
}

#[cfg(windows)]
pub fn register(app: &tauri::AppHandle) {
    win::register(&app.config().identifier);
}
#[cfg(not(windows))]
pub fn register(_: &tauri::AppHandle) {}

#[cfg(windows)]
pub fn show<F>(app: &tauri::AppHandle, n: &Notification, on_choice: F)
where
    F: Fn(Choice) + Send + Sync + 'static,
{
    if let Err(e) = win::show(&app.config().identifier, n, on_choice) {
        eprintln!("toast: {e}");
    }
}
#[cfg(not(windows))]
pub fn show<F>(app: &tauri::AppHandle, n: &Notification, _on_choice: F)
where
    F: Fn(Choice) + Send + Sync + 'static,
{
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(&n.title).body(&n.body).show();
}

#[cfg(windows)]
pub fn clear(app: &tauri::AppHandle, id: &str) {
    win::clear(&app.config().identifier, id);
}
#[cfg(not(windows))]
pub fn clear(_: &tauri::AppHandle, _: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn chat() -> Notification {
        serde_json::from_str(
            r#"{"id":"n1","title":"Asha & <co>","body":"a \"b\"\u0007","url":"/chat/1","priority":"high","updatedAt":"t1","actions":[
              {"id":"reply","label":"Reply","reply":{"placeholder":"Message"}},{"id":"read","label":"Mark as read"},
              {"id":"open","label":"Open","open":"/chat/1?a=1&b=2"}]}"#,
        )
        .unwrap()
    }

    #[test]
    fn a_chat_toast_has_a_box_its_own_buttons_and_escaped_text() {
        let x = toast_xml(&chat());
        assert!(x.contains("<text>Asha &amp; &lt;co&gt;</text><text>a &quot;b&quot;</text>"));
        assert!(x.contains("placeHolderContent=\"Message\""));
        assert!(
            x.contains("content=\"Reply\" arguments=\"do:reply\" activationType=\"foreground\" hint-inputId=\"reply\"")
        );
        assert!(x.contains("arguments=\"do:read\""));
        assert!(x.contains("arguments=\"go:/chat/1?a=1&amp;b=2\""));
        assert!(!x.contains("scenario"));
    }

    #[test]
    fn alarms_ring_urgent_ones_stay_and_there_are_never_more_than_five_buttons() {
        let mut n = chat();
        n.alarm = true;
        assert!(toast_xml(&n).contains("scenario=\"alarm\"") && toast_xml(&n).contains("loop=\"true\""));
        n.alarm = false;
        n.priority = "urgent".into();
        assert!(toast_xml(&n).contains("scenario=\"reminder\""));
        let more = n.actions[1].clone();
        n.actions.extend(std::iter::repeat_n(more, 6));
        assert_eq!(toast_xml(&n).matches("<action ").count(), 5);
    }

    #[test]
    fn clicks_mean_what_they_say() {
        assert_eq!(choice("open", None), Choice::Open(None));
        assert_eq!(choice("go:/today", None), Choice::Open(Some("/today".into())));
        assert_eq!(choice("dismiss", None), Choice::Dismiss);
        assert_eq!(
            choice("do:reply", Some("hi".into())),
            Choice::Action("reply".into(), Some("hi".into()))
        );
        assert_eq!(
            choice("do:reply", Some("  ".into())),
            Choice::Action("reply".into(), None)
        );
    }

    #[test]
    fn each_is_shown_once_even_after_a_restart_unless_it_speaks_again() {
        let path = std::env::temp_dir().join(format!("orvyn-s-{}.json", uuid::Uuid::now_v7()));
        let mut s = Shown::load(&path);
        assert!(s.first(&chat()) && !s.first(&chat()));
        s.set_since("2026-11-25T00:00:00.000Z".into());
        let mut again = Shown::load(&path);
        assert_eq!(again.since(), Some("2026-11-25T00:00:00.000Z"));
        assert!(!again.first(&chat()));
        let mut second = chat();
        second.updated_at = Some("t2".into());
        assert!(again.first(&second));
        again.clear();
        assert!(Shown::load(&path).since().is_none());
    }

    #[cfg(windows)]
    #[test]
    fn windows_accepts_the_xml() {
        use windows::{core::HSTRING, Data::Xml::Dom::XmlDocument};
        let mut n = chat();
        n.alarm = true;
        XmlDocument::new()
            .unwrap()
            .LoadXml(&HSTRING::from(toast_xml(&n)))
            .unwrap();
    }
}
