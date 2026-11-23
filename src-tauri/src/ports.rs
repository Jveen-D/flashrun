use serde::{Deserialize, Serialize};
#[cfg(any(unix, test))]
use std::collections::BTreeMap;
use std::process::{Command, Output};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Tcp,
    Udp,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PortProcess {
    pub pid: u32,
    pub name: String,
}

fn run(program: &str, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.output().map_err(|e| format!("{program}: {e}"))
}

fn local_port(endpoint: &str) -> Option<u16> {
    endpoint
        .split("->")
        .next()?
        .split_whitespace()
        .next()?
        .rsplit_once(':')?
        .1
        .parse()
        .ok()
}

#[cfg(any(unix, test))]
fn parse_lsof(text: &str, port: u16) -> Vec<PortProcess> {
    let mut pid = 0;
    let mut name = String::new();
    let mut found = BTreeMap::new();
    for line in text.lines() {
        if let Some(value) = line.strip_prefix('p') {
            pid = value.parse().unwrap_or(0);
            name.clear();
        } else if let Some(value) = line.strip_prefix('c') {
            name = value.to_string();
        } else if let Some(value) = line.strip_prefix('n') {
            if pid > 0 && local_port(value) == Some(port) {
                found.insert(
                    pid,
                    PortProcess {
                        pid,
                        name: name.clone(),
                    },
                );
            }
        }
    }
    found.into_values().collect()
}

#[cfg(any(windows, test))]
fn parse_netstat(text: &str, port: u16, protocol: Protocol) -> Vec<u32> {
    let mut ids = std::collections::BTreeSet::new();
    for line in text.lines() {
        let columns: Vec<_> = line.split_whitespace().collect();
        let matches = match protocol {
            Protocol::Tcp => {
                columns.len() == 5
                    && columns[0].eq_ignore_ascii_case("TCP")
                    && columns[3].eq_ignore_ascii_case("LISTENING")
            }
            Protocol::Udp => columns.len() == 4 && columns[0].eq_ignore_ascii_case("UDP"),
        };
        if matches && local_port(columns[1]) == Some(port) {
            if let Some(pid) = columns
                .last()
                .and_then(|s| s.parse::<u32>().ok())
                .filter(|id| *id > 0)
            {
                ids.insert(pid);
            }
        }
    }
    ids.into_iter().collect()
}

#[cfg(windows)]
fn windows_process_name_via_api(pid: u32) -> Option<String> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        },
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return None;
        }
        let mut buffer = [0_u16; 1024];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size);
        CloseHandle(handle);
        if ok == 0 || size == 0 {
            return None;
        }
        let full_path = String::from_utf16_lossy(&buffer[..size as usize]);
        std::path::Path::new(&full_path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
    }
}

#[cfg(windows)]
fn windows_tasklist_name_map() -> Result<std::collections::HashMap<u32, String>, String> {
    let listing = run("tasklist", &["/FO", "CSV", "/NH"])?;
    if !listing.status.success() {
        return Err(String::from_utf8_lossy(&listing.stderr).into_owned());
    }
    let mut map = std::collections::HashMap::new();
    for line in String::from_utf8_lossy(&listing.stdout).lines() {
        let fields: Vec<_> = line.split("\",\"").collect();
        if let Some(pid) = fields
            .get(1)
            .and_then(|value| value.trim_matches('"').parse::<u32>().ok())
        {
            map.insert(pid, fields[0].trim_matches('"').to_string());
        }
    }
    Ok(map)
}

#[tauri::command]
pub async fn inspect_port(port: u16, protocol: Protocol) -> Result<Vec<PortProcess>, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_port_sync(port, protocol))
        .await
        .map_err(|e| e.to_string())?
}

