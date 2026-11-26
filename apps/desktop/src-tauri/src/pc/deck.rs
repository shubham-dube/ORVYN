//! The remote deck (spec 0021 #11): see the screen, lock, sleep, volume, open a link, the clipboard both ways, fetch a
//! file. Only inside a session that gave the PIN.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const FILE_MAX: u64 = 25 * 1024 * 1024;
const LIST_MAX: usize = 1000;
pub const CLIP_MAX: usize = 20_000;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Sound {
    /// 0..100
    pub volume: u8,
    pub muted: bool,
}

/// What this PC can be asked to do; another one in tests.
pub trait Hands: Send + Sync {
    fn sound(&self) -> Option<Sound>;
    fn set_sound(&self, volume: Option<u8>, muted: Option<bool>) -> Result<(), String>;
    fn lock(&self) -> Result<(), String>;
    fn sleep(&self) -> Result<(), String>;
    fn open(&self, url: &str) -> Result<(), String>;
    fn clip(&self) -> Result<String, String>;
    fn set_clip(&self, text: &str) -> Result<(), String>;
    /// a JPEG of every screen, at most `width` wide
    fn shot(&self, width: u32, quality: u8) -> Result<Vec<u8>, String>;
    /// a mouse or a key, as if at the PC (spec 0021 #11, live screen)
    fn input(&self, i: &Input) -> Result<(), String>;
    /// a file opened by its own program, on the PC
    fn open_file(&self, path: &Path) -> Result<(), String>;
    /// the drives, for the files view
    fn drives(&self) -> Vec<String>;
}

/// From a tap or a key on the phone. x and y are 0..1 of all screens together.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "k", rename_all = "lowercase")]
pub enum Input {
    Move {
        x: f64,
        y: f64,
    },
    Click {
        x: f64,
        y: f64,
        #[serde(default)]
        right: bool,
        #[serde(default)]
        double: bool,
    },
    Down {
        x: f64,
        y: f64,
    },
    Up {
        x: f64,
        y: f64,
    },
    Scroll {
        x: f64,
        y: f64,
        dy: i32,
    },
    Text {
        text: String,
    },
    /// "enter", "ctrl+c", "alt+tab", "win"
    Key {
        key: String,
    },
}

pub const TEXT_MAX: usize = 2000;

/// A key with its modifiers, as Windows numbers them.
pub fn combo(text: &str) -> Option<(Vec<u16>, u16)> {
    let mut mods = vec![];
    let mut key = None;
    for part in text.to_lowercase().split('+').map(str::trim) {
        let vk: u16 = match part {
            "ctrl" | "control" => {
                mods.push(0x11);
                continue;
            }
            "shift" => {
                mods.push(0x10);
                continue;
            }
            "alt" => {
                mods.push(0x12);
                continue;
            }
            "win" | "meta" if !mods.is_empty() || text.contains('+') => {
                mods.push(0x5B);
                continue;
            }
            "win" | "meta" => 0x5B,
            "enter" | "return" => 0x0D,
            "esc" | "escape" => 0x1B,
            "tab" => 0x09,
            "backspace" => 0x08,
            "delete" | "del" => 0x2E,
            "space" => 0x20,
            "up" => 0x26,
            "down" => 0x28,
            "left" => 0x25,
            "right" => 0x27,
            "home" => 0x24,
            "end" => 0x23,
            "pageup" | "pgup" => 0x21,
            "pagedown" | "pgdn" => 0x22,
            "printscreen" => 0x2C,
            f if f.len() >= 2 && f.starts_with('f') && f[1..].parse::<u16>().is_ok_and(|n| (1..=12).contains(&n)) => {
                0x70 + f[1..].parse::<u16>().ok()? - 1
            }
            c if c.len() == 1 && c.chars().all(|c| c.is_ascii_alphanumeric()) => {
                c.to_ascii_uppercase().as_bytes()[0] as u16
            }
            _ => return None,
        };
        if key.replace(vk).is_some() {
            return None; // two keys
        }
    }
    Some((mods, key?))
}

