//! The remote deck (spec 0021 #11): see the screen, lock, sleep, volume, open a link, the clipboard both ways, fetch a
//! file. Only inside a session that gave the PIN.
use std::path::{Path, PathBuf};

use serde::Serialize;

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
    /// a JPEG of every screen
    fn shot(&self) -> Result<Vec<u8>, String>;
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
    fn shot(&self) -> Result<Vec<u8>, String> {
        Err("Not on this PC".into())
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
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Power::SetSuspendState;
    use windows::Win32::System::Shutdown::LockWorkStation;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    };

    const SHOT_WIDTH: i32 = 1600;

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
        fn shot(&self) -> Result<Vec<u8>, String> {
            let (pixels, w, h) = unsafe { grab() }.ok_or("The screen can’t be seen now (locked?)")?;
            let mut out = vec![];
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 70)
                .encode(&pixels, w, h, image::ExtendedColorType::Rgb8)
                .map_err(|_| "The picture failed".to_owned())?;
            Ok(out)
        }
    }

    unsafe fn grab() -> Option<(Vec<u8>, u32, u32)> {
        let (x, y, w, h) = (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        );
        if w <= 0 || h <= 0 {
            return None;
        }
        let tw = w.min(SHOT_WIDTH * ((w + 2559) / 2560).max(1));
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
            if let Ok(jpg) = Windows.shot() {
                assert_eq!(&jpg[..2], &[0xFF, 0xD8]);
                let img = image::load_from_memory_with_format(&jpg, image::ImageFormat::Jpeg).unwrap();
                assert!(img.width() >= 640 && img.height() >= 360);
            }
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
