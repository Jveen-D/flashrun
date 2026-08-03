use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, LogicalSize, PhysicalPosition, PhysicalSize, Position, Size, Window};

const CONFIG_FILE_NAME: &str = "flashrun-config.json";
const LEGACY_APP_IDENTIFIER: &str = "com.d8506.flashrun";

fn config_file_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        return Ok(PathBuf::from(user_profile).join(CONFIG_FILE_NAME));
    }

    std::env::var("HOME")
        .map(|home| PathBuf::from(home).join(CONFIG_FILE_NAME))
        .map_err(|_| "无法确定配置文件保存目录。".to_string())
}

fn legacy_config_file_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        return std::env::var("APPDATA")
            .ok()
            .map(|app_data| PathBuf::from(app_data).join(LEGACY_APP_IDENTIFIER).join(CONFIG_FILE_NAME));
    }

    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

fn migrate_legacy_config_if_needed(target_path: &Path) -> Result<(), String> {
    if target_path.exists() {
        return Ok(());
    }

    let Some(legacy_path) = legacy_config_file_path() else {
        return Ok(());
    };

    if !legacy_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&legacy_path).map_err(|e| format!("读取旧配置失败: {}", e))?;

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    fs::write(target_path, content).map_err(|e| format!("迁移旧配置失败: {}", e))?;

    Ok(())
}

#[derive(Clone)]
struct ProcessManager {
    stdinmap: Arc<Mutex<HashMap<u32, ChildStdin>>>,
}

