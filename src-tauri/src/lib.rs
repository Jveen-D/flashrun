
use std::path::Path;
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use tauri::Emitter;



use indexmap::IndexMap;
use std::fs;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct ProjectInfo {
    manager: String,
    scripts: IndexMap<String, String>,
}

#[derive(Deserialize)]
struct PackageJson {
    scripts: Option<IndexMap<String, String>>,
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
    } else if base_path.join("package-lock.json").exists() {
        "npm"
    } else {
        "npm"
    };

    let content = fs::read_to_string(&pkg_json_path)
        .map_err(|e| format!("读取 package.json 失败: {}", e))?;
    
    // 如果解析失败，可能是空文件或者非法 JSON，安全回退
    let parsed: PackageJson = serde_json::from_str(&content)
        .unwrap_or(PackageJson { scripts: Some(IndexMap::new()) });
    
    let scripts = parsed.scripts.unwrap_or_default();

    Ok(ProjectInfo {
        manager: manager.to_string(),
        scripts,
    })
}

#[tauri::command]
fn run_command(app: tauri::AppHandle, path: String, cmd: String, cmd_id: String) -> Result<u32, String> {
    #[cfg(target_os = "windows")]
    let mut command = Command::new("cmd");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW flag
        command.creation_flags(0x08000000);
        command.args(["/c", &cmd]);
    }

    #[cfg(not(target_os = "windows"))]
    let mut command = Command::new("sh");
    #[cfg(not(target_os = "windows"))]
    command.args(["-c", &cmd]);

    command
        .current_dir(&path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let app_handle_out = app.clone();
    let _cid_out = cmd_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line_content) = line {
                // 向前端 emit terminal-out 事件（包含 cmd_id 以供后续区分）
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
                // 用红颜色区分 stderr 输出
                let _ = app_handle_err.emit("terminal-out", format!("\x1b[31m{}\x1b[0m\r\n", line_content));
            }
        }
    });

    Ok(pid)
}

#[tauri::command]
fn kill_command(pid: u32) -> Result<(), String> {
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
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            parse_project_info, 
            run_command, 
            kill_command, 
            open_in_editor,
            open_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