fn inspect_port_sync(port: u16, protocol: Protocol) -> Result<Vec<PortProcess>, String> {
    if port == 0 {
        return Err("端口必须在 1-65535 之间。".into());
    }
    #[cfg(windows)]
    {
        let output = run("netstat", &["-ano"])?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        let pids = parse_netstat(&String::from_utf8_lossy(&output.stdout), port, protocol);
        if pids.is_empty() {
            return Ok(Vec::new());
        }

        let mut processes = Vec::new();
        let mut fallback_pids = Vec::new();
        for pid in pids {
            if let Some(name) = windows_process_name_via_api(pid) {
                processes.push(PortProcess { pid, name });
            } else {
                fallback_pids.push(pid);
            }
        }

        if !fallback_pids.is_empty() {
            let tasklist_names = windows_tasklist_name_map()?;
            for pid in fallback_pids {
                if let Some(name) = tasklist_names.get(&pid) {
                    processes.push(PortProcess {
                        pid,
                        name: name.clone(),
                    });
                }
            }
        }

        processes.sort_by_key(|process| process.pid);
        Ok(processes)
    }
    #[cfg(unix)]
    {
        let filter = format!(
            "-i{}:{port}",
            match protocol {
                Protocol::Tcp => "TCP",
                Protocol::Udp => "UDP",
            }
        );
        let mut args = vec!["-nP", "-a", &filter, "-Fpcn"];
        if matches!(protocol, Protocol::Tcp) {
            args.push("-sTCP:LISTEN");
        }
        let output = run("lsof", &args)?;
        if !output.status.success() {
            if output.status.code() == Some(1)
                && output.stdout.is_empty()
                && output.stderr.is_empty()
            {
                return Ok(Vec::new());
            }
            return Err(format!(
                "lsof 查询失败：{}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(parse_lsof(&String::from_utf8_lossy(&output.stdout), port))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortTermination {
    port: u16,
    killed_pids: Vec<u32>,
}

#[tauri::command]
pub async fn terminate_port(
    port: u16,
    protocol: Protocol,
    expected: Vec<PortProcessInput>,
) -> Result<PortTermination, String> {
    tauri::async_runtime::spawn_blocking(move || terminate_port_sync(port, protocol, expected))
        .await
        .map_err(|e| e.to_string())?
}

fn terminate_port_sync(
    port: u16,
    protocol: Protocol,
    expected: Vec<PortProcessInput>,
) -> Result<PortTermination, String> {
    let current = inspect_port_sync(port, protocol)?;
    let expected: Vec<_> = expected
        .into_iter()
        .map(|p| PortProcess {
            pid: p.pid,
            name: p.name,
        })
        .collect();
    if current != expected {
        return Err("端口占用进程已变化，请重新检查并确认。".into());
    }
    let mut killed_pids = Vec::new();
    for process in current {
        if process.pid == std::process::id() {
            return Err("不能通过端口操作终止 FlashRun 自身。".into());
        }
        let pid = process.pid.to_string();
        // These are external processes, not our owned PTY sessions. Never send
        // a signal to their process group or kill unrelated descendants.
        #[cfg(windows)]
        let output = run("taskkill", &["/F", "/PID", &pid])?;
        #[cfg(unix)]
        let output = run("kill", &["-KILL", &pid])?;
        if !output.status.success() {
            return Err(format!(
                "停止 {} ({}) 失败：{}",
                process.name,
                pid,
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        killed_pids.push(process.pid);
    }
    Ok(PortTermination { port, killed_pids })
}

#[derive(Deserialize)]
pub struct PortProcessInput {
    pid: u32,
    name: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_connections_do_not_match_local_port() {
        let listing = "p20\ncnode\nn127.0.0.1:3000\np30\ncclient\nn127.0.0.1:54000->127.0.0.1:3000\np40\ncnode6\nn[::1]:3000\n";
        assert_eq!(
            parse_lsof(listing, 3000)
                .iter()
                .map(|p| p.pid)
                .collect::<Vec<_>>(),
            vec![20, 40]
        );
    }
    #[test]
    fn windows_filters_listeners_and_protocol() {
        let listing = "TCP 0.0.0.0:3000 0.0.0.0:0 LISTENING 20\nTCP 127.0.0.1:3000 127.0.0.1:5555 ESTABLISHED 30\nUDP [::]:3000 *:* 40\n";
        assert_eq!(parse_netstat(listing, 3000, Protocol::Tcp), vec![20]);
        assert_eq!(parse_netstat(listing, 3000, Protocol::Udp), vec![40]);
    }
    #[cfg(windows)]
    #[test]
    fn resolves_current_process_name_without_spawning_tasklist() {
        let name = windows_process_name_via_api(std::process::id()).unwrap();
        assert!(name.to_ascii_lowercase().ends_with(".exe"));
    }
}