impl ProcessManager {
    fn new() -> Self {
        Self {
            stdinmap: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn insert_stdin(&self, pid: u32, stdin: ChildStdin) {
        let mut map = self.stdinmap.lock().unwrap();
        map.insert(pid, stdin);
    }

    fn remove_stdin(&self, pid: u32) {
        let mut map = self.stdinmap.lock().unwrap();
        map.remove(&pid);
    }
}

#[derive(Serialize)]
struct ProjectInfo {
    manager: String,
    scripts: IndexMap<String, String>,
}

#[derive(Deserialize)]
struct PackageJson {
    scripts: Option<IndexMap<String, String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputPayload {
    project_id: String,
    command_id: String,
    project_name: String,
    command_label: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandStatusPayload {
    project_id: String,
    command_id: String,
    project_name: String,
    command_label: String,
    pid: u32,
    status: String,
    exit_code: Option<i32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowPositionPayload {
    x: i32,
    y: i32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowSizePayload {
    width: u32,
    height: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompactWindowLayoutPayload {
    previous_position: Option<WindowPositionPayload>,
    previous_size: Option<WindowSizePayload>,
    was_maximized: bool,
    compact_position: Option<WindowPositionPayload>,
}

fn stream_terminal_output<R, F>(mut reader: R, mut emit: F)
where
    R: Read,
    F: FnMut(String),
{
    let mut read_buffer = [0_u8; 8192];
    let mut pending = Vec::new();

    loop {
        let count = match reader.read(&mut read_buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(_) => break,
        };
        pending.extend_from_slice(&read_buffer[..count]);

        let mut consumed = 0;
        while consumed < pending.len() {
            match std::str::from_utf8(&pending[consumed..]) {
                Ok(text) => {
                    if !text.is_empty() {
                        emit(text.to_string());
                    }
                    consumed = pending.len();
                }
                Err(error) => {
                    let valid_end = consumed + error.valid_up_to();
                    if valid_end > consumed {
                        emit(String::from_utf8_lossy(&pending[consumed..valid_end]).into_owned());
                    }

                    if let Some(error_length) = error.error_len() {
                        let invalid_end = (valid_end + error_length).min(pending.len());
                        emit(String::from_utf8_lossy(&pending[valid_end..invalid_end]).into_owned());
                        consumed = invalid_end;
                    } else {
                        consumed = valid_end;
                        break;
                    }
                }
            }
        }

        if consumed > 0 {
            pending.drain(..consumed);
        }
    }

    if !pending.is_empty() {
        emit(String::from_utf8_lossy(&pending).into_owned());
    }
}

#[tauri::command]
fn parse_project_info(path: String) -> Result<ProjectInfo, String> {
    let base_path = Path::new(&path);
    let pkg_json_path = base_path.join("package.json");

    if !pkg_json_path.exists() {
        return Err("当前目录并非有效的 Node.js 前端项目（未能找到 package.json）。".to_string());
    }

    let manager = if base_path.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if base_path.join("yarn.lock").exists() {
        "yarn"
    } else {
        "npm"
    };

    let content = fs::read_to_string(&pkg_json_path).map_err(|e| format!("读取 package.json 失败: {}", e))?;

    let parsed: PackageJson = serde_json::from_str(&content).unwrap_or(PackageJson {
        scripts: Some(IndexMap::new()),
    });

    let scripts = parsed.scripts.unwrap_or_default();

    Ok(ProjectInfo {
        manager: manager.to_string(),
        scripts,
    })
}

#[tauri::command]
fn load_app_config() -> Result<Option<serde_json::Value>, String> {
    let path = config_file_path()?;
    migrate_legacy_config_if_needed(&path)?;

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("读取配置文件失败: {}", e))?;

    if content.trim().is_empty() {
        return Ok(None);
    }

    let config = serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    Ok(Some(config))
}

#[tauri::command]
fn save_app_config(config: serde_json::Value) -> Result<String, String> {
    let path = config_file_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    let content = serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败: {}", e))?;

    fs::write(&path, content).map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn run_command(
    app: tauri::AppHandle,
    state: tauri::State<ProcessManager>,
    path: String,
    cmd: String,
    cmd_id: String,
    project_id: String,
    project_name: String,
    command_label: String,
) -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    let mut command = Command::new("cmd");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000200);
        command.args(["/d", "/s", "/c", &cmd]);
    }

    #[cfg(not(target_os = "windows"))]
    let mut command = Command::new("sh");
    #[cfg(not(target_os = "windows"))]
    command.args(["-c", &cmd]);

    command
        .current_dir(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();

    if let Some(stdin) = child.stdin.take() {
        state.insert_stdin(pid, stdin);
    }

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let started_payload = CommandStatusPayload {
        project_id: project_id.clone(),
        command_id: cmd_id.clone(),
        project_name: project_name.clone(),
        command_label: command_label.clone(),
        pid,
        status: "started".to_string(),
        exit_code: None,
    };
    let _ = app.emit("command-status", started_payload);

    let app_handle_out = app.clone();
    let project_id_out = project_id.clone();
    let project_name_out = project_name.clone();
    let command_label_out = command_label.clone();
    let cmd_id_out = cmd_id.clone();
    std::thread::spawn(move || {
        stream_terminal_output(stdout, |data| {
            let payload = TerminalOutputPayload {
                project_id: project_id_out.clone(),
                command_id: cmd_id_out.clone(),
                project_name: project_name_out.clone(),
                command_label: command_label_out.clone(),
                data,
            };
            let _ = app_handle_out.emit("terminal-out", payload);
        });
    });

    let app_handle_err = app.clone();
    let project_id_err = project_id.clone();
    let project_name_err = project_name.clone();
    let command_label_err = command_label.clone();
    let cmd_id_err = cmd_id.clone();
    std::thread::spawn(move || {
        stream_terminal_output(stderr, |data| {
            let payload = TerminalOutputPayload {
                project_id: project_id_err.clone(),
                command_id: cmd_id_err.clone(),
                project_name: project_name_err.clone(),
                command_label: command_label_err.clone(),
                data,
            };
            let _ = app_handle_err.emit("terminal-out", payload);
        });
    });

    let app_handle_wait = app.clone();
    let manager_wait = state.inner().clone();
    let project_id_wait = project_id.clone();
    let project_name_wait = project_name.clone();
    let command_label_wait = command_label.clone();
    let cmd_id_wait = cmd_id.clone();
    std::thread::spawn(move || {
        let exit_code = child.wait().ok().and_then(|status| status.code());
        manager_wait.remove_stdin(pid);
        let payload = CommandStatusPayload {
            project_id: project_id_wait,
            command_id: cmd_id_wait,
            project_name: project_name_wait,
            command_label: command_label_wait,
            pid,
            status: "exited".to_string(),
            exit_code,
        };
        let _ = app_handle_wait.emit("command-status", payload);
    });

    Ok(pid)
}

#[tauri::command]
fn send_input(state: tauri::State<ProcessManager>, pid: u32, data: String) -> Result<(), String> {
    let mut map = state.stdinmap.lock().unwrap();
    if let Some(stdin) = map.get_mut(&pid) {
        stdin.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("No process found with pid {}", pid))
    }
}

#[tauri::command]
fn create_shell_session(
    app: tauri::AppHandle,
    state: tauri::State<ProcessManager>,
    session_id: String,
    working_dir: String,
    project_name: Option<String>,
) -> Result<u32, String> {
    let _ = project_name;
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd.exe");
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000200);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        Command::new(shell)
    };

    cmd.current_dir(&working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();

    if let Some(stdin) = child.stdin.take() {
        state.insert_stdin(pid, stdin);
    }

    if let Some(stdout) = child.stdout.take() {
        let app_out = app.clone();
        let sid_out = session_id.clone();
        std::thread::spawn(move || {
            stream_terminal_output(stdout, |data| {
                let _ = app_out.emit(&format!("shell-out-{}", sid_out), data);
            });
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app_err = app.clone();
        let sid_err = session_id.clone();
        std::thread::spawn(move || {
            stream_terminal_output(stderr, |data| {
                let _ = app_err.emit(&format!("shell-out-{}", sid_err), data);
            });
        });
    }

    let manager_wait = state.inner().clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        manager_wait.remove_stdin(pid);
    });

    Ok(pid)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortTerminationPayload {
    port: u16,
    killed_pids: Vec<u32>,
}

#[cfg(target_os = "windows")]
fn run_hidden_command(program: &str, args: &[&str]) -> Result<std::process::Output, String> {
    use std::os::windows::process::CommandExt;

    Command::new(program)
        .creation_flags(0x08000000)
        .args(args)
        .output()
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn windows_process_exists(pid: u32) -> Result<bool, String> {
    let filter = format!("PID eq {}", pid);
    let output = run_hidden_command("tasklist", &["/FI", &filter, "/FO", "CSV", "/NH"])?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let pid_text = pid.to_string();
    Ok(String::from_utf8_lossy(&output.stdout).lines().any(|line| {
        line.split(',')
            .nth(1)
            .map(|value| value.trim().trim_matches('"') == pid_text)
            .unwrap_or(false)
    }))
}

#[cfg(target_os = "windows")]
fn terminate_process_tree(pid: u32) -> Result<(), String> {
    let mut last_error = String::new();

    for _ in 0..3 {
        if !windows_process_exists(pid)? {
            return Ok(());
        }

        let pid_text = pid.to_string();
        let output = run_hidden_command("taskkill", &["/F", "/T", "/PID", &pid_text])?;
        if !output.status.success() {
            last_error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if last_error.is_empty() {
                last_error = String::from_utf8_lossy(&output.stdout).trim().to_string();
            }
        }

        for _ in 0..5 {
            thread::sleep(Duration::from_millis(60));
            if !windows_process_exists(pid)? {
                return Ok(());
            }
        }
    }

    Err(if last_error.is_empty() {
        format!("进程树 {} 在多次终止后仍然存在。", pid)
    } else {
        format!("终止进程树 {} 失败：{}", pid, last_error)
    })
}

#[cfg(not(target_os = "windows"))]
fn terminate_process_tree(pid: u32) -> Result<(), String> {
    let pid_text = pid.to_string();
    let _ = Command::new("pkill").args(["-KILL", "-P", &pid_text]).output();
    let output = Command::new("kill")
        .args(["-KILL", &pid_text])
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() || String::from_utf8_lossy(&output.stderr).contains("No such process") {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(target_os = "windows")]
fn endpoint_port(endpoint: &str) -> Option<u16> {
    endpoint.rsplit_once(':')?.1.parse().ok()
}

#[cfg(target_os = "windows")]
fn process_ids_for_port(port: u16) -> Result<Vec<u32>, String> {
    let output = run_hidden_command("netstat", &["-ano"])?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let mut process_ids = BTreeSet::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let columns = line.split_whitespace().collect::<Vec<_>>();
        let protocol = columns.first().map(|value| value.to_ascii_uppercase());
        let is_tcp_listener = protocol.as_deref() == Some("TCP")
            && columns.len() >= 5
            && columns.get(3).map(|state| state.eq_ignore_ascii_case("LISTENING")) == Some(true);
        let is_udp_socket = protocol.as_deref() == Some("UDP") && columns.len() >= 4;

        if !(is_tcp_listener || is_udp_socket)
            || columns.get(1).and_then(|endpoint| endpoint_port(endpoint)) != Some(port)
        {
            continue;
        }

        if let Some(pid) = columns.last().and_then(|value| value.parse::<u32>().ok()) {
            if pid > 0 {
                process_ids.insert(pid);
            }
        }
    }

    Ok(process_ids.into_iter().collect())
}

#[cfg(not(target_os = "windows"))]
fn process_ids_for_port(port: u16) -> Result<Vec<u32>, String> {
    let port_filter = format!(":{}", port);
    let output = Command::new("lsof")
        .args(["-nP", "-t", "-i", &port_filter])
        .output()
        .map_err(|error| format!("无法执行 lsof：{}", error))?;

    if !output.status.success() && output.stdout.is_empty() {
        return Ok(Vec::new());
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect())
}

#[tauri::command]
fn kill_command(state: tauri::State<ProcessManager>, pid: u32) -> Result<(), String> {
    terminate_process_tree(pid)?;
    state.remove_stdin(pid);
    Ok(())
}

#[tauri::command]
fn terminate_port(port: u16) -> Result<PortTerminationPayload, String> {
    let process_ids = process_ids_for_port(port)?;
    let mut killed_pids = Vec::new();

    for pid in process_ids {
        terminate_process_tree(pid)?;
        killed_pids.push(pid);
    }

    Ok(PortTerminationPayload { port, killed_pids })
}

fn editor_command_candidates(editor_key: &str) -> Vec<&str> {
    match editor_key {
        "codebuddy" => vec!["codebuddy", "codebuddy.exe"],
        "antigravity" => vec!["antigravity", "antigravity.cmd", "antigravity.exe"],
        "code" => vec!["code", "code.cmd", "code.exe"],
        "cursor" => vec!["cursor", "cursor.cmd", "cursor.exe"],
        "zed" => vec!["zed", "zed.cmd", "zed.exe"],
        other => vec![other],
    }
}

#[cfg(target_os = "windows")]
fn editor_registry_executables(editor_key: &str) -> Vec<&'static str> {
    match editor_key {
        "codebuddy" => vec!["CodeBuddy.exe"],
        "antigravity" => vec!["Antigravity.exe"],
        "code" => vec!["Code.exe"],
        "cursor" => vec!["Cursor.exe"],
        "zed" => vec!["Zed.exe"],
        _ => Vec::new(),
    }
}

#[cfg(target_os = "windows")]
fn editor_install_path_suffixes(editor_key: &str) -> Vec<&'static str> {
    match editor_key {
        "codebuddy" => vec![r"CodeBuddy\CodeBuddy.exe", r"CodeBuddy CN\CodeBuddy CN.exe"],
        "antigravity" => vec![r"Antigravity\Antigravity.exe", r"Antigravity\bin\antigravity.cmd"],
        "code" => vec![r"Microsoft VS Code\Code.exe"],
        "cursor" => vec![r"Cursor\Cursor.exe"],
        "zed" => vec![r"Zed\Zed.exe"],
        _ => Vec::new(),
    }
}

#[cfg(target_os = "windows")]
fn push_unique_candidate(candidates: &mut Vec<String>, candidate: impl Into<String>) {
    let candidate = candidate.into();
    let candidate = candidate.trim().trim_matches('"').to_string();

    if candidate.is_empty() {
        return;
    }

    if candidates
        .iter()
        .any(|existing| existing.eq_ignore_ascii_case(&candidate))
    {
        return;
    }

    candidates.push(candidate);
}

#[cfg(target_os = "windows")]
fn windows_registry_app_path_candidates(editor_key: &str) -> Vec<String> {
    use winreg::{
        enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY},
        RegKey,
    };

    let executable_names = editor_registry_executables(editor_key);
    let mut candidates = Vec::new();

    if executable_names.is_empty() {
        return candidates;
    }

    let hives = [RegKey::predef(HKEY_CURRENT_USER), RegKey::predef(HKEY_LOCAL_MACHINE)];
    let registry_views = [KEY_READ, KEY_READ | KEY_WOW64_64KEY, KEY_READ | KEY_WOW64_32KEY];

    for hive in hives {
        for view in registry_views {
            for executable_name in &executable_names {
                let app_path_key = format!(
                    r"Software\Microsoft\Windows\CurrentVersion\App Paths\{}",
                    executable_name
                );
                if let Ok(key) = hive.open_subkey_with_flags(&app_path_key, view) {
                    if let Ok(path) = key.get_value::<String, _>("") {
                        push_unique_candidate(&mut candidates, path);
                    }
                }
            }
        }
    }

    candidates
}

#[cfg(target_os = "windows")]
fn editor_registry_display_names(editor_key: &str) -> Vec<&'static str> {
    match editor_key {
        "codebuddy" => vec!["CodeBuddy"],
        "antigravity" => vec!["Antigravity"],
        "code" => vec!["Visual Studio Code", "VS Code"],
        "cursor" => vec!["Cursor"],
        "zed" => vec!["Zed"],
        _ => Vec::new(),
    }
}

#[cfg(target_os = "windows")]
fn extract_windows_path_candidate(raw_value: &str) -> Option<String> {
    let trimmed = raw_value.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }

