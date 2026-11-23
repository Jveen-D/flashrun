use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use tauri::Manager;

mod config;
mod ports;
mod sessions;
mod tray;
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
        std::env::var("APPDATA").ok().map(|app_data| {
            PathBuf::from(app_data)
                .join(LEGACY_APP_IDENTIFIER)
                .join(CONFIG_FILE_NAME)
        })
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

#[derive(Debug, PartialEq, Eq, Serialize)]
struct DetectedCommand {
    label: String,
    cmd: String,
}

#[derive(Serialize)]
struct ProjectInfo {
    manager: String,
    scripts: IndexMap<String, String>,
    commands: Vec<DetectedCommand>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageJson {
    scripts: Option<IndexMap<String, String>>,
    package_manager: Option<String>,
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

fn detect_node_manager(base_path: &Path, package_manager_field: Option<&str>) -> &'static str {
    if base_path.join("pnpm-lock.yaml").exists() {
        "pnpm"
    } else if base_path.join("yarn.lock").exists() {
        "yarn"
    } else if base_path.join("bun.lock").exists() || base_path.join("bun.lockb").exists() {
        "bun"
    } else if let Some(raw) = package_manager_field {
        let name = raw.split('@').next().unwrap_or("").trim();
        match name {
            "pnpm" => "pnpm",
            "yarn" => "yarn",
            "bun" => "bun",
            "npm" => "npm",
            _ => "npm",
        }
    } else {
        "npm"
    }
}

fn parse_makefile_targets(content: &str) -> Vec<DetectedCommand> {
    let mut commands = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in content.lines() {
        if line.starts_with('\t') || line.starts_with(' ') || line.starts_with('#') {
            continue;
        }
        let Some((lhs, rhs)) = line.split_once(':') else {
            continue;
        };
        if rhs.starts_with('=') {
            continue;
        }
        let target = lhs.trim();
        if target.is_empty()
            || target.starts_with('.')
            || target.contains(' ')
            || target.contains('$')
            || target.contains('%')
            || target.contains('=')
        {
            continue;
        }
        if target
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
            && seen.insert(target.to_string())
        {
            commands.push(DetectedCommand {
                label: target.to_string(),
                cmd: format!("make {target}"),
            });
        }
    }

    commands
}

fn detected_commands_for_non_node(base_path: &Path) -> (&'static str, Vec<DetectedCommand>) {
    if base_path.join("Cargo.toml").exists() {
        return (
            "cargo",
            vec![
                DetectedCommand {
                    label: "run".into(),
                    cmd: "cargo run".into(),
                },
                DetectedCommand {
                    label: "build".into(),
                    cmd: "cargo build".into(),
                },
                DetectedCommand {
                    label: "test".into(),
                    cmd: "cargo test".into(),
                },
                DetectedCommand {
                    label: "check".into(),
                    cmd: "cargo check".into(),
                },
            ],
        );
    }

    if base_path.join("go.mod").exists() {
        return (
            "go",
            vec![
                DetectedCommand {
                    label: "run".into(),
                    cmd: "go run .".into(),
                },
                DetectedCommand {
                    label: "build".into(),
                    cmd: "go build ./...".into(),
                },
                DetectedCommand {
                    label: "test".into(),
                    cmd: "go test ./...".into(),
                },
            ],
        );
    }

    if base_path.join("pyproject.toml").exists() || base_path.join("requirements.txt").exists() {
        let (manager, test_cmd) = if base_path.join("uv.lock").exists() {
            ("uv", "uv run pytest")
        } else if base_path.join("poetry.lock").exists() {
            ("poetry", "poetry run pytest")
        } else {
            ("python", "pytest")
        };

        let mut commands = Vec::new();
        if base_path.join("manage.py").exists() {
            commands.push(DetectedCommand {
                label: "runserver".into(),
                cmd: match manager {
                    "uv" => "uv run python manage.py runserver".into(),
                    "poetry" => "poetry run python manage.py runserver".into(),
                    _ => "python manage.py runserver".into(),
                },
            });
        }
        commands.push(DetectedCommand {
            label: "test".into(),
            cmd: test_cmd.into(),
        });
        return (manager, commands);
    }

    for makefile_name in ["Makefile", "makefile"] {
        let makefile_path = base_path.join(makefile_name);
        if makefile_path.is_file() {
            let commands = fs::read_to_string(&makefile_path)
                .map(|content| parse_makefile_targets(&content))
                .unwrap_or_default();
            return ("make", commands);
        }
    }

    let has_compose = [
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
    ]
    .iter()
    .any(|name| base_path.join(name).exists());

    if has_compose {
        return (
            "docker",
            vec![
                DetectedCommand {
                    label: "up".into(),
                    cmd: "docker compose up".into(),
                },
                DetectedCommand {
                    label: "up-d".into(),
                    cmd: "docker compose up -d".into(),
                },
                DetectedCommand {
                    label: "down".into(),
                    cmd: "docker compose down".into(),
                },
                DetectedCommand {
                    label: "logs".into(),
                    cmd: "docker compose logs -f".into(),
                },
            ],
        );
    }

    ("custom", Vec::new())
}

#[tauri::command]
fn parse_project_info(path: String) -> Result<ProjectInfo, String> {
    let base_path = Path::new(&path);
    if !base_path.is_dir() {
        return Err("目录不存在或无法访问。".to_string());
    }

    let pkg_json_path = base_path.join("package.json");
    if pkg_json_path.is_file() {
        let content = fs::read_to_string(&pkg_json_path)
            .map_err(|e| format!("读取 package.json 失败: {}", e))?;

        let parsed: PackageJson =
            serde_json::from_str(&content).map_err(|e| format!("解析 package.json 失败: {}", e))?;

        let manager = detect_node_manager(base_path, parsed.package_manager.as_deref());
        let scripts = parsed.scripts.unwrap_or_default();
        let commands = scripts
            .keys()
            .map(|key| DetectedCommand {
                label: key.clone(),
                cmd: format!("{manager} run {key}"),
            })
            .collect();

        return Ok(ProjectInfo {
            manager: manager.to_string(),
            scripts,
            commands,
        });
    }

    let (manager, commands) = detected_commands_for_non_node(base_path);
    Ok(ProjectInfo {
        manager: manager.to_string(),
        scripts: IndexMap::new(),
        commands,
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

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePackage {
    name: String,
    relative_path: String,
    manager: String,
    scripts: IndexMap<String, String>,
}

fn parse_dotenv(content: &str) -> IndexMap<String, String> {
    let mut vars = IndexMap::new();
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").map(str::trim).unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        let raw_val = value.trim();
        let parsed = if (raw_val.starts_with('"') && raw_val.ends_with('"') && raw_val.len() >= 2)
            || (raw_val.starts_with('\'') && raw_val.ends_with('\'') && raw_val.len() >= 2)
        {
            raw_val[1..raw_val.len() - 1].to_string()
        } else {
            raw_val
                .split(" #")
                .next()
                .unwrap_or(raw_val)
                .trim()
                .to_string()
        };
        vars.insert(key.to_string(), parsed);
    }
    vars
}

fn resolve_command_cwd(project_root: &Path, cwd: Option<&str>) -> Result<PathBuf, String> {
    let target = match cwd.map(str::trim).filter(|value| !value.is_empty()) {
        Some(sub) => {
            let sub_path = Path::new(sub);
            if sub_path.is_absolute() {
                sub_path.to_path_buf()
            } else {
                project_root.join(sub_path)
            }
        }
        None => project_root.to_path_buf(),
    };
    if !target.is_dir() {
        return Err(format!("工作目录不存在：{}", target.display()));
    }
    Ok(target)
}

fn resolve_command_env(
    project_root: &Path,
    effective_cwd: &Path,
    env_file: Option<&str>,
    env_vars: Option<IndexMap<String, String>>,
) -> Result<Option<IndexMap<String, String>>, String> {
    let mut merged = IndexMap::new();

    if let Some(raw_file) = env_file.map(str::trim).filter(|value| !value.is_empty()) {
        let candidate = Path::new(raw_file);
        let file_path = if candidate.is_absolute() {
            candidate.to_path_buf()
        } else {
            let in_cwd = effective_cwd.join(candidate);
            if in_cwd.is_file() {
                in_cwd
            } else {
                project_root.join(candidate)
            }
        };
        let content = fs::read_to_string(&file_path)
            .map_err(|e| format!("读取环境变量文件 {} 失败: {}", file_path.display(), e))?;
        for (k, v) in parse_dotenv(&content) {
            merged.insert(k, v);
        }
    }

    if let Some(explicit) = env_vars {
        for (k, v) in explicit {
            let key = k.trim();
            if !key.is_empty() {
                merged.insert(key.to_string(), v);
            }
        }
    }

    if merged.is_empty() {
        Ok(None)
    } else {
        Ok(Some(merged))
    }
}

fn parse_pnpm_workspace_patterns(content: &str) -> Vec<String> {
    let mut patterns = Vec::new();
    let mut in_packages = false;
    for raw_line in content.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if !raw_line.starts_with(' ') && !raw_line.starts_with('\t') {
            in_packages = trimmed.starts_with("packages:");
            continue;
        }
        if in_packages {
            if let Some(item) = trimmed.strip_prefix('-') {
                let cleaned = item
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .trim_end_matches('/')
                    .to_string();
                if !cleaned.is_empty() && !cleaned.starts_with('!') {
                    patterns.push(cleaned);
                }
            }
        }
    }
    patterns
}

fn parse_package_json_workspace_patterns(root: &Path) -> Vec<String> {
    let Ok(content) = fs::read_to_string(root.join("package.json")) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Vec::new();
    };
    let Some(workspaces) = value.get("workspaces") else {
        return Vec::new();
    };
    let list = workspaces
        .as_array()
        .or_else(|| workspaces.get("packages").and_then(|v| v.as_array()));
    let Some(list) = list else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|item| item.as_str())
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty() && !s.starts_with('!'))
        .collect()
}

