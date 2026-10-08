use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use tauri::{LogicalSize, Manager, PhysicalPosition, PhysicalSize, Position, Size, Window};

mod config;
mod ports;
mod sessions;
use sessions::{Output, ProcessManager};

const CONFIG_FILE_NAME: &str = "flashrun-config.json";
#[cfg(windows)]
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
        return std::env::var("APPDATA").ok().map(|app_data| {
            PathBuf::from(app_data)
                .join(LEGACY_APP_IDENTIFIER)
                .join(CONFIG_FILE_NAME)
        });
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

    config::migrate(&legacy_path, target_path)
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
                        emit(
                            String::from_utf8_lossy(&pending[valid_end..invalid_end]).into_owned(),
                        );
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

    let content =
        fs::read_to_string(&pkg_json_path).map_err(|e| format!("读取 package.json 失败: {}", e))?;

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
async fn load_app_config(
    state: tauri::State<'_, config::ConfigFile>,
) -> Result<Option<serde_json::Value>, String> {
    let config = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        migrate_legacy_config_if_needed(&config_file_path()?)?;
        config.load()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_app_config(
    state: tauri::State<'_, config::ConfigFile>,
    config: serde_json::Value,
) -> Result<String, String> {
    let file = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || file.save(config))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn run_command(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProcessManager>,
    path: String,
    cmd: String,
    cmd_id: String,
    project_id: String,
    project_name: String,
    command_label: String,
) -> Result<u32, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.spawn(
            app,
            path,
            Some(cmd),
            Output::Command {
                project_id,
                command_id: cmd_id,
                project_name,
                command_label,
            },
            24,
            80,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn send_input(
    state: tauri::State<'_, ProcessManager>,
    pid: u32,
    data: String,
) -> Result<(), String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.input(pid, data))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn resize_session(
    state: tauri::State<ProcessManager>,
    pid: u32,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    state.resize(pid, rows, cols)
}

#[tauri::command]
async fn create_shell_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProcessManager>,
    session_id: String,
    working_dir: String,
    rows: u16,
    cols: u16,
) -> Result<u32, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.spawn(
            app,
            working_dir,
            None,
            Output::Shell(session_id),
            rows,
            cols,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn kill_command(state: tauri::State<'_, ProcessManager>, pid: u32) -> Result<(), String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.stop(pid))
        .await
        .map_err(|e| e.to_string())?
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
        "antigravity" => vec![
            r"Antigravity\Antigravity.exe",
            r"Antigravity\bin\antigravity.cmd",
        ],
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
        enums::{
            HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
        },
        RegKey,
    };

    let executable_names = editor_registry_executables(editor_key);
    let mut candidates = Vec::new();

    if executable_names.is_empty() {
        return candidates;
    }

    let hives = [
        RegKey::predef(HKEY_CURRENT_USER),
        RegKey::predef(HKEY_LOCAL_MACHINE),
    ];
    let registry_views = [
        KEY_READ,
        KEY_READ | KEY_WOW64_64KEY,
        KEY_READ | KEY_WOW64_32KEY,
    ];

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
fn push_windows_registry_value_candidates(
    candidates: &mut Vec<String>,
    raw_value: &str,
    suffixes: &[&str],
) {
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
        enums::{
            HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
        },
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

    let hives = [
        RegKey::predef(HKEY_CURRENT_USER),
        RegKey::predef(HKEY_LOCAL_MACHINE),
    ];
    let registry_views = [
        KEY_READ,
        KEY_READ | KEY_WOW64_64KEY,
        KEY_READ | KEY_WOW64_32KEY,
    ];
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
            push_unique_candidate(
                &mut candidates,
                root.join(suffix).to_string_lossy().into_owned(),
            );
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
fn enter_compact_mode(
    window: Window,
    compact_width: f64,
) -> Result<CompactWindowLayoutPayload, String> {
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
    let compact_x = outer_position.x.clamp(
        work_area.position.x,
        max_visible_x.max(work_area.position.x),
    );
    let compact_y = work_area.position.y;

    // 先置顶、再移动位置、最后缩放尺寸，避免在 Windows 上出现窗口先在旧位置缩小的视觉闪烁
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window
        .set_position(Position::Physical(PhysicalPosition::new(
            compact_x, compact_y,
        )))
        .map_err(|e| e.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize::new(
            compact_width,
            compact_height_logical,
        )))
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
            .set_size(Size::Physical(PhysicalSize::new(
                previous_size.width,
                previous_size.height,
            )))
            .map_err(|e| e.to_string())?;
    }

    if let Some(previous_position) = layout.previous_position {
        window
            .set_position(Position::Physical(PhysicalPosition::new(
                previous_position.x,
                previous_position.y,
            )))
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
        .manage(ProcessManager::default())
        .setup(|app| {
            let path = config_file_path().map_err(std::io::Error::other)?;
            app.manage(config::ConfigFile::new(path));
            Ok(())
        })
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
            resize_session,
            create_shell_session,
            kill_command,
            ports::terminate_port,
            ports::inspect_port,
            enter_compact_mode,
            exit_compact_mode,
            get_cursor_position,
            open_in_editor,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                app.state::<ProcessManager>().shutdown();
            }
        });
}
