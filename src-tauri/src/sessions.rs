#[cfg(unix)]
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
#[cfg(unix)]
use std::time::Duration;
use std::{
    collections::HashMap,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
};
use tauri::Emitter;

#[cfg(windows)]
use super::win_conpty;
use super::{stream_terminal_output, CommandStatusPayload, TerminalOutputPayload};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ShellOption {
    pub id: String,
    pub label: String,
    pub available: bool,
}

fn find_in_path(names: &[&str]) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn windows_system_root() -> PathBuf {
    PathBuf::from(std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()))
}

#[cfg(windows)]
fn find_windows_pwsh() -> Option<PathBuf> {
    if let Some(found) = find_in_path(&["pwsh.exe"]) {
        return Some(found);
    }
    for env_key in ["ProgramW6432", "ProgramFiles"] {
        if let Ok(root) = std::env::var(env_key) {
            let candidate = PathBuf::from(root).join("PowerShell\\7\\pwsh.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn find_windows_powershell() -> Option<PathBuf> {
    let candidate = windows_system_root().join("System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    candidate.is_file().then_some(candidate)
}

#[cfg(windows)]
fn find_windows_git_bash() -> Option<PathBuf> {
    if let Some(git_exe) = find_in_path(&["git.exe"]) {
        if let Some(git_root) = git_exe.parent().and_then(|parent| parent.parent()) {
            let candidate = git_root.join("bin\\bash.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    for env_key in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(root) = std::env::var(env_key) {
            let candidate = PathBuf::from(root).join("Git\\bin\\bash.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let candidate = PathBuf::from(local_app_data).join("Programs\\Git\\bin\\bash.exe");
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

#[cfg(windows)]
fn find_windows_wsl() -> Option<PathBuf> {
    let candidate = windows_system_root().join("System32\\wsl.exe");
    candidate.is_file().then_some(candidate)
}

#[cfg(unix)]
fn find_unix_shell(name: &str) -> Option<PathBuf> {
    if let Some(found) = find_in_path(&[name]) {
        return Some(found);
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        let candidate = PathBuf::from(dir).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(unix)]
pub fn unix_login_path() -> Option<&'static str> {
    static LOGIN_PATH: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    LOGIN_PATH
        .get_or_init(|| {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
            let login_output = std::process::Command::new(&shell)
                .args(["-lc", "printf %s \"$PATH\""])
                .output()
                .ok()
                .filter(|out| out.status.success())
                .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
                .filter(|text| !text.is_empty());

            let mut entries: Vec<PathBuf> = Vec::new();
            let mut push_unique = |path: PathBuf| {
                if !path.as_os_str().is_empty() && !entries.contains(&path) {
                    entries.push(path);
                }
            };

            if let Some(ref resolved) = login_output {
                for p in std::env::split_paths(resolved) {
                    push_unique(p);
                }
            }
            if let Some(current) = std::env::var_os("PATH") {
                for p in std::env::split_paths(&current) {
                    push_unique(p);
                }
            }
            for common in ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"] {
                let p = PathBuf::from(common);
                if p.is_dir() {
                    push_unique(p);
                }
            }
            if let Ok(home) = std::env::var("HOME") {
                let home_path = PathBuf::from(home);
                for suffix in [
                    ".volta/bin",
                    ".bun/bin",
                    ".cargo/bin",
                    ".local/bin",
                    ".local/share/pnpm",
                    "Library/pnpm",
                ] {
                    let p = home_path.join(suffix);
                    if p.is_dir() {
                        push_unique(p);
                    }
                }
            }

            std::env::join_paths(entries)
                .ok()
                .and_then(|os| os.into_string().ok())
        })
        .as_deref()
}

pub fn list_available_shells() -> Vec<ShellOption> {
    #[cfg(windows)]
    {
        vec![
            ShellOption {
                id: "auto".into(),
                label: "Auto (CMD)".into(),
                available: true,
            },
            ShellOption {
                id: "cmd".into(),
                label: "Command Prompt (cmd.exe)".into(),
                available: true,
            },
            ShellOption {
                id: "pwsh".into(),
                label: "PowerShell 7 (pwsh)".into(),
                available: find_windows_pwsh().is_some(),
            },
            ShellOption {
                id: "powershell".into(),
                label: "Windows PowerShell".into(),
                available: find_windows_powershell().is_some(),
            },
            ShellOption {
                id: "git-bash".into(),
                label: "Git Bash".into(),
                available: find_windows_git_bash().is_some(),
            },
            ShellOption {
                id: "wsl".into(),
                label: "WSL".into(),
                available: find_windows_wsl().is_some(),
            },
        ]
    }
    #[cfg(unix)]
    {
        vec![
            ShellOption {
                id: "auto".into(),
                label: "Auto ($SHELL)".into(),
                available: true,
            },
            ShellOption {
                id: "zsh".into(),
                label: "Zsh".into(),
                available: find_unix_shell("zsh").is_some(),
            },
            ShellOption {
                id: "bash".into(),
                label: "Bash".into(),
                available: find_unix_shell("bash").is_some(),
            },
            ShellOption {
                id: "fish".into(),
                label: "Fish".into(),
                available: find_unix_shell("fish").is_some(),
            },
            ShellOption {
                id: "sh".into(),
                label: "POSIX sh".into(),
                available: find_unix_shell("sh").is_some(),
            },
        ]
    }
}

#[derive(Clone)]
pub enum Output {
    Shell(String),
    Command {
        project_id: String,
        command_id: String,
        project_name: String,
        command_label: String,
    },
}

const GRACEFUL_STOP_TIMEOUT_MS: u32 = 1500;
const FORCE_STOP_TIMEOUT_MS: u32 = 2000;

#[cfg(windows)]
struct Session {
    child: win_conpty::WinChild,
    pty: win_conpty::WinConPty,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    tree: win_conpty::ProcessTree,
    graceful_stop: bool,
}

#[cfg(windows)]
impl Session {
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        validate_dimensions(rows, cols)?;
        self.pty.resize(rows, cols)
    }

    fn wait_exit(&self) -> Option<i32> {
        let code = self.child.wait_blocking().ok();
        let _ = self.tree.stop();
        self.pty.close();
        code
    }

    fn stop_and_wait(&self) -> Result<(), String> {
        if self.graceful_stop && self.child.wait_timeout(0)?.is_none() {
            if let Ok(mut writer) = self.writer.lock() {
                let _ = writer.write_all(b"\x03");
                let _ = writer.flush();
            }
            if self.child.wait_timeout(GRACEFUL_STOP_TIMEOUT_MS)?.is_some() {
                let _ = self.tree.stop();
                self.pty.close();
                return Ok(());
            }
        }

        self.tree.stop()?;
        if self.child.wait_timeout(FORCE_STOP_TIMEOUT_MS)?.is_some() {
            self.pty.close();
            return Ok(());
        }
        Err("停止会话超时；保留会话以便重试。".into())
    }

    #[cfg(test)]
    fn try_wait_code(&self) -> Result<Option<i32>, String> {
        self.child.try_wait()
    }

    #[cfg(test)]
    fn wait_code(&self) -> Result<i32, String> {
        self.child.wait_blocking()
    }

    #[cfg(test)]
    fn current_cols(&self) -> u16 {
        self.pty.get_size().1
    }
}

#[cfg(windows)]
impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.tree.stop();
        self.child.kill();
        let _ = self.child.wait_timeout(1000);
        self.pty.close();
    }
}

#[cfg(unix)]
struct Session {
    child: Mutex<Box<dyn Child + Send + Sync>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    tree: ProcessTree,
    graceful_stop: bool,
}

#[cfg(unix)]
impl Session {
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.master
            .lock()
            .map_err(|e| e.to_string())?
            .resize(size(rows, cols)?)
            .map_err(|e| e.to_string())
    }

    fn wait_exit(&self) -> Option<i32> {
        let code = loop {
            let result = self.child.lock().unwrap().try_wait();
            match result {
                Ok(Some(status)) => break Some(status.exit_code() as i32),
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => break None,
            }
        };
        let _ = self.tree.stop();
        code
    }

    fn poll_child_exit(&self, timeout_ms: u32) -> Result<bool, String> {
        let attempts = (timeout_ms / 20).max(1);
        for _ in 0..attempts {
            if self
                .child
                .lock()
                .map_err(|e| e.to_string())?
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                return Ok(true);
            }
            thread::sleep(Duration::from_millis(20));
        }
        Ok(false)
    }

    fn stop_and_wait(&self) -> Result<(), String> {
        if self.graceful_stop {
            let _ = self.tree.interrupt();
            if self.poll_child_exit(GRACEFUL_STOP_TIMEOUT_MS)? {
                let _ = self.tree.stop();
                return Ok(());
            }
        }

        self.tree.stop()?;
        if self.poll_child_exit(FORCE_STOP_TIMEOUT_MS)? {
            return Ok(());
        }
        Err("停止会话超时；保留会话以便重试。".into())
    }

    #[cfg(test)]
    fn try_wait_code(&self) -> Result<Option<i32>, String> {
        self.child
            .lock()
            .map_err(|e| e.to_string())?
            .try_wait()
            .map(|opt| opt.map(|status| status.exit_code() as i32))
            .map_err(|e| e.to_string())
    }

    #[cfg(test)]
    fn wait_code(&self) -> Result<i32, String> {
        self.child
            .lock()
            .map_err(|e| e.to_string())?
            .wait()
            .map(|status| status.exit_code() as i32)
            .map_err(|e| e.to_string())
    }

    #[cfg(test)]
    fn current_cols(&self) -> u16 {
        self.master.lock().unwrap().get_size().unwrap().cols
    }
}

#[cfg(unix)]
impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.tree.stop();
        if let Ok(child) = self.child.get_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ConPTY inherits the cursor through a DSR exchange, even without a visible UI.
// Consume only that initial query: later application queries belong to xterm.
#[cfg(any(windows, test))]
struct StartupReader<R, W> {
    reader: R,
    writer: W,
    pending: Vec<u8>,
    complete: bool,
}

#[cfg(any(windows, test))]
impl<R: std::io::Read, W: FnMut() -> std::io::Result<()>> std::io::Read for StartupReader<R, W> {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        loop {
            if !self.complete {
                if let Some(index) = self.pending.windows(4).position(|s| s == b"\x1b[6n") {
                    (self.writer)()?;
                    self.pending.drain(index..index + 4);
                    self.complete = true;
                }
            }
            let retained = if self.complete {
                0
            } else {
                (1..=3)
                    .rev()
                    .find(|&n| self.pending.ends_with(&b"\x1b[6n"[..n]))
                    .unwrap_or(0)
            };
            let count = output.len().min(self.pending.len() - retained);
            if count > 0 {
                output[..count].copy_from_slice(&self.pending[..count]);
                self.pending.drain(..count);
                return Ok(count);
            }
            let mut buffer = [0; 8192];
            let count = self.reader.read(&mut buffer)?;
            if count == 0 {
                self.complete = true;
                if self.pending.is_empty() {
                    return Ok(0);
                }
            } else {
                self.pending.extend_from_slice(&buffer[..count]);
            }
        }
    }
}

#[cfg(windows)]
fn build_windows_interactive_shell_cmdline(shell_id: Option<&str>) -> String {
    match shell_id.unwrap_or("auto") {
        "pwsh" => {
            if let Some(pwsh) = find_windows_pwsh() {
                return format!(
                    "\"{}\" -NoLogo -NoExit -Command \"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\"",
                    pwsh.to_string_lossy()
                );
            }
        }
        "powershell" => {
            if let Some(ps) = find_windows_powershell() {
                return format!(
                    "\"{}\" -NoLogo -NoExit -Command \"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\"",
                    ps.to_string_lossy()
                );
            }
        }
        "git-bash" => {
            if let Some(bash) = find_windows_git_bash() {
                return format!("\"{}\" -i -l", bash.to_string_lossy());
            }
        }
        "wsl" => {
            if let Some(wsl) = find_windows_wsl() {
                return format!("\"{}\"", wsl.to_string_lossy());
            }
        }
        _ => {}
    }

    format!(
        "\"{}\\System32\\cmd.exe\" /d /q /s /k \"chcp 65001>nul\"",
        windows_system_root().to_string_lossy()
    )
}

#[cfg(unix)]
fn resolve_unix_interactive_shell(shell_id: Option<&str>) -> String {
    match shell_id.unwrap_or("auto") {
        "zsh" | "bash" | "fish" | "sh" => {
            let name = shell_id.unwrap_or("sh");
            if let Some(path) = find_unix_shell(name) {
                return path.to_string_lossy().into_owned();
            }
        }
        _ => {}
    }
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
}

#[cfg(test)]
fn open_session(
    path: String,
    command: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<(Session, Box<dyn std::io::Read + Send>), String> {
    open_session_with_shell(path, command, None, None, rows, cols)
}

#[cfg(windows)]
fn open_session_with_shell(
    path: String,
    command: Option<String>,
    shell_id: Option<String>,
    env_vars: Option<indexmap::IndexMap<String, String>>,
    rows: u16,
    cols: u16,
) -> Result<(Session, Box<dyn std::io::Read + Send>), String> {
    validate_dimensions(rows, cols)?;
    let graceful_stop = command.is_some();
    let command_line = if let Some(cmd) = command {
        format!(
            "\"{}\\System32\\cmd.exe\" /d /q /s /c \"chcp 65001>nul & {}\"",
            windows_system_root().to_string_lossy(),
            cmd
        )
    } else {
        build_windows_interactive_shell_cmdline(shell_id.as_deref())
    };

    let mut env_extra = vec![
        ("TERM".into(), "xterm-256color".into()),
        ("PYTHONUTF8".into(), "1".into()),
        ("PYTHONIOENCODING".into(), "utf-8".into()),
    ];
    if let Some(vars) = env_vars {
        for (key, value) in vars {
            let trimmed = key.trim();
            if !trimmed.is_empty() {
                env_extra.push((trimmed.to_string(), value));
            }
        }
    }

    let spawned = win_conpty::spawn_conpty(&command_line, &path, &env_extra, rows, cols)?;
    let writer = Arc::new(Mutex::new(spawned.writer));
    let reader: Box<dyn std::io::Read + Send> = {
        let writer = writer.clone();
        Box::new(StartupReader {
            reader: spawned.reader,
            writer: move || {
                let mut writer = writer
                    .lock()
                    .map_err(|_| std::io::Error::other("PTY writer poisoned"))?;
                writer.write_all(b"\x1b[1;1R")?;
                writer.flush()
            },
            pending: Vec::new(),
            complete: false,
        })
    };

    Ok((
        Session {
            child: spawned.child,
            pty: spawned.pty,
            writer,
            tree: spawned.tree,
            graceful_stop,
        },
        reader,
    ))
}

#[cfg(unix)]
fn open_session_with_shell(
    path: String,
    command: Option<String>,
    shell_id: Option<String>,
    env_vars: Option<indexmap::IndexMap<String, String>>,
    rows: u16,
    cols: u16,
) -> Result<(Session, Box<dyn std::io::Read + Send>), String> {
    let pair = native_pty_system()
        .openpty(size(rows, cols)?)
        .map_err(|e| e.to_string())?;
    let graceful_stop = command.is_some();
    let shell = if command.is_some() {
        "/bin/sh".to_string()
    } else {
        resolve_unix_interactive_shell(shell_id.as_deref())
    };
    let mut builder = CommandBuilder::new(shell);
    if let Some(cmd) = command {
        builder.args(["-c", &cmd]);
    } else {
        builder.args(["-l", "-i"]);
    }
    if let Some(login_path) = unix_login_path() {
        builder.env("PATH", login_path);
    }
    builder.cwd(path);
    builder.env("TERM", "xterm-256color");
    if let Some(vars) = env_vars {
        for (key, value) in vars {
            let trimmed = key.trim();
            if !trimmed.is_empty() {
                builder.env(trimmed, value);
            }
        }
    }
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = Arc::new(Mutex::new(
        pair.master.take_writer().map_err(|e| e.to_string())?,
    ));
    let mut child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| e.to_string())?;
    let Some(native_pid) = child.process_id() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("无法获取会话进程标识".into());
    };
    let tree = match ProcessTree::new(native_pid) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    drop(pair.slave);

    Ok((
        Session {
            child: Mutex::new(child),
            master: Mutex::new(pair.master),
            writer,
            tree,
            graceful_stop,
        },
        reader,
    ))
}

#[derive(Default)]
struct Registry {
    closing: bool,
    sessions: HashMap<u32, Arc<Session>>,
}

#[derive(Clone, Default)]
pub struct ProcessManager {
    registry: Arc<Mutex<Registry>>,
    next_id: Arc<AtomicU32>,
}

impl ProcessManager {
    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &self,
        app: tauri::AppHandle,
        path: String,
        command: Option<String>,
        shell_id: Option<String>,
        env_vars: Option<indexmap::IndexMap<String, String>>,
        output: Output,
        rows: u16,
        cols: u16,
    ) -> Result<u32, String> {
        let mut registry = self.registry.lock().map_err(|e| e.to_string())?;
        if registry.closing {
            return Err("应用正在退出，不能创建新会话。".into());
        }
        let (session, reader) =
            open_session_with_shell(path, command, shell_id, env_vars, rows, cols)?;
        // IPC exposes an opaque handle, not an OS PID.
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let session = Arc::new(session);
        registry.sessions.insert(id, session.clone());
        drop(registry);
        emit_status(&app, &output, id, "started", None);
        let output_reader = output.clone();
        let app_reader = app.clone();
        thread::spawn(move || {
            stream_terminal_output(reader, |data| match &output_reader {
                Output::Shell(key) => {
                    let _ = app_reader.emit(&format!("shell-out-{}", key), data);
                }
                Output::Command {
                    project_id,
                    command_id,
                    project_name,
                    command_label,
                } => {
                    let _ = app_reader.emit(
                        "terminal-out",
                        TerminalOutputPayload {
                            project_id: project_id.clone(),
                            command_id: command_id.clone(),
                            project_name: project_name.clone(),
                            command_label: command_label.clone(),
                            data,
                        },
                    );
                }
            })
        });
        let manager = self.clone();
        thread::spawn(move || {
            let code = session.wait_exit();
            manager.registry.lock().unwrap().sessions.remove(&id);
            emit_status(&app, &output, id, "exited", code);
        });
        Ok(id)
    }

    fn session(&self, id: u32) -> Result<Arc<Session>, String> {
        let registry = self.registry.lock().map_err(|e| e.to_string())?;
        if registry.closing {
            return Err("应用正在退出。".into());
        }
        registry
            .sessions
            .get(&id)
            .cloned()
            .ok_or_else(|| "会话已结束。".into())
    }

    pub fn input(&self, id: u32, data: String) -> Result<(), String> {
        let session = self.session(id)?;
        let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, rows: u16, cols: u16) -> Result<(), String> {
        let session = self.session(id)?;
        session.resize(rows, cols)
    }

    pub fn stop(&self, id: u32) -> Result<(), String> {
        let Some(session) = self
            .registry
            .lock()
            .map_err(|e| e.to_string())?
            .sessions
            .get(&id)
            .cloned()
        else {
            return Ok(());
        };
        session.stop_and_wait()
    }

    pub fn shutdown(&self) {
        let ids = {
            let mut registry = self.registry.lock().unwrap();
            registry.closing = true;
            registry.sessions.keys().copied().collect::<Vec<_>>()
        };
        thread::scope(|scope| {
            for id in ids {
                scope.spawn(move || {
                    if let Err(error) = self.stop(id) {
                        eprintln!("Session {id}: {error}");
                    }
                });
            }
        });
    }
}