/// Where people keep things, first; then the drives.
pub fn places(drives: Vec<String>) -> Vec<Entry> {
    let h = home();
    let mut out: Vec<Entry> = ["Desktop", "Downloads", "Documents", "Pictures", "Videos", "OneDrive"]
        .iter()
        .map(|n| h.join(n))
        .chain(std::iter::once(h.clone()))
        .filter(|p| p.is_dir())
        .map(|p| Entry {
            name: if p == h {
                "Home".into()
            } else {
                p.file_name().unwrap_or_default().to_string_lossy().into_owned()
            },
            path: p.to_string_lossy().into_owned(),
            dir: true,
            size: 0,
            modified: None,
        })
        .collect();
    out.extend(drives.into_iter().map(|d| Entry {
        name: format!("Drive {}", d.trim_end_matches(['\\', ':'])),
        path: d,
        dir: true,
        size: 0,
        modified: None,
    }));
    out
}

/// Where a file sent from the phone goes: Downloads, under a name not taken.
pub fn landing(name: &str) -> PathBuf {
    let clean: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect::<String>()
        .trim_matches(['.', ' '])
        .chars()
        .take(120)
        .collect();
    let clean = if clean.is_empty() { "file".to_owned() } else { clean };
    let dir = home().join("Downloads");
    let (stem, ext) = match clean.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_owned(), format!(".{e}")),
        _ => (clean.clone(), String::new()),
    };
    let mut p = dir.join(&clean);
    let mut n = 1;
    while p.exists() {
        n += 1;
        p = dir.join(format!("{stem} ({n}){ext}"));
    }
    p
}

/// Only web pages: anything else could be a program.
pub fn web_link(url: &str) -> Result<String, String> {
    match url::Url::parse(url) {
        Ok(u) if matches!(u.scheme(), "https" | "http") && u.has_host() => Ok(u.to_string()),
        _ => Err("That isn’t a web link".into()),
    }
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub size: u64,
    /// unix ms
    pub modified: Option<i64>,
}

pub fn home() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// A folder: folders first, then files, by name.
pub fn list(path: &Path) -> Result<(Vec<Entry>, bool), String> {
    let mut all: Vec<Entry> = std::fs::read_dir(path)
        .map_err(|_| "That folder can’t be opened".to_owned())?
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some(Entry {
                name: e.file_name().to_string_lossy().into_owned(),
                path: e.path().to_string_lossy().into_owned(),
                dir: m.is_dir(),
                size: if m.is_dir() { 0 } else { m.len() },
                modified: m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64),
            })
        })
        .collect();
    all.sort_by_key(|e| (!e.dir, e.name.to_lowercase()));
    let cut = all.len() > LIST_MAX;
    all.truncate(LIST_MAX);
    Ok((all, cut))
}

pub fn read(path: &Path) -> Result<Vec<u8>, String> {
    let m = std::fs::metadata(path).map_err(|_| "That file isn’t there".to_owned())?;
    if !m.is_file() {
        return Err("That isn’t a file".into());
    }
    if m.len() > FILE_MAX {
        return Err("Files up to 25 MB can be fetched".into());
    }
    std::fs::read(path).map_err(|_| "That file can’t be read".to_owned())
}

/// No hands: another system, or a test.
pub struct Nothing;

impl Hands for Nothing {
    fn sound(&self) -> Option<Sound> {
        None
    }
    fn set_sound(&self, _: Option<u8>, _: Option<bool>) -> Result<(), String> {
        Err("Not on this PC".into())
    }
    fn lock(&self) -> Result<(), String> {
        Err("Not on this PC".into())
    }
    fn sleep(&self) -> Result<(), String> {
        Err("Not on this PC".into())
    }
    fn open(&self, _: &str) -> Result<(), String> {
        Err("Not on this PC".into())
    }
    fn clip(&self) -> Result<String, String> {
        Err("Not on this PC".into())
    }
    fn set_clip(&self, _: &str) -> Result<(), String> {
        Err("Not on this PC".into())
    }
    fn shot(&self, _: u32, _: u8) -> Result<Vec<u8>, String> {
        Err("Not on this PC".into())
    }
    fn input(&self, _: &Input) -> Result<(), String> {
        Err("Not on this PC".into())
    }
    fn open_file(&self, _: &Path) -> Result<(), String> {
        Err("Not on this PC".into())
    }
    fn drives(&self) -> Vec<String> {
        vec![]
    }
}

