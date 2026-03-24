# ⚡ FlashRun 

<div align="center">
  <img src="./src-tauri/icons/128x128.png" width="128" alt="FlashRun Logo" />
  
  <p><strong>一款为现代前端开发者设计的、极具赛博极客美学的多项目终端/启动器面板。</strong></p>

  [![Tauri](https://img.shields.io/badge/Tauri-FFC131?style=for-the-badge&logo=tauri&logoColor=black)](https://tauri.app/)
  [![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
  [![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
  [![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
  <br />
</div>

<div align="center">
  <a href="https://github.com/Jveen-D/flashrun/releases/latest">
    <img src="https://img.shields.io/github/v/release/Jveen-D/flashrun?style=for-the-badge&label=%E4%B8%8B%E8%BD%BD%E6%9C%80%E6%96%B0%E7%89%88&color=00e52b" alt="点击下载最新正式版" />
  </a>
</div>

## 📖 什么是 FlashRun？

如果你每天需要同时维护 3~5 个前端项目，受够了频繁地 `cd` 切目录、每次开机就要重敲 `pnpm dev` 并且终端窗口堆积如山……那么 **FlashRun** 就是你的终极解药。

**FlashRun** 是一个纯原生的桌面级控制台面板（基于 Tauri 构建）。它会自动读取你提供的项目路径，嗅探 `package.json` 中的命令脚本，并将枯燥的 CLI 转化为极简炫酷的操作磁贴。你可以一键丝滑启停任何服务对象，并借助内置的高性能终端引擎（Xterm.js）实时沉浸地追踪所有构建日志。

## ✨ 核心特性 

- 🚀 **一键启动/终结**：自动解析 `[npm/pnpm/yarn/bun] run xxx` 流程，通过图形化磁贴直接运行与停止子进程。
- 🔮 **独立日志流终端**：自带沉浸式彩色终端 (`Xterm.js`) 展示后端标准流输出，更支持 `Ctrl+左键` 点击终端内的 URL 链接直接拉起浏览器！
- 🗂 **多开极速侧边栏**：左侧 260px 加宽管理面板，清晰收录并排列你所有的工作区项目与包管理器属性。
- 🎮 **丝滑电竞级动效**：高度纯净剔透的深色（暗紫金属） UI 审美，所有下拉框、磁贴与侧面板都实现了完全的物理引擎级缓动动画 (`Headless UI`)。
- 💻 **全智能联动**：不仅是启动器，也能当资源管理器用。一键在 `VS Code / Cursor / 等默认编辑器` 甚至操作系统的默认文件夹中拉起当前项目代码。
- 📦 **零内存负担**：得益于 Rust + Tauri 的架构魔法，即使这是一款如此复杂的 GUI 工具，它在系统后台所占据的体积和内存也几乎可以忽略不计。

## 📸 界面预览
![主界面全貌](./docs/screenshot.png)

## 📦 安装与下载 (免编译)

最简单的方式，点击顶部的 Download Badge 或者前往本仓库的 [**Releases 最新发行版页面**](https://github.com/Jveen-D/flashrun/releases/latest) 直接下载安装包。
得益于 GitHub Actions 云端构建，我们同时免费为您提供了：
- 🍎 **macOS**: 支持 Intel 和 Apple Silicon M系列处理器 (`.dmg`)
- 🏁 **Windows**: 支持标准安装与便携版 (`.msi` / `.exe`)

---

## 🛠️ 想要参与开发？

如果你想在此基础上修改一套专属界面或新增私有功能，只需按如下步骤在本地跑起来：

### 环境前置要求：
1. [Node.js](https://nodejs.org/) (当前测试通过 Node 20+)
2. [Rust](https://www.rust-lang.org/tools/install) 原生编译工具链
3. （部分操作系统需补充安装 [Tauri 指定库](https://tauri.app/zh-cn/v1/guides/getting-started/prerequisites)）

### 克隆并启动：
```bash
# 1. 克隆代码
git clone https://github.com/Jveen-D/flashrun.git

# 2. 进入目录并安装前端依赖
cd flashrun
pnpm install

# 3. 唤醒本地开发服务器 (Rust 编译器将会接管构建并自动打开独立 APP 窗口)
pnpm tauri dev
```

### 本地打包产物：
```bash
# 生成本地专属的 .exe (Windows) 或 .dmg (Mac)
pnpm tauri build
```

## 💖 许可协议与鸣谢

本仓库发布遵循 **MIT 协议**。完全开源，欢迎各类代码合并/衍生。
感谢 `Tauri` 引擎和 `Lucide` 图标集使得开发这套原生系统得以如此优雅。