    let lowered = trimmed.to_ascii_lowercase();
    for extension in [".exe", ".cmd", ".bat"] {
        if let Some(index) = lowered.find(extension) {
            let end = index + extension.len();
            return Some(trimmed[..end].trim().trim_matches('"').to_string());
        }
    }

    Some(trimmed.to_string())
}

#[cfg(target_os = "windows")]
fn push_windows_registry_value_candidates(candidates: &mut Vec<String>, raw_value: &str, suffixes: &[&str]) {
    let Some(value) = extract_windows_path_candidate(raw_value) else {
        return;
    };

    let path = PathBuf::from(&value);
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());

    if matches!(extension.as_deref(), Some("exe" | "cmd" | "bat")) {
        push_unique_candidate(candidates, value);
        return;
    }

    for suffix in suffixes {
        push_unique_candidate(candidates, path.join(suffix).to_string_lossy().into_owned());
    }
}

#[cfg(target_os = "windows")]
fn windows_registry_uninstall_candidates(editor_key: &str) -> Vec<String> {
    use winreg::{
        enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY},
        RegKey,
    };

    let display_names = editor_registry_display_names(editor_key)
        .into_iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<Vec<_>>();
    let suffixes = editor_install_path_suffixes(editor_key);
    let mut candidates = Vec::new();

    if display_names.is_empty() {
        return candidates;
    }

    let hives = [RegKey::predef(HKEY_CURRENT_USER), RegKey::predef(HKEY_LOCAL_MACHINE)];
    let registry_views = [KEY_READ, KEY_READ | KEY_WOW64_64KEY, KEY_READ | KEY_WOW64_32KEY];
    let uninstall_key_path = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
    let value_names = ["DisplayIcon", "InstallLocation", "Inno Setup: App Path"];

    for hive in hives {
        for view in registry_views {
            let Ok(uninstall_key) = hive.open_subkey_with_flags(uninstall_key_path, view) else {
                continue;
            };

            for subkey_name in uninstall_key.enum_keys().flatten() {
                let Ok(subkey) = uninstall_key.open_subkey_with_flags(&subkey_name, view) else {
                    continue;
                };

                let display_name = subkey
                    .get_value::<String, _>("DisplayName")
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if !display_names.iter().any(|name| display_name.contains(name)) {
                    continue;
                }

                for value_name in value_names {
                    if let Ok(value) = subkey.get_value::<String, _>(value_name) {
                        push_windows_registry_value_candidates(&mut candidates, &value, &suffixes);
                    }
                }
            }
        }
    }

    candidates
}