fn expand_workspace_pattern(root: &Path, pattern: &str) -> Vec<PathBuf> {
    let normalized = pattern.trim_matches('/');
    if normalized.is_empty() {
        return Vec::new();
    }
    if let Some(prefix) = normalized.strip_suffix("/*") {
        let base = if prefix.is_empty() {
            root.to_path_buf()
        } else {
            root.join(prefix)
        };
        let Ok(entries) = fs::read_dir(&base) else {
            return Vec::new();
        };
        let mut dirs: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir() && path.join("package.json").is_file())
            .collect();
        dirs.sort();
        return dirs;
    }
    if !normalized.contains('*') {
        let dir = root.join(normalized);
        if dir.is_dir() && dir.join("package.json").is_file() {
            return vec![dir];
        }
    }
    Vec::new()
}

#[tauri::command]
fn detect_workspace_packages(path: String) -> Result<Vec<WorkspacePackage>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err("项目目录不存在或无法访问。".into());
    }

    let mut patterns = Vec::new();
    let pnpm_ws = root.join("pnpm-workspace.yaml");
    if pnpm_ws.is_file() {
        if let Ok(content) = fs::read_to_string(&pnpm_ws) {
            patterns.extend(parse_pnpm_workspace_patterns(&content));
        }
    }
    if patterns.is_empty() {
        patterns.extend(parse_package_json_workspace_patterns(root));
    }

    let root_manager = detect_node_manager(root, None).to_string();
    let mut seen = std::collections::HashSet::new();
    let mut packages = Vec::new();

    for pattern in patterns {
        for pkg_dir in expand_workspace_pattern(root, &pattern) {
            let Ok(rel) = pkg_dir.strip_prefix(root) else {
                continue;
            };
            let relative_path = rel.to_string_lossy().replace('\\', "/");
            if !seen.insert(relative_path.clone()) {
                continue;
            }
            let Ok(content) = fs::read_to_string(pkg_dir.join("package.json")) else {
                continue;
            };
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
                continue;
            };
            let scripts: IndexMap<String, String> = json
                .get("scripts")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            if scripts.is_empty() {
                continue;
            }
            let name = json
                .get("name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| relative_path.clone());
            packages.push(WorkspacePackage {
                name,
                relative_path,
                manager: root_manager.clone(),
                scripts,
            });
        }
    }

    Ok(packages)
}

