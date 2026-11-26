//! JobOS from the tray (spec 0021 #8): start, stop, status. Only the folder I chose, only what is started here is stopped.
use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

pub const WEB: &str = "http://localhost:3000";

/// The folder must really be JobOS: nothing else is ever run.
pub fn is_jobos(dir: &Path) -> bool {
    let named = std::fs::read_to_string(dir.join("pyproject.toml")).is_ok_and(|t| t.to_lowercase().contains("jobos"));
    named && dir.join("docker-compose.yml").is_file() && dir.join("apps").join("web").is_dir()
}

/// `KEY=value # note`, as JobOS's own start script reads it.
pub fn env_of(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|l| l.split_once('='))
        .filter(|(k, _)| !k.is_empty() && k.chars().all(|c| c.is_ascii_uppercase() || c == '_'))
        .map(|(k, v)| {
            let cut = v
                .char_indices()
                .find(|(i, c)| *c == '#' && *i > 0 && v[..*i].ends_with(char::is_whitespace))
                .map_or(v.len(), |(i, _)| i);
            (k.to_owned(), v[..cut].trim_end().to_owned())
        })
        .collect()
}

fn listening(port: u16) -> bool {
    let at: SocketAddr = ([127, 0, 0, 1], port).into();
    TcpStream::connect_timeout(&at, Duration::from_millis(300)).is_ok()
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub struct Status {
    pub server: bool,
    pub web: bool,
}

impl Status {
    pub fn now() -> Self {
        Self {
            server: listening(8000),
            web: listening(3000),
        }
    }
    pub fn words(self) -> &'static str {
        match (self.server, self.web) {
            (true, true) => "JobOS: running",
            (true, false) => "JobOS: server only",
            (false, true) => "JobOS: dashboard only",
            (false, false) => "JobOS: stopped",
        }
    }
}

#[derive(Default)]
pub struct JobOs {
    running: Vec<Child>,
}

fn run(dir: &Path, program: &str, args: &[&str], env: &HashMap<String, String>) -> std::io::Result<Child> {
    let mut c = Command::new(program);
    c.args(args)
        .current_dir(dir)
        .envs(env)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // no window
    }
    c.spawn()
}

impl JobOs {
    /// Takes a few seconds: off the main thread.
    pub fn start(&mut self, dir: &Path) -> Result<(), String> {
        if !is_jobos(dir) {
            return Err("That folder isn’t JobOS any more. Choose it again.".into());
        }
        if Status::now().server {
            return Err("JobOS is already running".into());
        }
        let env = env_of(&std::fs::read_to_string(dir.join(".env")).unwrap_or_default());
        let missing = |what: &'static str| move |_| format!("{what} couldn’t be started");
        let db = run(dir, "docker", &["compose", "up", "-d", "postgres"], &env)
            .and_then(|mut c| c.wait())
            .map_err(missing("Docker"))?;
        if !db.success() {
            return Err("JobOS’s database didn’t start. Is Docker running?".into());
        }
        self.running.push(
            run(dir, "uv", &["run", "jobos", "serve", "--role", "all"], &env).map_err(missing("JobOS’s server"))?,
        );
        std::thread::sleep(Duration::from_secs(8));
        let web: PathBuf = dir.join("apps").join("web");
        self.running
            .push(run(&web, "cmd", &["/c", "pnpm", "start"], &env).map_err(missing("JobOS’s dashboard"))?);
        let runner = std::env::var("LOCALAPPDATA").map(|d| Path::new(&d).join("JobOS").join("runner.json"));
        if runner.is_ok_and(|p| p.is_file()) {
            self.running
                .push(run(dir, "uv", &["run", "jobos-runner", "run"], &env).map_err(missing("JobOS’s runner"))?);
        }
        Ok(())
    }

    pub fn mine(&self) -> bool {
        !self.running.is_empty()
    }

    /// Each with what it started.
    pub fn stop(&mut self) -> Result<(), String> {
        if self.running.is_empty() {
            return Err("JobOS wasn’t started from ORVYN, so ORVYN doesn’t stop it".into());
        }
        for mut c in self.running.drain(..).rev() {
            // one that ended by itself must not be looked up by a number someone else has now
            if matches!(c.try_wait(), Ok(Some(_))) {
                continue;
            }
            if cfg!(windows) {
                let pid = c.id().to_string();
                let _ = run(Path::new("."), "taskkill", &["/PID", &pid, "/T", "/F"], &HashMap::new())
                    .and_then(|mut k| k.wait());
            }
            let _ = c.kill();
            let _ = c.wait();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_jobos_folder_runs() {
        let d = std::env::temp_dir().join(format!("orvyn-jobos-{}", std::process::id()));
        std::fs::create_dir_all(d.join("apps").join("web")).unwrap();
        assert!(!is_jobos(&d));
        assert!(JobOs::default().start(&d).is_err());
        std::fs::write(d.join("pyproject.toml"), "[project]\nname = \"jobos\"").unwrap();
        std::fs::write(d.join("docker-compose.yml"), "").unwrap();
        assert!(is_jobos(&d));
        assert!(JobOs::default().stop().is_err());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn its_settings_are_read_as_its_own_script_does() {
        let e = env_of("# note\nJOBOS_API_URL=http://x:8000  # local\nJOBOS_KEY=a#b=c\nlower=1\n=x\n");
        assert_eq!(e.len(), 2);
        assert_eq!(e["JOBOS_API_URL"], "http://x:8000");
        assert_eq!(e["JOBOS_KEY"], "a#b=c");
    }

    #[cfg(windows)]
    #[test]
    fn stopping_ends_what_was_started_and_its_children() {
        let mut j = JobOs::default();
        let c = run(Path::new("."), "cmd", &["/c", "ping -n 60 127.0.0.1"], &HashMap::new()).unwrap();
        let pid = c.id();
        j.running.push(c);
        std::thread::sleep(Duration::from_millis(400));
        assert!(crate::pc::term::children().contains(&pid));
        j.stop().unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert!(!crate::pc::term::children().contains(&pid) && !j.mine());
    }
}