#[cfg(target_os = "windows")]
fn windows_common_install_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        roots.push(PathBuf::from(&local_app_data).join("Programs"));
        roots.push(PathBuf::from(local_app_data));
    }

    for env_key in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(value) = std::env::var(env_key) {
            let root = PathBuf::from(value);
            if !roots.iter().any(|existing| existing == &root) {
                roots.push(root);
            }
        }
    }

    roots
}

#[cfg(target_os = "windows")]
fn windows_common_install_candidates(editor_key: &str) -> Vec<String> {
    let suffixes = editor_install_path_suffixes(editor_key);
    let mut candidates = Vec::new();

    for root in windows_common_install_roots() {
        for suffix in &suffixes {
            push_unique_candidate(&mut candidates, root.join(suffix).to_string_lossy().into_owned());
        }
    }

    candidates
}

#[cfg(target_os = "windows")]
fn windows_editor_launch_candidates(editor_key: &str) -> Vec<String> {
    let mut candidates = Vec::new();

    for candidate in editor_command_candidates(editor_key) {
        push_unique_candidate(&mut candidates, candidate.to_string());
    }

    for candidate in windows_registry_app_path_candidates(editor_key) {
        push_unique_candidate(&mut candidates, candidate);
    }

    for candidate in windows_registry_uninstall_candidates(editor_key) {
        push_unique_candidate(&mut candidates, candidate);
    }

    for candidate in windows_common_install_candidates(editor_key) {
        push_unique_candidate(&mut candidates, candidate);
    }

    candidates
}

