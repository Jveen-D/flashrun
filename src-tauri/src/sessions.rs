use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::{
    collections::HashMap,
    io::Write,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::Emitter;

use super::{stream_terminal_output, CommandStatusPayload, TerminalOutputPayload};

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

struct Session {
    child: Mutex<Box<dyn Child + Send + Sync>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    tree: ProcessTree,
}

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

fn open_session(
    path: String,
    command: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<(Session, Box<dyn std::io::Read + Send>), String> {
    let pair = native_pty_system()
        .openpty(size(rows, cols)?)
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let mut builder = {
        let mut builder = if let Some(command) = command {
            use base64::Engine;
            // portable-pty quotes argv using CRT rules, which cmd.exe does not
            // follow. A fixed encoded bridge passes an exact raw /c command line
            // through ProcessStartInfo; user code is data, never PowerShell code.
            // The input barrier also prevents descendants before Job assignment.
            let bridge = r#"[Console]::ReadLine() | Out-Null
$command = $env:__FLASHRUN_COMMAND
[Environment]::SetEnvironmentVariable('__FLASHRUN_COMMAND', $null)
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $env:SystemRoot + '\System32\cmd.exe'
$start.Arguments = '/d /q /s /c "chcp 65001>nul & ' + $command + '"'
$start.UseShellExecute = $false
$child = [System.Diagnostics.Process]::Start($start)
$child.WaitForExit()
exit $child.ExitCode"#;
            let encoded = base64::engine::general_purpose::STANDARD.encode(
                bridge
                    .encode_utf16()
                    .flat_map(u16::to_le_bytes)
                    .collect::<Vec<_>>(),
            );
            let mut builder = CommandBuilder::new(
                std::path::PathBuf::from(
                    std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()),
                )
                .join("System32/WindowsPowerShell/v1.0/powershell.exe"),
            );
            builder.args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                &encoded,
            ]);
            builder.env("__FLASHRUN_COMMAND", command);
            builder
        } else {
            let mut builder = CommandBuilder::new("cmd.exe");
            builder.args([
                "/d",
                "/q",
                "/s",
                "/k",
                "set /p __FLASHRUN_START= >nul & chcp 65001>nul",
            ]);
            builder
        };
        builder.env("PYTHONUTF8", "1");
        builder.env("PYTHONIOENCODING", "utf-8");
        builder
    };
    #[cfg(unix)]
    let mut builder = {
        let shell = if command.is_some() {
            "/bin/sh".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
        };
        let mut builder = CommandBuilder::new(shell);
        if let Some(cmd) = command {
            builder.args(["-c", &cmd]);
        } else {
            builder.arg("-i");
        }
        builder
    };
    builder.cwd(path);
    builder.env("TERM", "xterm-256color");
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
    #[cfg(windows)]
    let reader: Box<dyn std::io::Read + Send> = {
        let writer = writer.clone();
        Box::new(StartupReader {
            reader,
            writer: move || {
                let mut writer = writer
                    .lock()
                    .map_err(|_| std::io::Error::other("PTY writer poisoned"))?;
                // Job assignment is already complete. Release the command barrier
                // only after ConPTY can process input; early input may be lost.
                writer.write_all(b"\x1b[1;1Rready\r")?;
                writer.flush()
            },
            pending: Vec::new(),
            complete: false,
        })
    };
    drop(pair.slave);

    Ok((
        Session {
            child: Mutex::new(child),
            master: Mutex::new(pair.master),
            writer,
            tree,
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
        output: Output,
        rows: u16,
        cols: u16,
    ) -> Result<u32, String> {
        let mut registry = self.registry.lock().map_err(|e| e.to_string())?;
        if registry.closing {
            return Err("应用正在退出，不能创建新会话。".into());
        }
        let (session, reader) = open_session(path, command, rows, cols)?;
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
            let code = loop {
                let result = session.child.lock().unwrap().try_wait();
                match result {
                    Ok(Some(status)) => break Some(status.exit_code() as i32),
                    Ok(None) => thread::sleep(Duration::from_millis(50)),
                    Err(_) => break None,
                }
            };
            let _ = session.tree.stop();
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
        let result = session
            .master
            .lock()
            .map_err(|e| e.to_string())?
            .resize(size(rows, cols)?)
            .map_err(|e| e.to_string());
        result
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
        session.tree.stop()?;
        // Retain the child handle until exit has been observed by the supervisor.
        for _ in 0..100 {
            if session
                .child
                .lock()
                .map_err(|e| e.to_string())?
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(20));
        }
        Err("停止会话超时；保留会话以便重试。".into())
    }

    pub fn shutdown(&self) {
        let ids = {
            let mut registry = self.registry.lock().unwrap();
            registry.closing = true;
            registry.sessions.keys().copied().collect::<Vec<_>>()
        };
        for id in ids {
            if let Err(error) = self.stop(id) {
                eprintln!("Session {id}: {error}");
            }
        }
    }
}

fn size(rows: u16, cols: u16) -> Result<PtySize, String> {
    if rows == 0 || cols == 0 || rows > 1000 || cols > 1000 {
        return Err("终端尺寸无效。".into());
    }
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

#[cfg(windows)]
struct ProcessTree(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for ProcessTree {}
#[cfg(windows)]
unsafe impl Sync for ProcessTree {}
#[cfg(windows)]
impl ProcessTree {
    fn new(pid: u32) -> Result<Self, String> {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::{JobObjects::*, Threading::*},
        };
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let tree = Self(job);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let assigned = AssignProcessToJobObject(job, process);
            let error = std::io::Error::last_os_error();
            CloseHandle(process);
            if assigned == 0 {
                return Err(error.to_string());
            }
            Ok(tree)
        }
    }
    fn stop(&self) -> Result<(), String> {
        if unsafe { windows_sys::Win32::System::JobObjects::TerminateJobObject(self.0, 1) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
}
#[cfg(windows)]
impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
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
    fn stop(&self) -> Result<(), String> {
        let mut stopped = self.stopped.lock().map_err(|e| e.to_string())?;
        if *stopped {
            return Ok(());
        }
        // portable-pty starts a new session. Include interactive shell job groups,
        // not just direct children, before terminating the session leader.
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
                let result = unsafe { libc::kill(-(group as i32), libc::SIGKILL) };
                if result != 0
                    && std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
                {
                    return Err(std::io::Error::last_os_error().to_string());
                }
            }
        }
        *stopped = true;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

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
                    assert!(session.child.lock().unwrap().try_wait().unwrap().is_some());
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
        session.child.lock().unwrap().wait().unwrap();
    }

    #[test]
    fn rejects_invalid_dimensions() {
        assert!(size(0, 80).is_err());
        assert!(size(24, 80).is_ok());
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
            if let Some(status) = session.child.lock().unwrap().try_wait().unwrap() {
                break status;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "test PTY command timed out"
            );
            thread::sleep(Duration::from_millis(25));
        };
        assert_eq!(status.exit_code(), 0);
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
        assert_eq!(session.master.lock().unwrap().get_size().unwrap().cols, 120);
        manager.shutdown();
        assert!(manager.registry.lock().unwrap().closing);
        assert!(session.child.lock().unwrap().try_wait().unwrap().is_some());
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
            if let Some(status) = session.child.lock().unwrap().try_wait().unwrap() {
                assert_eq!(status.exit_code(), 0);
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
}
