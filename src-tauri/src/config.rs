use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct ConfigFile {
    path: PathBuf,
    // A failed load must never turn an existing configuration into an empty one.
    writable: Arc<Mutex<bool>>,
}

fn read_valid(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if !value.is_object() {
        return Err("配置必须是 JSON 对象。".into());
    }
    Ok(value)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("配置目录无效")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.error.to_string())?;
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|dir| dir.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn migrate(source: &Path, target: &Path) -> Result<(), String> {
    let value = read_valid(source)?;
    atomic_write(
        target,
        &serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
}

impl ConfigFile {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            writable: Arc::new(Mutex::new(false)),
        }
    }

    pub fn load(&self) -> Result<Option<Value>, String> {
        let mut writable = self.writable.lock().map_err(|e| e.to_string())?;
        *writable = false;
        let value = match read_valid(&self.path) {
            Ok(value) => Some(value),
            Err(_) if !self.path.try_exists().map_err(|e| e.to_string())? => None,
            Err(error) => {
                return Err(format!(
                    "读取配置失败，原文件已保留：{}。备份：{}",
                    error,
                    self.path.with_extension("json.bak").display()
                ))
            }
        };
        *writable = true;
        Ok(value)
    }

    pub fn save(&self, value: Value) -> Result<String, String> {
        let writable = self.writable.lock().map_err(|e| e.to_string())?;
        if !*writable {
            return Err("配置尚未成功读取，已阻止覆盖。请修复原文件后重试读取。".into());
        }
        if !value.is_object() {
            return Err("配置必须是 JSON 对象。".into());
        }
        // Validate again: another instance or editor may have changed the file.
        if self.path.try_exists().map_err(|e| e.to_string())? {
            let previous = read_valid(&self.path)?;
            atomic_write(
                &self.path.with_extension("json.bak"),
                &serde_json::to_vec_pretty(&previous).map_err(|e| e.to_string())?,
            )?;
        }
        atomic_write(
            &self.path,
            &serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
        )?;
        Ok(self.path.to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn malformed_config_is_preserved_and_can_be_retried() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, "broken").unwrap();
        let config = ConfigFile::new(path.clone());
        assert!(config.load().is_err());
        assert!(config.save(json!({"projects": []})).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "broken");
        fs::write(&path, "{}").unwrap();
        config.load().unwrap();
        config.save(json!({"projects": []})).unwrap();
    }

    #[test]
    fn backup_is_previous_valid_snapshot_and_external_corruption_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let config = ConfigFile::new(path.clone());
        assert!(config.save(json!({})).is_err());
        assert!(config.load().unwrap().is_none());
        config.save(json!({"version": 1})).unwrap();
        config.save(json!({"version": 2})).unwrap();
        assert_eq!(
            read_valid(&path.with_extension("json.bak")).unwrap(),
            json!({"version": 1})
        );
        fs::write(&path, "").unwrap();
        assert!(config.save(json!({"version": 3})).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "");
    }
}
