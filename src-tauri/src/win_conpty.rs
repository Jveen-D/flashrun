use std::{
    collections::BTreeMap,
    ffi::c_void,
    fs::File,
    io::{Read, Write},
    mem::{size_of, zeroed},
    os::windows::io::FromRawHandle,
    ptr::{null, null_mut},
    sync::Mutex,
};

use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0},
    System::{
        Console::{ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON},
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Pipes::CreatePipe,
        Threading::{
            CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
            InitializeProcThreadAttributeList, ResumeThread, TerminateProcess,
            UpdateProcThreadAttribute, WaitForSingleObject, CREATE_SUSPENDED,
            CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, INFINITE,
            PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, STARTF_USESTDHANDLES,
            STARTUPINFOEXW,
        },
    },
};

fn to_wide_null(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn build_environment_block(extra: &[(String, String)]) -> Vec<u16> {
    let mut env_map: BTreeMap<String, (String, String)> = BTreeMap::new();
    for (key, value) in std::env::vars_os() {
        let key_str = key.to_string_lossy().into_owned();
        let val_str = value.to_string_lossy().into_owned();
        env_map.insert(key_str.to_ascii_uppercase(), (key_str, val_str));
    }
    for (key, value) in extra {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            env_map.insert(
                trimmed.to_ascii_uppercase(),
                (trimmed.to_string(), value.clone()),
            );
        }
    }

    let mut block = Vec::new();
    for (_, (key, value)) in env_map {
        block.extend(key.encode_utf16());
        block.push(b'=' as u16);
        block.extend(value.encode_utf16());
        block.push(0);
    }
    block.push(0);
    block
}

pub struct ProcessTree(HANDLE);

unsafe impl Send for ProcessTree {}
unsafe impl Sync for ProcessTree {}

impl ProcessTree {
    fn from_process_handle(process: HANDLE) -> Result<Self, String> {
        unsafe {
            let job = CreateJobObjectW(null(), null());
            if job.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let tree = Self(job);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
            if AssignProcessToJobObject(job, process) == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            Ok(tree)
        }
    }

