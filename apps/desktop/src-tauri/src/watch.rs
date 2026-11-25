//! Looking at the PC every few seconds (Windows). Keys, clicks and scrolls are counted by low-level hooks whose
//! callbacks look only at *that* something happened: the event's data (which key, where) is never read.
use crate::activity::Sample;

pub const EVERY: std::time::Duration = std::time::Duration::from_secs(5);

#[cfg(not(windows))]
pub struct Watcher;
#[cfg(not(windows))]
impl Watcher {
    pub fn start(_: tokio::sync::mpsc::Sender<Sample>) -> Self {
        Self
    }
}

#[cfg(windows)]
pub use win::Watcher;

#[cfg(windows)]
mod win {
    use super::{Sample, EVERY};
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering::Relaxed};
    use std::sync::Arc;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::StationsAndDesktops::{
        CloseDesktop, OpenInputDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_READOBJECTS,
    };
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::System::Threading::{
        GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::*;

    static KEYS: AtomicU32 = AtomicU32::new(0);
    static CLICKS: AtomicU32 = AtomicU32::new(0);
    static SCROLLS: AtomicU32 = AtomicU32::new(0);

    unsafe extern "system" fn on_key(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if code >= 0 && matches!(w.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN) {
            KEYS.fetch_add(1, Relaxed); // `l`, which says which key, is never looked into
        }
        CallNextHookEx(None, code, w, l)
    }

    unsafe extern "system" fn on_mouse(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if code >= 0 {
            match w.0 as u32 {
                WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN => {
                    CLICKS.fetch_add(1, Relaxed);
                }
                WM_MOUSEWHEEL | WM_MOUSEHWHEEL => {
                    SCROLLS.fetch_add(1, Relaxed);
                }
                _ => {}
            }
        }
        CallNextHookEx(None, code, w, l)
    }

    /// Watches until dropped.
    pub struct Watcher {
        stop: Arc<AtomicBool>,
        hooks: Option<(u32, std::thread::JoinHandle<()>)>,
    }

    impl Watcher {
        pub fn start(tx: tokio::sync::mpsc::Sender<Sample>) -> Self {
            for c in [&KEYS, &CLICKS, &SCROLLS] {
                c.store(0, Relaxed);
            }
            let (ready, wait) = std::sync::mpsc::channel();
            let thread = std::thread::spawn(move || unsafe { count(ready) });
            let hooks = wait.recv().ok().map(|id| (id, thread));
            let stop = Arc::new(AtomicBool::new(false));
            let s = stop.clone();
            std::thread::spawn(move || {
                let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
                while !s.load(Relaxed) {
                    if tx.blocking_send(unsafe { look() }).is_err() {
                        break;
                    }
                    std::thread::sleep(EVERY);
                }
            });
            Self { stop, hooks }
        }
    }

    impl Drop for Watcher {
        fn drop(&mut self) {
            self.stop.store(true, Relaxed);
            if let Some((id, thread)) = self.hooks.take() {
                let _ = unsafe { PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0)) };
                let _ = thread.join();
            }
        }
    }

    unsafe fn count(ready: std::sync::mpsc::Sender<u32>) {
        let mut msg = MSG::default();
        // makes the message queue, so a WM_QUIT sent right away isn't lost
        let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
        let module = GetModuleHandleW(None).ok().map(Into::into);
        let k = SetWindowsHookExW(WH_KEYBOARD_LL, Some(on_key), module, 0);
        let m = SetWindowsHookExW(WH_MOUSE_LL, Some(on_mouse), module, 0);
        let _ = ready.send(GetCurrentThreadId());
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {}
        for h in [k, m].into_iter().flatten() {
            let _ = UnhookWindowsHookEx(h);
        }
    }

    unsafe fn look() -> Sample {
        let front = GetForegroundWindow();
        let app = program(front);
        let locked = app.eq_ignore_ascii_case("LockApp.exe") || (front.is_invalid() && secure_desktop());
        Sample {
            t: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_millis() as i64),
            title: title(front),
            app,
            idle_ms: idle_ms(),
            locked,
            playing: playing(),
            keys: KEYS.swap(0, Relaxed),
            clicks: CLICKS.swap(0, Relaxed),
            scrolls: SCROLLS.swap(0, Relaxed),
        }
    }

    unsafe fn title(w: HWND) -> String {
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(w, &mut buf);
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }

    unsafe fn program(w: HWND) -> String {
        let mut pid = 0;
        GetWindowThreadProcessId(w, Some(&mut pid));
        if pid == 0 {
            return String::new();
        }
        let Ok(p) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new(); // a program running as administrator
        };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(p, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(p);
        if ok.is_err() {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit('\\').next().unwrap_or_default().to_owned()
    }

    unsafe fn idle_ms() -> i64 {
        let mut i = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if !GetLastInputInfo(&mut i).as_bool() {
            return 0;
        }
        i64::from(GetTickCount().wrapping_sub(i.dwTime)) // the counter wraps every 49 days
    }

    unsafe fn secure_desktop() -> bool {
        match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_READOBJECTS) {
            Ok(d) => {
                let _ = CloseDesktop(d);
                false
            }
            Err(_) => true,
        }
    }

    /// Is any sound coming out of the PC?
    unsafe fn playing() -> bool {
        let peak = || -> windows::core::Result<f32> {
            let all: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let out = all.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
            let meter: IAudioMeterInformation = out.Activate(CLSCTX_ALL, None)?;
            meter.GetPeakValue()
        };
        peak().unwrap_or(0.0) > 0.001
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn watches_and_stops() {
            let (tx, mut rx) = tokio::sync::mpsc::channel(4);
            let w = Watcher::start(tx);
            let s = rx.blocking_recv().unwrap();
            assert!(s.t > 0 && s.idle_ms >= 0);
            drop(w); // joins the hook thread: hangs here if it can't be stopped
        }
    }
}
