//! Native notifications. Windows: toasts with Open / Dismiss buttons. Elsewhere (CI, dev on Linux): a plain toast.
use crate::live::Notification;

pub enum Choice {
    Open,
    Dismiss,
    /// one of the notification's own buttons (Done, Snooze 10 min, …)
    Action(String),
}

#[cfg(windows)]
pub fn show<F>(app: &tauri::AppHandle, n: &Notification, on_choice: F)
where
    F: Fn(Choice) + Send + Sync + 'static,
{
    use tauri_winrt_notification::{Duration, Toast};
    let app_id = &app.config().identifier;
    let toast = Toast::new(app_id)
        .title(&n.title)
        .text1(&n.body)
        .duration(if n.priority == "urgent" {
            Duration::Long
        } else {
            Duration::Short
        })
        .add_button("Open", "open")
        .add_button("Dismiss", "dismiss")
        .on_activated(move |action| {
            // a click on the toast body has no action: treat it as Open
            on_choice(if action.as_deref() == Some("dismiss") {
                Choice::Dismiss
            } else {
                Choice::Open
            });
            Ok(())
        });
    let _ = toast.show();
}

#[cfg(not(windows))]
pub fn show<F>(app: &tauri::AppHandle, n: &Notification, _on_choice: F)
where
    F: Fn(Choice) + Send + Sync + 'static,
{
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(&n.title).body(&n.body).show();
}
