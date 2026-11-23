# 应用内自动更新接入指引 (`tauri-plugin-updater`)

FlashRun 当前已通过 GitHub Actions ([.github/workflows/release.yml](../.github/workflows/release.yml)) 自动构建 Windows 与 macOS 安装包并在 GitHub Releases 发布。

由于 Tauri v2 的 `tauri-plugin-updater` 要求对更新产物进行强制离线公私钥签名校验，因此在你准备好签名私钥后，按以下 4 步即可启用应用内自动检查与静默更新：

## 1. 生成签名密钥对

```bash
pnpm tauri signer generate -w ~/.tauri/flashrun.key
```

妥善保管私钥文件，并将生成的 **公钥字符串** 记下。

## 2. 配置 GitHub Actions Secrets

在仓库 `Settings → Secrets and variables → Actions` 中新增：
- `TAURI_SIGNING_PRIVATE_KEY`：私钥文件内容
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥密码（如设置了密码）

并在 [.github/workflows/release.yml](../.github/workflows/release.yml) 的 `Build Tauri app` 步骤 `env` 中补充：

```yaml
TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

## 3. 安装插件与配置 `tauri.conf.json`

```bash
pnpm add @tauri-apps/plugin-updater
cargo add tauri-plugin-updater --manifest-path src-tauri/Cargo.toml
```

在 `src-tauri/tauri.conf.json` 中启用 `bundle.createUpdaterArtifacts: true` 与 `plugins.updater`：

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "<YOUR_PUBLIC_KEY>",
      "endpoints": [
        "https://github.com/Jveen-D/flashrun/releases/latest/download/latest.json"
      ]
    }
  }
}
```

并在 `src-tauri/src/lib.rs` 注册 `.plugin(tauri_plugin_updater::Builder::new().build())`，在 `src-tauri/capabilities/default.json` 中加入 `"updater:default"`。

## 4. 在设置页接通 `check()`

在 `SettingsModal` 的“数据与更新”卡片中，将按钮从打开 GitHub Releases 切换为调用 `@tauri-apps/plugin-updater` 的 `check()` + `downloadAndInstall()` 即可完成闭环。
