
use std::path::Path;
use std::process::{Command, Stdio, ChildStdin};
use std::io::{BufRead, BufReader, Write};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Emitter;

use indexmap::IndexMap;
use std::fs;
use serde::{Deserialize, Serialize};

// ---------- 进程 stdin 管理器 ----------
// 保存所有正在运行的子进程 stdin 句柄，key = pid
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
        .stdin(Stdio::piped())   // ← 必须 piped 才能写入
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();

    // 保存 stdin 句柄
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

/// 向指定 PID 的子进程 stdin 写入数据
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

#[tauri::command]
fn kill_command(
    state: tauri::State<ProcessManager>,
    pid: u32,
) -> Result<(), String> {
    // 关闭 stdin 让进程感知 EOF
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

#[tauri::command]
fn open_in_editor(path: String, editor_key: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = Command::new("cmd");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        command.args(["/c", &editor_key, &path]);
    }

    #[cfg(not(target_os = "windows"))]
    let mut command = Command::new(&editor_key);
    #[cfg(not(target_os = "windows"))]
    command.arg(&path);

    command.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_terminal(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "cmd"])
            .current_dir(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("open")
            .args(["-a", "Terminal", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
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
            run_command,
            send_input,
            kill_command,
            open_in_editor,
            open_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
