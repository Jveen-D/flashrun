
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio, ChildStdin};
use std::io::{BufRead, BufReader, Write};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Emitter;

use indexmap::IndexMap;
use std::fs;
use serde::{Deserialize, Serialize};

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

    let content = fs::read_to_string(&legacy_path)
        .map_err(|e| format!("读取旧配置失败: {}", e))?;

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    fs::write(target_path, content)
        .map_err(|e| format!("迁移旧配置失败: {}", e))?;

    Ok(())
}

// ---------- 进程 stdin 管理器 ----------
struct ProcessManager {
    stdinmap: Mutex<HashMap<u32, ChildStdin>>,
}

impl ProcessManager {
    fn new() -> Self {
        Self { stdinmap: Mutex::new(HashMap::new()) }
    }
}

// ---------- 数据结构 ----------
#[derive(Serialize)]
struct ProjectInfo {
    manager: String,
    scripts: IndexMap<String, String>,
}

#[derive(Deserialize)]
struct PackageJson {
    scripts: Option<IndexMap<String, String>>,
}

// ---------- 命令 ----------

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
    } else if base_path.join("package-lock.json").exists() {
        "npm"
    } else {
        "npm"
    };

    let content = fs::read_to_string(&pkg_json_path)
        .map_err(|e| format!("读取 package.json 失败: {}", e))?;

    let parsed: PackageJson = serde_json::from_str(&content)
        .unwrap_or(PackageJson { scripts: Some(IndexMap::new()) });

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

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    if content.trim().is_empty() {
        return Ok(None);
    }

    let config = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置文件失败: {}", e))?;

    Ok(Some(config))
}

#[tauri::command]
fn save_app_config(config: serde_json::Value) -> Result<String, String> {
    let path = config_file_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建配置目录失败: {}", e))?;
    }

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;

    fs::write(&path, content)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;

    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn run_command(
    app: tauri::AppHandle,
    state: tauri::State<ProcessManager>,
    path: String,
    cmd: String,
    cmd_id: String,
) -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    let mut command = Command::new("cmd");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        command.args(["/c", &cmd]);
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
        let mut map = state.stdinmap.lock().unwrap();
        map.insert(pid, stdin);
    }

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let app_handle_out = app.clone();
    let _cid_out = cmd_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line_content) = line {
                let _ = app_handle_out.emit("terminal-out", format!("{}\r\n", line_content));
            }
        }
    });

    let app_handle_err = app.clone();
    let _cid_err = cmd_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line_content) = line {
                let _ = app_handle_err.emit("terminal-out", format!("\x1b[31m{}\x1b[0m\r\n", line_content));
            }
        }
    });

    Ok(pid)
}

/// 向指定 PID 的子进程 stdin 写入数据（用于 npm script 交互输入）
#[tauri::command]
fn send_input(
    state: tauri::State<ProcessManager>,
    pid: u32,
    data: String,
) -> Result<(), String> {
    let mut map = state.stdinmap.lock().unwrap();
    if let Some(stdin) = map.get_mut(&pid) {
        stdin.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err(format!("No process found with pid {}", pid))
    }
}

/// 为每个终端标签页创建一个持久化 shell 进程
/// session_id 对应前端 tab 的唯一 ID，输出事件为 shell-out-{session_id}
#[tauri::command]
fn create_shell_session(
    app: tauri::AppHandle,
    state: tauri::State<ProcessManager>,
    session_id: String,
    working_dir: String,
) -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd.exe");
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
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

    // 保存 stdin
    if let Some(stdin) = child.stdin.take() {
        let mut map = state.stdinmap.lock().unwrap();
        map.insert(pid, stdin);
    }

    // 流式读取 stdout
    if let Some(stdout) = child.stdout.take() {
        let app_out = app.clone();
        let sid_out = session_id.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(content) = line {
                    let _ = app_out.emit(
                        &format!("shell-out-{}", sid_out),
                        format!("{}\r\n", content),
                    );
                }
            }
        });
    }

    // 流式读取 stderr
    if let Some(stderr) = child.stderr.take() {
        let app_err = app.clone();
        let sid_err = session_id.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(content) = line {
                    let _ = app_err.emit(
                        &format!("shell-out-{}", sid_err),
                        format!("\x1b[31m{}\x1b[0m\r\n", content),
                    );
                }
            }
        });
    }

    // 回收子进程（防止僵尸进程）
    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(pid)
}

#[tauri::command]
fn kill_command(
    state: tauri::State<ProcessManager>,
    pid: u32,
) -> Result<(), String> {
    {
        let mut map = state.stdinmap.lock().unwrap();
        map.remove(&pid);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        Command::new("taskkill")
            .creation_flags(0x08000000)
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
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
fn windows_editor_launch_candidates(editor_key: &str) -> Vec<String> {
    let mut candidates = editor_command_candidates(editor_key)
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();

    match editor_key {
        "codebuddy" => {
            candidates.push(String::from(r"C:\应用\CodeBuddy\CodeBuddy.exe"));
            candidates.push(String::from(r"C:\应用\CodeBuddy CN\CodeBuddy CN.exe"));

            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                let base = PathBuf::from(local_app_data).join("Programs");
                candidates.push(base.join("CodeBuddy").join("CodeBuddy.exe").to_string_lossy().into_owned());
                candidates.push(base.join("CodeBuddy CN").join("CodeBuddy CN.exe").to_string_lossy().into_owned());
            }
        }
        "antigravity" => {
            candidates.push(String::from(r"C:\应用\Antigravity\bin\antigravity.cmd"));
            candidates.push(String::from(r"C:\应用\Antigravity\Antigravity.exe"));

            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                let base = PathBuf::from(local_app_data).join("Programs");
                candidates.push(base.join("Antigravity").join("bin").join("antigravity.cmd").to_string_lossy().into_owned());
                candidates.push(base.join("Antigravity").join("Antigravity.exe").to_string_lossy().into_owned());
            }
        }
        "code" => {
            candidates.push(String::from(r"C:\Program Files\Microsoft VS Code\Code.exe"));
            candidates.push(String::from(r"C:\Program Files (x86)\Microsoft VS Code\Code.exe"));

            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                let base = PathBuf::from(&local_app_data).join("Programs");
                candidates.push(base.join("Microsoft VS Code").join("Code.exe").to_string_lossy().into_owned());
                candidates.push(PathBuf::from(&local_app_data).join("Microsoft VS Code").join("Code.exe").to_string_lossy().into_owned());
            }
        }
        "cursor" => {
            candidates.push(String::from(r"C:\Program Files\Cursor\Cursor.exe"));

            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                let base = PathBuf::from(&local_app_data).join("Programs");
                candidates.push(base.join("Cursor").join("Cursor.exe").to_string_lossy().into_owned());
                candidates.push(PathBuf::from(&local_app_data).join("Cursor").join("Cursor.exe").to_string_lossy().into_owned());
            }
        }
        "zed" => {
            candidates.push(String::from(r"C:\Program Files\Zed\Zed.exe"));
            candidates.push(String::from(r"C:\Program Files (x86)\Zed\Zed.exe"));

            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                let base = PathBuf::from(&local_app_data).join("Programs");
                candidates.push(base.join("Zed").join("Zed.exe").to_string_lossy().into_owned());
                candidates.push(PathBuf::from(&local_app_data).join("Zed").join("Zed.exe").to_string_lossy().into_owned());
            }
        }
        _ => {}
    }

    candidates
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
        .invoke_handler(tauri::generate_handler![
            parse_project_info,
            load_app_config,
            save_app_config,
            run_command,
            send_input,
            create_shell_session,
            kill_command,
            open_in_editor,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
