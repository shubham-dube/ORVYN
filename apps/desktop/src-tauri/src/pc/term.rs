//! The shells: real ones (ConPTY), which keep running when the phone goes away. Each keeps its latest output, so a
//! device that comes back goes on where it was.
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;

pub const TERMS_MAX: usize = 8;
pub const KEPT: usize = 256 * 1024;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Shell {
    pub id: &'static str,
    pub name: &'static str,
    #[serde(skip)]
    path: String,
    #[serde(skip)]
    args: &'static [&'static str],
}

/// What is installed, the best first.
pub fn shells() -> Vec<Shell> {
    let env = |k: &str| std::env::var(k).unwrap_or_default();
    let shell = |id, name, path: String, args| Shell { id, name, path, args };
    if !cfg!(windows) {
        return vec![shell("sh", "Shell", "/bin/sh".into(), &[])];
    }
    let (root, files, local) = (env("SystemRoot"), env("ProgramFiles"), env("LOCALAPPDATA"));
    [
        shell(
            "pwsh",
            "PowerShell 7",
            format!("{files}\\PowerShell\\7\\pwsh.exe"),
            &["-NoLogo"][..],
        ),
        shell(
            "pwsh",
            "PowerShell 7",
            format!("{local}\\Microsoft\\WindowsApps\\pwsh.exe"),
            &["-NoLogo"],
        ),
        shell(
            "powershell",
            "PowerShell",
            format!("{root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
            &["-NoLogo"],
        ),
        shell("cmd", "Command Prompt", format!("{root}\\System32\\cmd.exe"), &[]),
        shell(
            "bash",
            "Git Bash",
            format!("{files}\\Git\\bin\\bash.exe"),
            &["--login", "-i"],
        ),
    ]
    .into_iter()
    .filter(|s| std::path::Path::new(&s.path).symlink_metadata().is_ok())
    .fold(vec![], |mut all, s| {
        if !all.iter().any(|x: &Shell| x.id == s.id) {
            all.push(s);
        }
        all
    })
}

/// The latest output, addressed by how much came before it.
#[derive(Default)]
pub struct Ring {
    buf: VecDeque<u8>,
    end: u64,
}

impl Ring {
    pub fn push(&mut self, b: &[u8]) {
        self.buf.extend(b);
        self.end += b.len() as u64;
        let over = self.buf.len().saturating_sub(KEPT);
        self.buf.drain(..over);
    }
    pub fn end(&self) -> u64 {
        self.end
    }
    pub fn start(&self) -> u64 {
        self.end - self.buf.len() as u64
    }
    /// Whole characters from `at`, at most `max` bytes: the text, where it really began, where it ends.
    pub fn read(&self, at: u64, max: usize) -> (String, u64, u64) {
        let mut from = at.clamp(self.start(), self.end);
        // a place that was dropped may be mid-character
        if from > at {
            while from < self.end && self.byte(from) & 0xC0 == 0x80 {
                from += 1;
            }
        }
        let n = max.min((self.end - from) as usize);
        let skip = (from - self.start()) as usize;
        let raw: Vec<u8> = self.buf.iter().skip(skip).take(n).copied().collect();
        // an unfinished last character waits for its rest
        let whole = match std::str::from_utf8(&raw) {
            Err(e) if e.error_len().is_none() => e.valid_up_to(),
            _ => raw.len(),
        };
        (
            String::from_utf8_lossy(&raw[..whole]).into_owned(),
            from,
            from + whole as u64,
        )
    }
    fn byte(&self, at: u64) -> u8 {
        self.buf[(at - self.start()) as usize]
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct TermView {
    pub id: String,
    pub name: String,
    pub since: i64,
    pub exit: Option<u32>,
    /// tells me when what runs in it ends
    pub watch: bool,
}

/// "Tell me when done": whether something ran since it was asked, and for how many looks nothing has.
#[derive(Default)]
struct Watch {
    ran: bool,
    quiet: u8,
}

impl Watch {
    /// True once, when it has ended. A moment between two steps of a build is not the end.
    fn look(&mut self, busy: bool) -> bool {
        if busy {
            (self.ran, self.quiet) = (true, 0);
            return false;
        }
        self.quiet = self.quiet.saturating_add(1);
        self.ran && self.quiet >= 3
    }
}

/// Every process and its parent, but not the consoles themselves.
#[cfg(windows)]
pub fn children() -> Vec<u32> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut all = vec![];
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return all;
        };
        let mut e = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut more = Process32FirstW(snap, &mut e).is_ok();
        while more {
            let end = e.szExeFile.iter().position(|c| *c == 0).unwrap_or(e.szExeFile.len());
            let name = String::from_utf16_lossy(&e.szExeFile[..end]).to_lowercase();
            if name != "conhost.exe" && name != "openconsole.exe" {
                all.push(e.th32ParentProcessID);
            }
            more = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    all
}

#[cfg(not(windows))]
pub fn children() -> Vec<u32> {
    vec![]
}

pub struct Term {
    pub id: String,
    name: String,
    since: i64,
    pub ring: Mutex<Ring>,
    exit: Mutex<Option<u32>>,
    pid: Option<u32>,
    watch: Mutex<Option<Watch>>,
    input: mpsc::Sender<Vec<u8>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl Term {
    pub fn view(&self) -> TermView {
        TermView {
            id: self.id.clone(),
            name: self.name.clone(),
            since: self.since,
            exit: *self.exit.lock().unwrap(),
            watch: self.watch.lock().unwrap().is_some(),
        }
    }
    pub fn exit(&self) -> Option<u32> {
        *self.exit.lock().unwrap()
    }
    pub fn set_watch(&self, on: bool) {
        *self.watch.lock().unwrap() = on.then(Watch::default);
    }
    pub fn type_in(&self, s: &str) {
        let _ = self.input.send(s.as_bytes().to_vec());
    }
    pub fn resize(&self, cols: u16, rows: u16) {
        if let Some(m) = self.master.lock().unwrap().as_ref() {
            let _ = m.resize(size(cols, rows));
        }
    }
    fn kill(&self) {
        let _ = self.killer.lock().unwrap().kill();
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(10, 400),
        rows: rows.clamp(4, 200),
        pixel_width: 0,
        pixel_height: 0,
    }
}

pub struct Terms {
    list: Mutex<Vec<Arc<Term>>>,
    /// something new to send
    changed: Arc<dyn Fn() + Send + Sync>,
}

impl Terms {
    pub fn new(changed: Arc<dyn Fn() + Send + Sync>) -> Self {
        Self {
            list: Mutex::default(),
            changed,
        }
    }

    pub fn list(&self) -> Vec<TermView> {
        self.list.lock().unwrap().iter().map(|t| t.view()).collect()
    }

    pub fn get(&self, id: &str) -> Option<Arc<Term>> {
        self.list.lock().unwrap().iter().find(|t| t.id == id).cloned()
    }

    pub fn start(&self, shell: Option<&str>, cols: u16, rows: u16, now: i64) -> Result<Arc<Term>, String> {
        let mut list = self.list.lock().unwrap();
        if list.iter().filter(|t| t.exit().is_none()).count() >= TERMS_MAX {
            return Err(format!("{TERMS_MAX} terminals are open. Close one first."));
        }
        list.retain(|t| t.exit().is_none());
        let all = shells();
        let sh = match shell {
            Some(id) => all.iter().find(|s| s.id == id),
            None => all.first(),
        }
        .ok_or("That shell isn’t on this PC")?;
        let fail = |_| "Windows wouldn’t start the shell".to_owned();
        let pair = native_pty_system().openpty(size(cols, rows)).map_err(fail)?;
        let mut cmd = CommandBuilder::new(&sh.path);
        cmd.args(sh.args);
        cmd.env("TERM", "xterm-256color");
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            cmd.cwd(home);
        }
        let mut child = pair.slave.spawn_command(cmd).map_err(fail)?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(fail)?;
        let mut writer = pair.master.take_writer().map_err(fail)?;
        let (input, typed) = mpsc::channel::<Vec<u8>>();
        let term = Arc::new(Term {
            id: uuid::Uuid::now_v7().to_string(),
            name: sh.name.into(),
            since: now,
            ring: Mutex::default(),
            exit: Mutex::new(None),
            pid: child.process_id(),
            watch: Mutex::new(None),
            input: input.clone(),
            master: Mutex::new(Some(pair.master)),
            killer: Mutex::new(child.clone_killer()),
        });
        // a shell that isn't reading may block this thread, nothing else
        std::thread::spawn(move || {
            while let Ok(b) = typed.recv() {
                if writer.write_all(&b).and_then(|_| writer.flush()).is_err() {
                    break;
                }
            }
        });
        let (t, changed) = (term.clone(), self.changed.clone());
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut asked = false;
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let mut out = &buf[..n];
                let cut;
                // the console asks once where the cursor is, and waits; several devices would each answer
                if !asked {
                    if let Some(at) = out.windows(4).position(|w| w == b"\x1b[6n") {
                        asked = true;
                        let _ = input.send(b"\x1b[1;1R".to_vec());
                        cut = [&out[..at], &out[at + 4..]].concat();
                        out = &cut;
                    }
                }
                t.ring.lock().unwrap().push(out);
                changed();
            }
        });
        let (t, changed) = (term.clone(), self.changed.clone());
        std::thread::spawn(move || {
            let code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
            std::thread::sleep(Duration::from_millis(200)); // its last words
            *t.exit.lock().unwrap() = Some(code);
            t.master.lock().unwrap().take();
            changed();
        });
        list.push(term.clone());
        Ok(term)
    }

    /// Those that were watched and have ended, each once.
    pub fn ended(&self) -> Vec<String> {
        let list: Vec<_> = self.list.lock().unwrap().clone();
        let watched: Vec<_> = list.into_iter().filter(|t| t.watch.lock().unwrap().is_some()).collect();
        if watched.is_empty() {
            return vec![]; // looking costs nothing when nobody waits
        }
        let parents = children();
        let mut done = vec![];
        for t in watched {
            let busy = t.pid.is_some_and(|p| parents.contains(&p));
            let mut w = t.watch.lock().unwrap();
            if t.exit().is_some() || w.as_mut().is_some_and(|w| w.look(busy)) {
                *w = None;
                done.push(t.id.clone());
            }
        }
        done
    }

    pub fn close(&self, id: &str) {
        let mut list = self.list.lock().unwrap();
        if let Some(i) = list.iter().position(|t| t.id == id) {
            list.remove(i).kill();
        }
    }

    pub fn close_all(&self) {
        for t in self.list.lock().unwrap().drain(..) {
            t.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ring_keeps_the_latest_and_never_cuts_a_character() {
        let mut r = Ring::default();
        r.push("aé".as_bytes());
        r.push(&"✓".as_bytes()[..2]);
        assert_eq!(r.read(0, 99), ("aé".into(), 0, 3));
        r.push(&"✓".as_bytes()[2..]);
        assert_eq!(r.read(3, 99), ("✓".into(), 3, 6));
        assert_eq!(r.read(0, 2), ("a".into(), 0, 1));
        r.push("é".repeat(KEPT).as_bytes());
        assert_eq!(r.end(), 6 + 2 * KEPT as u64);
        let (text, from, end) = r.read(0, 5);
        assert_eq!((text.as_str(), from, end), ("éé", r.start(), r.start() + 4));
        r.push(b"x"); // now the oldest byte kept is half a character
        assert_eq!(r.read(0, 3).0, "é");
        assert_eq!(r.read(r.end(), 5), (String::new(), r.end(), r.end()));
    }

    #[test]
    fn done_means_something_ran_and_then_nothing_for_a_while() {
        let mut w = Watch::default();
        assert!(!(0..9).any(|_| w.look(false))); // asked before starting it
        assert!(!w.look(true) && !w.look(false) && !w.look(false) && !w.look(true));
        assert!(!w.look(false) && !w.look(false) && w.look(false));
    }

    #[cfg(windows)]
    #[test]
    fn a_watched_command_says_when_it_ends_once() {
        let terms = Terms::new(Arc::new(|| ()));
        let t = terms.start(Some("cmd"), 80, 24, 0).unwrap();
        t.set_watch(true);
        std::thread::sleep(Duration::from_millis(500));
        assert!(terms.ended().is_empty());
        t.type_in("ping -n 4 127.0.0.1\r");
        let mut looks = 0;
        let done = loop {
            std::thread::sleep(Duration::from_millis(300));
            let d = terms.ended();
            looks += 1;
            if !d.is_empty() || looks > 60 {
                break d;
            }
        };
        assert_eq!(done, vec![t.id.clone()]);
        assert!(looks > 5, "{looks}"); // not while it ran
        assert!(!t.view().watch && terms.ended().is_empty());
        terms.close_all();
    }

    #[test]
    fn a_real_shell_runs_and_ends() {
        let terms = Terms::new(Arc::new(|| ()));
        let t = terms.start(None, 80, 24, 0).unwrap();
        t.type_in("echo one-$(20+3)-two; exit 7\r");
        let end = std::time::Instant::now() + Duration::from_secs(30);
        while t.exit().is_none() && std::time::Instant::now() < end {
            std::thread::sleep(Duration::from_millis(50));
        }
        let (text, ..) = t.ring.lock().unwrap().read(0, KEPT);
        assert!(!cfg!(windows) || text.contains("one-23-two"), "{text:?}");
        assert_eq!(t.exit(), Some(7), "{text:?}");
        terms.close_all();
        assert!(terms.list().is_empty());
    }
}