#[tauri::command]
fn enter_compact_mode(window: Window, compact_width: f64) -> Result<CompactWindowLayoutPayload, String> {
    let was_maximized = window.is_maximized().map_err(|e| e.to_string())?;
    let outer_position = window.outer_position().map_err(|e| e.to_string())?;
    let outer_size = window.outer_size().map_err(|e| e.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "无法获取当前显示器信息。".to_string())?;

    if was_maximized {
        window.unmaximize().map_err(|e| e.to_string())?;
    }

    let compact_width = compact_width.round().max(1.0);
    let work_area = monitor.work_area();
    let scale_factor = monitor.scale_factor();
    let compact_height = outer_size.height.min(work_area.size.height);
    let compact_height_logical = (compact_height as f64 / scale_factor).round().max(1.0);
    let compact_width_physical = (compact_width * scale_factor).round() as i32;
    let max_visible_x = work_area.position.x + work_area.size.width as i32 - compact_width_physical;
    // 精简模式：吸顶到工作区顶部，水平位置保持在当前显示器内
    let compact_x = outer_position
        .x
        .clamp(work_area.position.x, max_visible_x.max(work_area.position.x));
    let compact_y = work_area.position.y;

    // 先置顶、再移动位置、最后缩放尺寸，避免在 Windows 上出现窗口先在旧位置缩小的视觉闪烁
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window
        .set_position(Position::Physical(PhysicalPosition::new(compact_x, compact_y)))
        .map_err(|e| e.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize::new(compact_width, compact_height_logical)))
        .map_err(|e| e.to_string())?;

    let layout = CompactWindowLayoutPayload {
        previous_position: Some(WindowPositionPayload {
            x: outer_position.x,
            y: outer_position.y,
        }),
        previous_size: Some(WindowSizePayload {
            width: outer_size.width,
            height: outer_size.height,
        }),
        was_maximized,
        compact_position: Some(WindowPositionPayload {
            x: compact_x,
            y: compact_y,
        }),
    };

    Ok(layout)
}