    pub fn stop(&self) -> Result<(), String> {
        if unsafe { TerminateJobObject(self.0, 1) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
}

impl Drop for ProcessTree {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

pub struct WinConPty {
    hpc: Mutex<Option<HPCON>>,
    size: Mutex<(u16, u16)>,
}

unsafe impl Send for WinConPty {}
unsafe impl Sync for WinConPty {}

impl WinConPty {
    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let guard = self.hpc.lock().map_err(|e| e.to_string())?;
        let Some(hpc) = *guard else {
            return Err("终端会话已关闭。".into());
        };
        let hr = unsafe {
            ResizePseudoConsole(
                hpc,
                COORD {
                    X: cols as i16,
                    Y: rows as i16,
                },
            )
        };
        if hr != 0 {
            return Err(format!("调整 ConPTY 尺寸失败 (HRESULT: 0x{:08x})", hr));
        }
        if let Ok(mut size) = self.size.lock() {
            *size = (rows, cols);
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn get_size(&self) -> (u16, u16) {
        *self.size.lock().unwrap()
    }

    pub fn close(&self) {
        if let Ok(mut guard) = self.hpc.lock() {
            if let Some(hpc) = guard.take() {
                unsafe {
                    ClosePseudoConsole(hpc);
                }
            }
        }
    }
}

impl Drop for WinConPty {
    fn drop(&mut self) {
        self.close();
    }
}

pub struct WinChild {
    handle: HANDLE,
}

unsafe impl Send for WinChild {}
unsafe impl Sync for WinChild {}

impl WinChild {
    pub fn wait_blocking(&self) -> Result<i32, String> {
        let wait_result = unsafe { WaitForSingleObject(self.handle, INFINITE) };
        if wait_result != WAIT_OBJECT_0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut code: u32 = 0;
        if unsafe { GetExitCodeProcess(self.handle, &mut code) } == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(code as i32)
    }

    #[cfg(test)]
    pub fn try_wait(&self) -> Result<Option<i32>, String> {
        let wait_result = unsafe { WaitForSingleObject(self.handle, 0) };
        if wait_result == WAIT_OBJECT_0 {
            let mut code: u32 = 0;
            if unsafe { GetExitCodeProcess(self.handle, &mut code) } == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            Ok(Some(code as i32))
        } else {
            Ok(None)
        }
    }

    pub fn wait_timeout(&self, timeout_ms: u32) -> Result<Option<i32>, String> {
        let wait_result = unsafe { WaitForSingleObject(self.handle, timeout_ms) };
        if wait_result == WAIT_OBJECT_0 {
            let mut code: u32 = 0;
            if unsafe { GetExitCodeProcess(self.handle, &mut code) } == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            Ok(Some(code as i32))
        } else {
            Ok(None)
        }
    }

    pub fn kill(&self) {
        unsafe {
            let _ = TerminateProcess(self.handle, 1);
        }
    }
}

impl Drop for WinChild {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

pub struct SpawnedWinConPty {
    pub child: WinChild,
    pub pty: WinConPty,
    pub writer: Box<dyn Write + Send>,
    pub reader: Box<dyn Read + Send>,
    pub tree: ProcessTree,
}

pub fn spawn_conpty(
    command_line: &str,
    working_dir: &str,
    env_extra: &[(String, String)],
    rows: u16,
    cols: u16,
) -> Result<SpawnedWinConPty, String> {
    unsafe {
        let mut pty_in_read: HANDLE = INVALID_HANDLE_VALUE;
        let mut pty_in_write: HANDLE = INVALID_HANDLE_VALUE;
        let mut pty_out_read: HANDLE = INVALID_HANDLE_VALUE;
        let mut pty_out_write: HANDLE = INVALID_HANDLE_VALUE;

        if CreatePipe(&mut pty_in_read, &mut pty_in_write, null(), 0) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        if CreatePipe(&mut pty_out_read, &mut pty_out_write, null(), 0) == 0 {
            CloseHandle(pty_in_read);
            CloseHandle(pty_in_write);
            return Err(std::io::Error::last_os_error().to_string());
        }

        let mut hpc: HPCON = 0;
        let hr = CreatePseudoConsole(
            COORD {
                X: cols as i16,
                Y: rows as i16,
            },
            pty_in_read,
            pty_out_write,
            0,
            &mut hpc,
        );
        CloseHandle(pty_in_read);
        CloseHandle(pty_out_write);

        if hr != 0 {
            CloseHandle(pty_in_write);
            CloseHandle(pty_out_read);
            return Err(format!("创建 ConPTY 失败 (HRESULT: 0x{:08x})", hr));
        }

        let pty = WinConPty {
            hpc: Mutex::new(Some(hpc)),
            size: Mutex::new((rows, cols)),
        };

        let mut attr_size: usize = 0;
        InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut attr_size);
        let word_count = attr_size.div_ceil(size_of::<usize>());
        let mut attr_buffer = vec![0_usize; word_count.max(1)];
        let attr_list = attr_buffer.as_mut_ptr() as *mut c_void;

        if InitializeProcThreadAttributeList(attr_list, 1, 0, &mut attr_size) == 0 {
            CloseHandle(pty_in_write);
            CloseHandle(pty_out_read);
            return Err(std::io::Error::last_os_error().to_string());
        }

        if UpdateProcThreadAttribute(
            attr_list,
            0,
            PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
            hpc as *const c_void,
            size_of::<HPCON>(),
            null_mut(),
            null(),
        ) == 0
        {
            DeleteProcThreadAttributeList(attr_list);
            CloseHandle(pty_in_write);
            CloseHandle(pty_out_read);
            return Err(std::io::Error::last_os_error().to_string());
        }

        let mut startup_info: STARTUPINFOEXW = zeroed();
        startup_info.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup_info.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup_info.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
        startup_info.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
        startup_info.StartupInfo.hStdError = INVALID_HANDLE_VALUE;
        startup_info.lpAttributeList = attr_list;

        let mut cmd_wide = to_wide_null(command_line);
        let cwd_wide = to_wide_null(working_dir);
        let env_block = build_environment_block(env_extra);
        let mut proc_info: PROCESS_INFORMATION = zeroed();

        let created = CreateProcessW(
            null(),
            cmd_wide.as_mut_ptr(),
            null(),
            null(),
            0,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
            env_block.as_ptr() as *const c_void,
            cwd_wide.as_ptr(),
            &startup_info.StartupInfo,
            &mut proc_info,
        );

        DeleteProcThreadAttributeList(attr_list);

        if created == 0 {
            CloseHandle(pty_in_write);
            CloseHandle(pty_out_read);
            return Err(std::io::Error::last_os_error().to_string());
        }

        let child = WinChild {
            handle: proc_info.hProcess,
        };

        let tree = match ProcessTree::from_process_handle(proc_info.hProcess) {
            Ok(tree) => tree,
            Err(error) => {
                child.kill();
                CloseHandle(proc_info.hThread);
                CloseHandle(pty_in_write);
                CloseHandle(pty_out_read);
                return Err(error);
            }
        };

        let resumed = ResumeThread(proc_info.hThread);
        CloseHandle(proc_info.hThread);
        if resumed == u32::MAX {
            let _ = tree.stop();
            CloseHandle(pty_in_write);
            CloseHandle(pty_out_read);
            return Err(std::io::Error::last_os_error().to_string());
        }

        let writer = Box::new(File::from_raw_handle(pty_in_write));
        let reader = Box::new(File::from_raw_handle(pty_out_read));

        Ok(SpawnedWinConPty {
            child,
            pty,
            writer,
            reader,
            tree,
        })
    }
}