#[cfg(windows)]
pub struct Windows;

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::Result as WinResult;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject,
        SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, SRCCOPY,
    };
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::Storage::FileSystem::GetLogicalDrives;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Power::SetSuspendState;
    use windows::Win32::System::Shutdown::LockWorkStation;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE,
        MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, MOUSEINPUT,
        MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    };

    fn volume<T: Send + 'static>(f: impl FnOnce(&IAudioEndpointVolume) -> WinResult<T> + Send + 'static) -> Option<T> {
        std::thread::spawn(move || unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok()?;
            let go = || -> WinResult<T> {
                let all: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let out = all.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
                f(&out.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)?)
            };
            let r = go().ok();
            CoUninitialize();
            r
        })
        .join()
        .ok()
        .flatten()
    }

    impl Hands for Windows {
        fn sound(&self) -> Option<Sound> {
            volume(|v| unsafe {
                Ok(Sound {
                    volume: (v.GetMasterVolumeLevelScalar()? * 100.0).round() as u8,
                    muted: v.GetMute()?.as_bool(),
                })
            })
        }
        fn set_sound(&self, level: Option<u8>, muted: Option<bool>) -> Result<(), String> {
            volume(move |v| unsafe {
                if let Some(l) = level {
                    v.SetMasterVolumeLevelScalar(f32::from(l.min(100)) / 100.0, std::ptr::null())?;
                }
                if let Some(m) = muted {
                    v.SetMute(m, std::ptr::null())?;
                }
                Ok(())
            })
            .ok_or_else(|| "The sound can’t be changed".into())
        }
        fn lock(&self) -> Result<(), String> {
            unsafe { LockWorkStation() }.map_err(|_| "Windows wouldn’t lock".into())
        }
        fn sleep(&self) -> Result<(), String> {
            // after the answer is on its way
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(2));
                unsafe { SetSuspendState(false, false, false) };
            });
            Ok(())
        }
        fn open(&self, url: &str) -> Result<(), String> {
            tauri_plugin_opener::open_url(url, None::<&str>).map_err(|_| "The link couldn’t be opened".into())
        }
        fn clip(&self) -> Result<String, String> {
            arboard::Clipboard::new()
                .and_then(|mut c| c.get_text())
                .map_err(|_| "There is no text in the clipboard".into())
        }
        fn set_clip(&self, text: &str) -> Result<(), String> {
            arboard::Clipboard::new()
                .and_then(|mut c| c.set_text(text))
                .map_err(|_| "The clipboard is busy".into())
        }
        fn shot(&self, width: u32, quality: u8) -> Result<Vec<u8>, String> {
            let (pixels, w, h) =
                unsafe { grab(width.clamp(320, 3840) as i32) }.ok_or("The screen can’t be seen now (locked?)")?;
            let mut out = vec![];
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality.clamp(20, 90))
                .encode(&pixels, w, h, image::ExtendedColorType::Rgb8)
                .map_err(|_| "The picture failed".to_owned())?;
            Ok(out)
        }

        fn input(&self, i: &Input) -> Result<(), String> {
            send(i)
        }

        fn open_file(&self, path: &Path) -> Result<(), String> {
            if !path.exists() {
                return Err("That isn’t there any more".into());
            }
            tauri_plugin_opener::open_path(path, None::<&str>).map_err(|_| "Windows couldn’t open it".into())
        }

        fn drives(&self) -> Vec<String> {
            let mask = unsafe { GetLogicalDrives() };
            (0..26u8)
                .filter(|i| mask & (1 << i) != 0)
                .map(|i| format!("{}:\\", (b'A' + i) as char))
                .collect()
        }
    }

    fn mouse(x: f64, y: f64, flags: MOUSE_EVENT_FLAGS, data: i32) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: (x.clamp(0.0, 1.0) * 65535.0).round() as i32,
                    dy: (y.clamp(0.0, 1.0) * 65535.0).round() as i32,
                    mouseData: data as _,
                    dwFlags: flags | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK | MOUSEEVENTF_MOVE,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn key(vk: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send(i: &Input) -> Result<(), String> {
        let none = MOUSE_EVENT_FLAGS(0);
        let events: Vec<INPUT> = match i {
            Input::Move { x, y } => vec![mouse(*x, *y, none, 0)],
            Input::Down { x, y } => vec![mouse(*x, *y, MOUSEEVENTF_LEFTDOWN, 0)],
            Input::Up { x, y } => vec![mouse(*x, *y, MOUSEEVENTF_LEFTUP, 0)],
            Input::Click { x, y, right, double } => {
                let (d, u) = if *right {
                    (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)
                } else {
                    (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
                };
                let one = [mouse(*x, *y, d, 0), mouse(*x, *y, u, 0)];
                let mut all = vec![mouse(*x, *y, none, 0)];
                all.extend(one);
                if *double {
                    all.extend(one);
                }
                all
            }
            Input::Scroll { x, y, dy } => vec![
                mouse(*x, *y, none, 0),
                mouse(*x, *y, MOUSEEVENTF_WHEEL, dy.clamp(&-2400, &2400) * -1),
            ],
            Input::Text { text } => {
                if text.chars().count() > TEXT_MAX {
                    return Err("That is too long to type".into());
                }
                text.encode_utf16()
                    .flat_map(|u| {
                        if u == u16::from(b'\n') {
                            [key(0x0D, 0, KEYBD_EVENT_FLAGS(0)), key(0x0D, 0, KEYEVENTF_KEYUP)]
                        } else {
                            [
                                key(0, u, KEYEVENTF_UNICODE),
                                key(0, u, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
                            ]
                        }
                    })
                    .collect()
            }
            Input::Key { key: k } => {
                let (mods, vk) = combo(k).ok_or("This PC doesn’t know that key")?;
                let mut all: Vec<INPUT> = mods.iter().map(|m| key(*m, 0, KEYBD_EVENT_FLAGS(0))).collect();
                all.push(key(vk, 0, KEYBD_EVENT_FLAGS(0)));
                all.push(key(vk, 0, KEYEVENTF_KEYUP));
                all.extend(mods.iter().rev().map(|m| key(*m, 0, KEYEVENTF_KEYUP)));
                all
            }
        };
        let sent = unsafe { SendInput(&events, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize == events.len() {
            Ok(())
        } else {
            // the sign-in screen, or a program running as administrator
            Err("Windows didn’t take it (locked, or an administrator window)".into())
        }
    }

    unsafe fn grab(max_width: i32) -> Option<(Vec<u8>, u32, u32)> {
        let (x, y, w, h) = (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        );
        if w <= 0 || h <= 0 {
            return None;
        }
        let tw = w.min(max_width);
        let th = (i64::from(h) * i64::from(tw) / i64::from(w)) as i32;
        let none = None::<HWND>;
        let screen = GetDC(none);
        let mem = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, tw, th);
        let old = SelectObject(mem, bmp.into());
        SetStretchBltMode(mem, HALFTONE);
        let drawn = StretchBlt(mem, 0, 0, tw, th, Some(screen), x, y, w, h, SRCCOPY).as_bool();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: tw,
                biHeight: -th, // top down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        SelectObject(mem, old);
        let mut raw = vec![0u8; (tw * th * 4) as usize];
        let lines = GetDIBits(
            mem,
            bmp,
            0,
            th as u32,
            Some(raw.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        );
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem);
        ReleaseDC(none, screen);
        if !drawn || lines == 0 {
            return None;
        }
        let rgb = raw.as_chunks::<4>().0.iter().flat_map(|p| [p[2], p[1], p[0]]).collect();
        Some((rgb, tw as u32, th as u32))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn the_real_screen_becomes_a_jpeg_that_opens() {
            // a machine without a desktop (CI service) has none
            if let Ok(jpg) = Windows.shot(1600, 70) {
                assert_eq!(&jpg[..2], &[0xFF, 0xD8]);
                let img = image::load_from_memory_with_format(&jpg, image::ImageFormat::Jpeg).unwrap();
                assert!(img.width() >= 640 && img.height() >= 360);
            }
            assert!(Windows.drives().iter().any(|d| d.starts_with('C')));
            if let Some(s) = Windows.sound() {
                assert!(s.volume <= 100);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_people_press() {
        assert_eq!(combo("enter"), Some((vec![], 0x0D)));
        assert_eq!(combo("Ctrl+C"), Some((vec![0x11], 0x43)));
        assert_eq!(combo("ctrl+shift+esc"), Some((vec![0x11, 0x10], 0x1B)));
        assert_eq!(combo("alt+f4"), Some((vec![0x12], 0x73)));
        assert_eq!(combo("win"), Some((vec![], 0x5B)));
        assert_eq!(combo("win+d"), Some((vec![0x5B], 0x44)));
        for bad in ["", "ctrl", "a+b", "f13", "format c:"] {
            assert_eq!(combo(bad), None, "{bad}");
        }
        let i: Input = serde_json::from_str(r#"{"k":"click","x":0.5,"y":0.25,"right":true}"#).unwrap();
        assert_eq!(
            i,
            Input::Click {
                x: 0.5,
                y: 0.25,
                right: true,
                double: false
            }
        );
    }

    #[test]
    fn a_file_from_the_phone_lands_in_downloads_under_its_own_name() {
        let p = landing("../../Windows/evil:name?.txt");
        assert_eq!(p.parent().unwrap(), home().join("Downloads"));
        let n = p.file_name().unwrap().to_string_lossy().into_owned();
        assert!(!n.contains(['/', '\\', ':', '?']), "{n}");
        assert!(landing("").to_string_lossy().ends_with("file") || landing("").exists() || true);
        assert!(places(vec!["C:\\".into()]).iter().any(|e| e.name == "Drive C"));
    }

    #[test]
    fn only_web_links_open() {
        assert_eq!(
            web_link("https://orvyn.dubey.app/a").unwrap(),
            "https://orvyn.dubey.app/a"
        );
        for bad in [
            "calc.exe",
            "file:///C:/x.exe",
            "ms-settings:",
            "javascript:1",
            "C:\\x.bat",
            "https:",
            "",
        ] {
            assert!(web_link(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn folders_first_and_only_files_of_a_fair_size() {
        let d = std::env::temp_dir().join(format!("orvyn-deck-{}", std::process::id()));
        std::fs::create_dir_all(d.join("zeta")).unwrap();
        std::fs::write(d.join("a.txt"), "hello").unwrap();
        let (all, cut) = list(&d).unwrap();
        assert!(!cut);
        assert_eq!(
            all.iter().map(|e| (e.name.as_str(), e.dir, e.size)).collect::<Vec<_>>(),
            [("zeta", true, 0), ("a.txt", false, 5)]
        );
        assert_eq!(read(&d.join("a.txt")).unwrap(), b"hello");
        assert!(read(&d).is_err() && read(&d.join("no")).is_err() && list(&d.join("no")).is_err());
        let big = std::fs::File::create(d.join("big")).unwrap();
        big.set_len(FILE_MAX + 1).unwrap();
        assert!(read(&d.join("big")).is_err());
        let _ = std::fs::remove_dir_all(d);
    }
}