#[tauri::command]
fn exit_compact_mode(window: Window, layout: CompactWindowLayoutPayload) -> Result<(), String> {
    window.set_always_on_top(false).map_err(|e| e.to_string())?;

    if let Some(previous_size) = layout.previous_size {
        window
            .set_size(Size::Physical(PhysicalSize::new(previous_size.width, previous_size.height)))
            .map_err(|e| e.to_string())?;
    }

    if let Some(previous_position) = layout.previous_position {
        window
            .set_position(Position::Physical(PhysicalPosition::new(previous_position.x, previous_position.y)))
            .map_err(|e| e.to_string())?;
    }

    if layout.was_maximized {
        window.maximize().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn get_cursor_position() -> Result<WindowPositionPayload, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let mut point = POINT { x: 0, y: 0 };
        let result = unsafe { GetCursorPos(&mut point) };
        if result == 0 {
            return Err("无法获取当前鼠标位置。".to_string());
        }

        return Ok(WindowPositionPayload {
            x: point.x,
            y: point.y,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台暂不支持获取全局鼠标位置。".to_string())
    }
}

#[tauri::command]
fn open_in_editor(path: String, editor_key: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let candidates = windows_editor_launch_candidates(&editor_key);
        let mut launch_errors = Vec::new();

        for candidate in &candidates {
            let result = if candidate.ends_with(".cmd") || candidate.ends_with(".bat") {
                let mut command = Command::new("cmd");
                command.creation_flags(0x08000000);
                command.args(["/c", candidate, &path]);
                command.spawn()
            } else {
                let mut command = Command::new(candidate);
                command.creation_flags(0x08000000);
                command.arg(&path);
                command.spawn()
            };

            match result {
                Ok(_) => return Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => launch_errors.push(format!("{} -> {}", candidate, error)),
            }
        }

        if launch_errors.is_empty() {
            return Err(format!(
                "无法找到编辑器 `{}`。已尝试：{}",
                editor_key,
                candidates.join("、")
            ));
        }

        return Err(format!(
            "无法唤起编辑器 `{}`。已尝试：{}。错误：{}",
            editor_key,
            candidates.join("、"),
            launch_errors.join(" | ")
        ));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let candidates = editor_command_candidates(&editor_key);

        for candidate in &candidates {
            match Command::new(candidate).arg(&path).spawn() {
                Ok(_) => return Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.to_string()),
            }
        }

        return Err(format!(
            "无法找到编辑器命令 `{}`。请确保已将对应 CLI 加入系统环境变量 PATH 中。",
            candidates.join("`、`")
        ));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ProcessManager::new())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            parse_project_info,
            load_app_config,
            save_app_config,
            run_command,
            send_input,
            create_shell_session,
            kill_command,
            terminate_port,
            enter_compact_mode,
            exit_compact_mode,
            get_cursor_position,
            open_in_editor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