fn validate_dimensions(rows: u16, cols: u16) -> Result<(), String> {
    if rows == 0 || cols == 0 || rows > 1000 || cols > 1000 {
        return Err("终端尺寸无效。".into());
    }
    Ok(())
}

#[cfg(unix)]
fn size(rows: u16, cols: u16) -> Result<PtySize, String> {
    validate_dimensions(rows, cols)?;
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn emit_status(
    app: &tauri::AppHandle,
    output: &Output,
    id: u32,
    status: &str,
    exit_code: Option<i32>,
) {
    match output {
        Output::Shell(key) => {
            if status == "exited" {
                let _ = app.emit(&format!("shell-exit-{}", key), id);
            }
        }
        Output::Command {
            project_id,
            command_id,
            project_name,
            command_label,
        } => {
            let _ = app.emit(
                "command-status",
                CommandStatusPayload {
                    project_id: project_id.clone(),
                    command_id: command_id.clone(),
                    project_name: project_name.clone(),
                    command_label: command_label.clone(),
                    pid: id,
                    status: status.into(),
                    exit_code,
                },
            );
        }
    }
}

#[cfg(unix)]
struct ProcessTree {
    root: u32,
    stopped: Mutex<bool>,
}
#[cfg(unix)]
impl ProcessTree {
    fn new(pid: u32) -> Result<Self, String> {
        Ok(Self {
            root: pid,
            stopped: Mutex::new(false),
        })
    }

    fn signal_groups(&self, signal: libc::c_int) -> Result<(), String> {
        // portable-pty starts a new session. Include interactive shell job groups,
        // not just direct children, before signalling the session leader.
        let output = std::process::Command::new("ps")
            .args(["-axo", "pid=,pgid="])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        let mut groups = std::collections::BTreeSet::new();
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let fields: Vec<i32> = line
                .split_whitespace()
                .filter_map(|value| value.parse().ok())
                .collect();
            // Session membership survives reparenting and shell job-control groups.
            if fields.len() == 2 && unsafe { libc::getsid(fields[0]) } == self.root as i32 {
                groups.insert(fields[1] as u32);
            }
        }
        for group in groups {
            if group > 1 && group != unsafe { libc::getpgrp() } as u32 {
                let result = unsafe { libc::kill(-(group as i32), signal) };
                if result != 0
                    && std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
                {
                    return Err(std::io::Error::last_os_error().to_string());
                }
            }
        }
        Ok(())
    }

    fn interrupt(&self) -> Result<(), String> {
        self.signal_groups(libc::SIGINT)
    }

    fn stop(&self) -> Result<(), String> {
        let mut stopped = self.stopped.lock().map_err(|e| e.to_string())?;
        if *stopped {
            return Ok(());
        }
        self.signal_groups(libc::SIGKILL)?;
        *stopped = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::time::Duration;

    #[test]
    fn startup_query_is_answered_once_across_every_chunk_boundary() {
        // The second query belongs to the application and must reach its UI.
        let input = b"before\x1b[6nafter\x1b[6n";
        for chunk_size in 1..=input.len() {
            struct Chunks<'a>(&'a [u8], usize);
            impl Read for Chunks<'_> {
                fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
                    let count = out.len().min(self.1).min(self.0.len());
                    out[..count].copy_from_slice(&self.0[..count]);
                    self.0 = &self.0[count..];
                    Ok(count)
                }
            }
            let mut replies = 0;
            let mut reader = StartupReader {
                reader: Chunks(input, chunk_size),
                writer: || {
                    replies += 1;
                    Ok(())
                },
                pending: Vec::new(),
                complete: false,
            };
            let mut output = Vec::new();
            // Tiny destination buffers also exercise draining pending output.
            let mut byte = [0];
            while reader.read(&mut byte).unwrap() != 0 {
                output.extend_from_slice(&byte);
            }
            assert_eq!(output, b"beforeafter\x1b[6n");
            assert_eq!(replies, 1);
        }
    }

    #[test]
    fn startup_reader_preserves_incomplete_sequences_at_eof_and_reports_write_errors() {
        let mut reader = StartupReader {
            reader: &b"text\x1b[6"[..],
            writer: || panic!("incomplete query must not be answered"),
            pending: Vec::new(),
            complete: false,
        };
        let mut output = Vec::new();
        reader.read_to_end(&mut output).unwrap();
        assert_eq!(output, b"text\x1b[6");
        let mut reader = StartupReader {
            reader: &b"\x1b[6n"[..],
            writer: || Err(std::io::ErrorKind::BrokenPipe.into()),
            pending: Vec::new(),
            complete: false,
        };
        assert_eq!(
            reader.read(&mut [0]).unwrap_err().kind(),
            std::io::ErrorKind::BrokenPipe
        );
    }

    #[cfg(windows)]
    #[test]
    fn concurrent_hidden_sessions_start_without_frontend_and_shutdown() {
        let workers: Vec<_> = (0..3)
            .map(|_| {
                thread::spawn(|| {
                    let directory = tempfile::tempdir().unwrap();
                    std::fs::write(
                        directory.path().join("ready.cjs"),
                        "require('fs').writeFileSync('ready', 'yes'); setInterval(()=>{},1000);",
                    )
                    .unwrap();
                    let (session, reader) = open_session(
                        directory.path().to_string_lossy().into_owned(),
                        Some("node ready.cjs".into()),
                        24,
                        80,
                    )
                    .unwrap();
                    // No xterm, frontend subscriber, or simulated terminal responses.
                    let (send, output) = std::sync::mpsc::channel();
                    thread::spawn(move || {
                        let mut reader = reader;
                        let mut bytes = Vec::new();
                        reader.read_to_end(&mut bytes).unwrap();
                        let _ = send.send(bytes);
                    });
                    let deadline = std::time::Instant::now() + Duration::from_secs(15);
                    while !directory.path().join("ready").exists() {
                        assert!(
                            std::time::Instant::now() < deadline,
                            "hidden session did not start"
                        );
                        thread::sleep(Duration::from_millis(25));
                    }
                    let session = Arc::new(session);
                    let manager = ProcessManager::default();
                    manager
                        .registry
                        .lock()
                        .unwrap()
                        .sessions
                        .insert(1, session.clone());
                    manager.shutdown();
                    assert!(session.try_wait_code().unwrap().is_some());
                    drop(manager);
                    drop(session);
                    let bytes = output.recv_timeout(Duration::from_secs(5)).unwrap();
                    assert!(!bytes.windows(4).any(|s| s == b"\x1b[6n"));
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
    }

    #[cfg(windows)]
    #[test]
    fn hidden_interactive_shell_accepts_input_after_startup() {
        let directory = tempfile::tempdir().unwrap();
        let (session, reader) = open_session(
            directory.path().to_string_lossy().into_owned(),
            None,
            24,
            80,
        )
        .unwrap();
        let (send, output) = std::sync::mpsc::channel();
        thread::spawn(move || {
            stream_terminal_output(reader, |data| {
                let _ = send.send(data);
            })
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        let mut text = String::new();
        while !text.contains('>') {
            if let Ok(data) = output.recv_timeout(Duration::from_millis(100)) {
                text.push_str(&data);
            }
            assert!(
                std::time::Instant::now() < deadline,
                "shell prompt not ready: {text}"
            );
        }
        session
            .writer
            .lock()
            .unwrap()
            .write_all(b"echo ready>shell.ready\r")
            .unwrap();
        while !directory.path().join("shell.ready").exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "shell input was not executed"
            );
            thread::sleep(Duration::from_millis(25));
        }
        session.tree.stop().unwrap();
        session.wait_code().unwrap();
    }

    #[test]
    fn rejects_invalid_dimensions() {
        assert!(validate_dimensions(0, 80).is_err());
        assert!(validate_dimensions(24, 80).is_ok());
    }
    #[test]
    fn unknown_session_is_never_treated_as_os_pid() {
        let manager = ProcessManager::default();
        assert!(manager.stop(std::process::id()).is_ok());
        assert!(manager.input(999, "x".into()).is_err());
    }

    #[test]
    fn shutdown_without_sessions_is_repeatable() {
        let manager = ProcessManager::default();
        manager.shutdown();
        manager.shutdown();
        assert!(manager.registry.lock().unwrap().closing);
        assert!(manager.registry.lock().unwrap().sessions.is_empty());
        assert!(manager.input(1, "x".into()).is_err());
    }

    #[test]
    fn pty_preserves_quoted_unicode_commands_and_reports_a_real_terminal() {
        let directory = tempfile::tempdir().unwrap();
        let command = r#"node -e "if (!process.stdin.isTTY || !process.stdout.isTTY) process.exit(7); process.stdout.write(JSON.stringify(['two words','中文']));""#;
        let (session, reader) = open_session(
            directory.path().to_string_lossy().into_owned(),
            Some(command.into()),
            24,
            80,
        )
        .unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        thread::spawn(move || {
            stream_terminal_output(reader, |data| {
                let _ = send.send(data);
            })
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        let status = loop {
            if let Some(code) = session.try_wait_code().unwrap() {
                break code;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "test PTY command timed out"
            );
            thread::sleep(Duration::from_millis(25));
        };
        assert_eq!(status, 0);
        let mut output = String::new();
        while std::time::Instant::now() < deadline {
            match receive.recv_timeout(Duration::from_millis(100)) {
                Ok(data) => output.push_str(&data),
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                Err(_) => {
                    if output.contains("[\"two words\",\"中文\"]") {
                        break;
                    }
                }
            }
        }
        assert!(
            output.contains("[\"two words\",\"中文\"]"),
            "PTY output: {output}"
        );
    }

    #[test]
    fn shutdown_terminates_owned_sessions_and_rejects_further_input() {
        let directory = tempfile::tempdir().unwrap();
        let (session, reader) = open_session(
            directory.path().to_string_lossy().into_owned(),
            None,
            24,
            80,
        )
        .unwrap();
        thread::spawn(move || stream_terminal_output(reader, |_| {}));
        let session = Arc::new(session);
        let manager = ProcessManager::default();
        manager
            .registry
            .lock()
            .unwrap()
            .sessions
            .insert(1, session.clone());
        manager.resize(1, 40, 120).unwrap();
        assert_eq!(session.current_cols(), 120);
        manager.shutdown();
        assert!(manager.registry.lock().unwrap().closing);
        assert!(session.try_wait_code().unwrap().is_some());
        assert!(manager.input(1, "x".into()).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_job_shutdown_terminates_a_spawned_grandchild() {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, WAIT_OBJECT_0},
            System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
        };
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("tree.cjs"), "const child = require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'inherit'}); require('fs').writeFileSync('child.pid', String(child.pid)); setInterval(()=>{},1000);").unwrap();
        let (session, reader) = open_session(
            directory.path().to_string_lossy().into_owned(),
            Some("node tree.cjs".into()),
            24,
            80,
        )
        .unwrap();
        thread::spawn(move || stream_terminal_output(reader, |_| {}));
        let marker = directory.path().join("child.pid");
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        let pid = loop {
            if let Ok(text) = std::fs::read_to_string(&marker) {
                if let Ok(pid) = text.parse::<u32>() {
                    break pid;
                }
            }
            assert!(
                std::time::Instant::now() < deadline,
                "grandchild did not start"
            );
            thread::sleep(Duration::from_millis(25));
        };
        let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
        assert!(!handle.is_null());
        let manager = ProcessManager::default();
        manager
            .registry
            .lock()
            .unwrap()
            .sessions
            .insert(1, Arc::new(session));
        manager.shutdown();
        let result = unsafe { WaitForSingleObject(handle, 5000) };
        unsafe {
            CloseHandle(handle);
        }
        assert_eq!(result, WAIT_OBJECT_0);
    }

    #[test]
    fn pty_delivers_control_characters_to_an_interactive_program() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("input.cjs"), "process.stdin.setRawMode(true); process.stdout.write('PTY_INPUT_READY'); process.stdin.on('data', data => { if(data.includes(3)) process.exit(0); });").unwrap();
        let (session, reader) = open_session(
            directory.path().to_string_lossy().into_owned(),
            Some("node input.cjs".into()),
            24,
            80,
        )
        .unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        thread::spawn(move || {
            stream_terminal_output(reader, |data| {
                let _ = send.send(data);
            })
        });
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        let mut output = String::new();
        while !output.contains("PTY_INPUT_READY") {
            if let Ok(data) = receive.recv_timeout(Duration::from_millis(100)) {
                output.push_str(&data);
            }
            assert!(
                std::time::Instant::now() < deadline,
                "PTY input fixture not ready: {output}"
            );
        }
        session.writer.lock().unwrap().write_all(b"\x03").unwrap();
        loop {
            if let Some(code) = session.try_wait_code().unwrap() {
                assert_eq!(code, 0);
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "control input did not reach child"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[cfg(unix)]
    #[test]
    fn session_cleanup_includes_grandchildren_in_separate_job_groups() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("grandchild.pid");
        // Node's detached child is a separate session, deliberately out of scope;
        // this fixture instead covers ordinary shell children and grandchildren.
        let command =
            "set -m; sh -c 'sleep 120 & echo $! > grandchild.pid; wait' & wait".to_string();
        let (session, reader) = open_session(
            directory.path().to_string_lossy().into_owned(),
            Some(command),
            24,
            80,
        )
        .unwrap();
        thread::spawn(move || stream_terminal_output(reader, |_| {}));
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !marker.exists() {
            assert!(std::time::Instant::now() < deadline);
            thread::sleep(Duration::from_millis(20));
        }
        let pid: i32 = std::fs::read_to_string(marker)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert_eq!(unsafe { libc::getsid(pid) }, session.tree.root as i32);
        assert_ne!(unsafe { libc::getpgid(pid) }, session.tree.root as i32);
        session.tree.stop().unwrap();
        // Reap our leader, then allow the OS to reap its terminated descendants.
        session.child.lock().unwrap().wait().unwrap();
        while unsafe { libc::kill(pid, 0) } == 0 && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0);
    }

    #[test]
    fn lists_available_shells_with_auto_default() {
        let shells = list_available_shells();
        assert!(shells
            .iter()
            .any(|shell| shell.id == "auto" && shell.available));
        #[cfg(windows)]
        assert!(shells
            .iter()
            .any(|shell| shell.id == "cmd" && shell.available));
    }

    #[test]
    fn command_stop_allows_graceful_sigint_cleanup_and_falls_back_when_ignored() {
        let graceful_dir = tempfile::tempdir().unwrap();
        std::fs::write(
            graceful_dir.path().join("graceful.cjs"),
            "const fs = require('fs'); process.on('SIGINT', () => { fs.writeFileSync('graceful.done', 'cleaned'); process.exit(0); }); fs.writeFileSync('ready', '1'); setInterval(() => {}, 1000);",
        )
        .unwrap();
        let (session, reader) = open_session(
            graceful_dir.path().to_string_lossy().into_owned(),
            Some("node graceful.cjs".into()),
            24,
            80,
        )
        .unwrap();
        thread::spawn(move || stream_terminal_output(reader, |_| {}));
        let deadline = std::time::Instant::now() + Duration::from_secs(15);
        while !graceful_dir.path().join("ready").exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "graceful fixture did not start"
            );
            thread::sleep(Duration::from_millis(25));
        }
        session.stop_and_wait().unwrap();
        assert!(
            graceful_dir.path().join("graceful.done").exists(),
            "service did not run SIGINT shutdown hook before termination"
        );

        let stubborn_dir = tempfile::tempdir().unwrap();
        std::fs::write(
            stubborn_dir.path().join("stubborn.cjs"),
            "const fs = require('fs'); process.on('SIGINT', () => {}); fs.writeFileSync('ready', '1'); setInterval(() => {}, 1000);",
        )
        .unwrap();
        let (stubborn_session, stubborn_reader) = open_session(
            stubborn_dir.path().to_string_lossy().into_owned(),
            Some("node stubborn.cjs".into()),
            24,
            80,
        )
        .unwrap();
        thread::spawn(move || stream_terminal_output(stubborn_reader, |_| {}));
        let stubborn_deadline = std::time::Instant::now() + Duration::from_secs(15);
        while !stubborn_dir.path().join("ready").exists() {
            assert!(
                std::time::Instant::now() < stubborn_deadline,
                "stubborn fixture did not start"
            );
            thread::sleep(Duration::from_millis(25));
        }
        stubborn_session.stop_and_wait().unwrap();
        assert!(stubborn_session.try_wait_code().unwrap().is_some());
    }
}
