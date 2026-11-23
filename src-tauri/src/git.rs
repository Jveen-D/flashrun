use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub dirty: bool,
    pub changed_count: usize,
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

pub fn parse_porcelain_v1_branch(output: &str) -> (Option<String>, usize) {
    let mut lines = output.lines();
    let Some(header) = lines.next() else {
        return (None, 0);
    };

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

    let changed_count = lines.filter(|line| !line.trim().is_empty()).count();
    (branch, changed_count)
}

fn inspect_git_status_sync(path: &str) -> GitStatus {
    if !Path::new(path).is_dir() {
        return GitStatus {
            is_repo: false,
            branch: None,
            dirty: false,
            changed_count: 0,
        };
    }

    let Some(output) = run_git(path, &["status", "--porcelain=v1", "--branch"]) else {
        return GitStatus {
            is_repo: false,
            branch: None,
            dirty: false,
            changed_count: 0,
        };
    };

    if !output.status.success() {
        return GitStatus {
            is_repo: false,
            branch: None,
            dirty: false,
            changed_count: 0,
        };
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let (mut branch, changed_count) = parse_porcelain_v1_branch(&stdout);

    if branch.is_none() {
        if let Some(rev) = run_git(path, &["rev-parse", "--short", "HEAD"]) {
            if rev.status.success() {
                let hash = String::from_utf8_lossy(&rev.stdout).trim().to_string();
                if !hash.is_empty() {
                    branch = Some(format!("detached@{hash}"));
                }
            }
        }
    }

    GitStatus {
        is_repo: true,
        branch,
        dirty: changed_count > 0,
        changed_count,
    }
}

#[tauri::command]
pub async fn get_git_status(path: String) -> Result<GitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_git_status_sync(&path))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_dirty_counts_from_porcelain_output() {
        assert_eq!(
            parse_porcelain_v1_branch(
                "## main...origin/main [ahead 1]\n M src/App.tsx\n?? new.txt\n"
            ),
            (Some("main".into()), 2)
        );
        assert_eq!(
            parse_porcelain_v1_branch("## No commits yet on feature/demo\n"),
            (Some("feature/demo".into()), 0)
        );
        assert_eq!(
            parse_porcelain_v1_branch("## HEAD (no branch)\n M file.rs\n"),
            (None, 1)
        );
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