fn normalize_pty_dimensions(rows: Option<u16>, cols: Option<u16>) -> (u16, u16) {
    let rows = rows.filter(|&r| (1..=1000).contains(&r)).unwrap_or(24);
    let cols = cols.filter(|&c| (1..=1000).contains(&c)).unwrap_or(80);
    (rows, cols)
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
    rows: Option<u16>,
    cols: Option<u16>,
    cwd: Option<String>,
    env_vars: Option<IndexMap<String, String>>,
    env_file: Option<String>,
) -> Result<u32, String> {
    let manager = state.inner().clone();
    let (rows, cols) = normalize_pty_dimensions(rows, cols);
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = PathBuf::from(&path);
        let effective_cwd = resolve_command_cwd(&project_root, cwd.as_deref())?;
        let merged_env =
            resolve_command_env(&project_root, &effective_cwd, env_file.as_deref(), env_vars)?;
        manager.spawn(
            app,
            effective_cwd.to_string_lossy().into_owned(),
            Some(cmd),
            None,
            merged_env,
            Output::Command {
                project_id,
                command_id: cmd_id,
                project_name,
                command_label,
            },
            rows,
            cols,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_text_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs::write(&path, content).map_err(|e| format!("写入文件失败: {}", e))
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
fn list_available_shells() -> Vec<sessions::ShellOption> {
    sessions::list_available_shells()
}

#[tauri::command]
async fn create_shell_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProcessManager>,
    session_id: String,
    working_dir: String,
    rows: u16,
    cols: u16,
    shell: Option<String>,
) -> Result<u32, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.spawn(
            app,
            working_dir,
            None,
            shell,
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

        Err(format!(
            "无法唤起编辑器 `{}`。已尝试：{}。错误：{}",
            editor_key,
            candidates.join("、"),
            launch_errors.join(" | ")
        ))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut tried = Vec::new();
        let login_path = sessions::unix_login_path();

        for candidate in editor_command_candidates(&editor_key) {
            if candidate.ends_with(".exe") || candidate.ends_with(".cmd") {
                continue;
            }
            tried.push(candidate.to_string());
            let mut command = Command::new(candidate);
            if let Some(path_env) = login_path {
                command.env("PATH", path_env);
            }
            match command.arg(&path).spawn() {
                Ok(_) => return Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.to_string()),
            }
        }

        #[cfg(target_os = "macos")]
        {
            let app_specs: Vec<(&str, Option<&str>)> = match editor_key.as_str() {
                "code" => vec![(
                    "Visual Studio Code.app",
                    Some("Contents/Resources/app/bin/code"),
                )],
                "cursor" => vec![("Cursor.app", Some("Contents/Resources/app/bin/cursor"))],
                "zed" => vec![("Zed.app", Some("Contents/MacOS/cli"))],
                "antigravity" => vec![(
                    "Antigravity.app",
                    Some("Contents/Resources/app/bin/antigravity"),
                )],
                "codebuddy" => vec![
                    (
                        "CodeBuddy.app",
                        Some("Contents/Resources/app/bin/codebuddy"),
                    ),
                    ("CodeBuddy CN.app", None),
                ],
                _ => Vec::new(),
            };

            let mut app_roots = vec![PathBuf::from("/Applications")];
            if let Ok(home) = std::env::var("HOME") {
                app_roots.push(PathBuf::from(home).join("Applications"));
            }

            for root in &app_roots {
                for (app_bundle, cli_rel) in &app_specs {
                    let bundle_path = root.join(app_bundle);
                    if !bundle_path.exists() {
                        continue;
                    }
                    if let Some(rel) = cli_rel {
                        let cli_path = bundle_path.join(rel);
                        if cli_path.is_file() {
                            tried.push(cli_path.to_string_lossy().into_owned());
                            let mut command = Command::new(&cli_path);
                            if let Some(path_env) = login_path {
                                command.env("PATH", path_env);
                            }
                            if command.arg(&path).spawn().is_ok() {
                                return Ok(());
                            }
                        }
                    }

                    let bundle_str = bundle_path.to_string_lossy().into_owned();
                    tried.push(format!("open -a {bundle_str}"));
                    if Command::new("open")
                        .args(["-a", &bundle_str, &path])
                        .spawn()
                        .is_ok()
                    {
                        return Ok(());
                    }
                }
            }
        }

        Err(format!(
            "无法找到编辑器 `{}`。已尝试：{}。请确保已安装该编辑器或其 CLI 在 PATH 中。",
            editor_key,
            tried.join("、")
        ))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ProcessManager::default())
        .setup(|app| {
            let path = config_file_path().map_err(std::io::Error::other)?;
            app.manage(config::ConfigFile::new(path));
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            parse_project_info,
            detect_workspace_packages,
            load_app_config,
            save_app_config,
            run_command,
            send_input,
            resize_session,
            list_available_shells,
            create_shell_session,
            kill_command,
            ports::terminate_port,
            ports::inspect_port,
            open_in_editor,
            export_text_file,
            tray::sync_tray_menu,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_bun_lockfile_and_package_manager_field() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("package.json"),
            r#"{"scripts":{"dev":"vite","build":"vite build"}}"#,
        )
        .unwrap();
        fs::write(dir.path().join("bun.lock"), "").unwrap();

        let info = parse_project_info(dir.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(info.manager, "bun");
        assert_eq!(
            info.commands,
            vec![
                DetectedCommand {
                    label: "dev".into(),
                    cmd: "bun run dev".into()
                },
                DetectedCommand {
                    label: "build".into(),
                    cmd: "bun run build".into()
                },
            ]
        );

        let dir_pm = tempfile::tempdir().unwrap();
        fs::write(
            dir_pm.path().join("package.json"),
            r#"{"packageManager":"pnpm@10.34.6","scripts":{"lint":"eslint"}}"#,
        )
        .unwrap();
        let info_pm = parse_project_info(dir_pm.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(info_pm.manager, "pnpm");
    }

    #[test]
    fn reports_error_for_malformed_package_json() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("package.json"), "{ invalid json").unwrap();
        let err = parse_project_info(dir.path().to_string_lossy().into_owned())
            .err()
            .unwrap();
        assert!(err.contains("解析 package.json 失败"));
    }

    #[test]
    fn detects_non_node_projects_and_custom_directories() {
        let cargo_dir = tempfile::tempdir().unwrap();
        fs::write(cargo_dir.path().join("Cargo.toml"), "[package]\nname=\"x\"").unwrap();
        let cargo_info =
            parse_project_info(cargo_dir.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(cargo_info.manager, "cargo");
        assert!(cargo_info.commands.iter().any(|c| c.cmd == "cargo test"));

        let make_dir = tempfile::tempdir().unwrap();
        fs::write(
            make_dir.path().join("Makefile"),
            ".PHONY: dev build\nVAR := 1\ndev:\n\techo dev\nbuild: dev\n\techo build\n",
        )
        .unwrap();
        let make_info = parse_project_info(make_dir.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(make_info.manager, "make");
        assert_eq!(
            make_info.commands,
            vec![
                DetectedCommand {
                    label: "dev".into(),
                    cmd: "make dev".into()
                },
                DetectedCommand {
                    label: "build".into(),
                    cmd: "make build".into()
                },
            ]
        );

        let empty_dir = tempfile::tempdir().unwrap();
        let empty_info =
            parse_project_info(empty_dir.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(empty_info.manager, "custom");
        assert!(empty_info.commands.is_empty());
    }

    #[test]
    fn normalizes_pty_dimensions_with_safe_fallback() {
        assert_eq!(normalize_pty_dimensions(None, None), (24, 80));
        assert_eq!(normalize_pty_dimensions(Some(0), Some(1200)), (24, 80));
        assert_eq!(normalize_pty_dimensions(Some(42), Some(140)), (42, 140));
    }

    #[test]
    fn parses_dotenv_and_merges_with_explicit_overrides() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join(".env.local"),
            "# comment\nPORT=4000\nexport API_URL=\"http://localhost:8080\"\nQUOTED='hello world'\n",
        )
        .unwrap();
        let mut overrides = IndexMap::new();
        overrides.insert("PORT".into(), "5000".into());

        let merged =
            resolve_command_env(dir.path(), dir.path(), Some(".env.local"), Some(overrides))
                .unwrap()
                .unwrap();
        assert_eq!(merged.get("PORT").map(String::as_str), Some("5000"));
        assert_eq!(
            merged.get("API_URL").map(String::as_str),
            Some("http://localhost:8080")
        );
        assert_eq!(
            merged.get("QUOTED").map(String::as_str),
            Some("hello world")
        );
    }

    #[test]
    fn detects_pnpm_monorepo_workspace_packages() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("pnpm-lock.yaml"), "").unwrap();
        fs::write(
            dir.path().join("pnpm-workspace.yaml"),
            "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("apps/web")).unwrap();
        fs::write(
            dir.path().join("apps/web/package.json"),
            r#"{"name":"@demo/web","scripts":{"dev":"vite","build":"vite build"}}"#,
        )
        .unwrap();

        let pkgs = detect_workspace_packages(dir.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(pkgs.len(), 1);
        assert_eq!(pkgs[0].name, "@demo/web");
        assert_eq!(pkgs[0].relative_path, "apps/web");
        assert_eq!(pkgs[0].manager, "pnpm");
        assert!(pkgs[0].scripts.contains_key("dev"));
    }
}
