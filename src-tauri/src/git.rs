use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub status: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub dirty: bool,
    pub changed_count: usize,
    pub ahead: usize,
    pub behind: usize,
    pub last_commit: Option<String>,
    pub changed_files: Vec<GitChangedFile>,
    pub local_branches: Vec<String>,
}

fn empty_git_status() -> GitStatus {
    GitStatus {
        is_repo: false,
        branch: None,
        dirty: false,
        changed_count: 0,
        ahead: 0,
        behind: 0,
        last_commit: None,
        changed_files: Vec::new(),
        local_branches: Vec::new(),
    }
}

fn run_git(path: &str, args: &[&str]) -> Option<std::process::Output> {
    let mut command = Command::new("git");
    command.arg("-C").arg(path).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    if let Some(login_path) = super::sessions::unix_login_path() {
        command.env("PATH", login_path);
    }
    command.output().ok()
}

fn parse_ahead_behind(header: &str) -> (usize, usize) {
    let Some(start) = header.rfind('[') else {
        return (0, 0);
    };
    let Some(end) = header[start..].find(']') else {
        return (0, 0);
    };
    let bracket = &header[start + 1..start + end];
    let mut ahead = 0;
    let mut behind = 0;
    for part in bracket.split(',') {
        let trimmed = part.trim();
        if let Some(value) = trimmed.strip_prefix("ahead ") {
            ahead = value.trim().parse().unwrap_or(0);
        } else if let Some(value) = trimmed.strip_prefix("behind ") {
            behind = value.trim().parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

pub struct ParsedPorcelain {
    pub branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub changed_count: usize,
    pub changed_files: Vec<GitChangedFile>,
}

pub fn parse_porcelain_v1_branch(output: &str) -> ParsedPorcelain {
    let mut lines = output.lines();
    let Some(header) = lines.next() else {
        return ParsedPorcelain {
            branch: None,
            ahead: 0,
            behind: 0,
            changed_count: 0,
            changed_files: Vec::new(),
        };
    };

    let (ahead, behind) = parse_ahead_behind(header);
    let branch = header.strip_prefix("## ").and_then(|rest| {
        if let Some(name) = rest.strip_prefix("No commits yet on ") {
            Some(name.trim().to_string())
        } else if let Some(name) = rest.strip_prefix("Initial commit on ") {
            Some(name.trim().to_string())
        } else if rest.starts_with("HEAD (no branch)") {
            None
        } else {
            let clean = rest
                .split("...")
                .next()
                .unwrap_or(rest)
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim();
            (!clean.is_empty()).then(|| clean.to_string())
        }
    });

    let mut changed_count = 0;
    let mut changed_files = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        changed_count += 1;
        if changed_files.len() < 30 && line.len() >= 3 {
            let raw_status = line[..2].trim();
            let status = if raw_status.is_empty() {
                "M".to_string()
            } else {
                raw_status.to_string()
            };
            let file_path = line[3..].trim().trim_matches('"').to_string();
            changed_files.push(GitChangedFile {
                status,
                path: file_path,
            });
        }
    }

    ParsedPorcelain {
        branch,
        ahead,
        behind,
        changed_count,
        changed_files,
    }
}

fn inspect_git_status_sync(path: &str) -> GitStatus {
    if !Path::new(path).is_dir() {
        return empty_git_status();
    }

    let Some(output) = run_git(path, &["status", "--porcelain=v1", "--branch"]) else {
        return empty_git_status();
    };

    if !output.status.success() {
        return empty_git_status();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut parsed = parse_porcelain_v1_branch(&stdout);

    if parsed.branch.is_none() {
        if let Some(rev) = run_git(path, &["rev-parse", "--short", "HEAD"]) {
            if rev.status.success() {
                let hash = String::from_utf8_lossy(&rev.stdout).trim().to_string();
                if !hash.is_empty() {
                    parsed.branch = Some(format!("detached@{hash}"));
                }
            }
        }
    }

    let last_commit = run_git(path, &["log", "-1", "--format=%h %s (%cr)"])
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|text| !text.is_empty());

    let local_branches = run_git(
        path,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/heads/",
        ],
    )
    .filter(|out| out.status.success())
    .map(|out| {
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect()
    })
    .unwrap_or_default();

    GitStatus {
        is_repo: true,
        branch: parsed.branch,
        dirty: parsed.changed_count > 0,
        changed_count: parsed.changed_count,
        ahead: parsed.ahead,
        behind: parsed.behind,
        last_commit,
        changed_files: parsed.changed_files,
        local_branches,
    }
}

fn validate_branch_name(branch: &str) -> Result<&str, String> {
    let trimmed = branch.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('-')
        || trimmed.contains("..")
        || trimmed.chars().any(char::is_whitespace)
    {
        return Err("无效的分支名称。".into());
    }
    Ok(trimmed)
}

#[tauri::command]
pub async fn get_git_status(path: String) -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_git_status_sync(&path))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_checkout_branch(path: String, branch: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let branch = validate_branch_name(&branch)?;
        let output = run_git(&path, &["checkout", branch])
            .ok_or_else(|| "无法执行 git 命令，请确认已安装 Git。".to_string())?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if err.is_empty() {
                format!("切换分支 `{branch}` 失败。")
            } else {
                err
            });
        }
        let message = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Ok(if !message.is_empty() { message } else { stderr })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_sync_action(path: String, action: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let args: &[&str] = match action.as_str() {
            "fetch" => &["fetch", "--prune"],
            "pull" => &["pull"],
            _ => return Err("不支持的 Git 操作。".into()),
        };
        let output = run_git(&path, args)
            .ok_or_else(|| "无法执行 git 命令，请确认已安装 Git。".to_string())?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if err.is_empty() {
                format!("git {action} 执行失败。")
            } else {
                err
            });
        }
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Ok(if !stdout.is_empty() { stdout } else { stderr })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_ahead_behind_and_changed_files() {
        let parsed = parse_porcelain_v1_branch(
            "## main...origin/main [ahead 2, behind 1]\n M src/App.tsx\n?? new.txt\nR  old.ts -> new.ts\n",
        );
        assert_eq!(parsed.branch.as_deref(), Some("main"));
        assert_eq!(parsed.ahead, 2);
        assert_eq!(parsed.behind, 1);
        assert_eq!(parsed.changed_count, 3);
        assert_eq!(
            parsed.changed_files,
            vec![
                GitChangedFile {
                    status: "M".into(),
                    path: "src/App.tsx".into()
                },
                GitChangedFile {
                    status: "??".into(),
                    path: "new.txt".into()
                },
                GitChangedFile {
                    status: "R".into(),
                    path: "old.ts -> new.ts".into()
                },
            ]
        );

        let unborn = parse_porcelain_v1_branch("## No commits yet on feature/demo\n");
        assert_eq!(unborn.branch.as_deref(), Some("feature/demo"));
        assert_eq!(unborn.changed_count, 0);

        let detached = parse_porcelain_v1_branch("## HEAD (no branch)\n M file.rs\n");
        assert_eq!(detached.branch, None);
        assert_eq!(detached.changed_count, 1);
    }

    #[test]
    fn rejects_unsafe_branch_names() {
        assert!(validate_branch_name("--help").is_err());
        assert!(validate_branch_name("main..dev").is_err());
        assert!(validate_branch_name("feat/git-popover").is_ok());
    }

    #[test]
    fn non_git_directory_returns_is_repo_false() {
        let dir = tempfile::tempdir().unwrap();
        let status = inspect_git_status_sync(&dir.path().to_string_lossy());
        assert!(!status.is_repo);
        assert_eq!(status.branch, None);
        assert!(!status.dirty);
    }
}
