# ⚡ FlashRun 

**English** | [简体中文](./README.zh-CN.md)

<div align="center">
  <img src="./app-icon.jpg" width="128" style="border-radius: 20%" alt="FlashRun Logo" />
  
  <p><strong>A multi-project terminal and launcher panel designed with cyberpunk geek aesthetics for modern frontend developers.</strong></p>

  [![Tauri](https://img.shields.io/badge/Tauri-FFC131?style=for-the-badge&logo=tauri&logoColor=black)](https://tauri.app/)
  [![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
  [![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
  [![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
  <br />
</div>
<div align="center">
  <br/>
  <h2>🚀 Experience FlashRun Now</h2>
  <a href="https://github.com/Jveen-D/flashrun/releases/latest">
    <img src="https://img.shields.io/github/v/release/Jveen-D/flashrun?style=for-the-badge&label=Download%20Latest%20Release&color=00e52b&logo=github&logoColor=white" alt="Download Latest Release" />
  </a>
  <p><b>✨ Natively supported: 🍏 macOS (Apple Silicon / Intel) &nbsp;|&nbsp; 🪟 Windows 10/11 ✨</b></p>
  <br/>
</div>

## 📦 Installation & Download (No Compilation Required)

If you don't want to mess with code, simply click the button above or head to the [**Releases Page**](https://github.com/Jveen-D/flashrun/releases/latest) in this repository to download the pre-built native installation packages.
Thanks to GitHub Actions automated cloud builds, we provide the following platforms for free:
- 🍎 **macOS**: Supports Intel and Apple Silicon M-series chips (`.dmg` image files)
- 🏁 **Windows**: Supports standard system installers and portable executables (`.msi` / `.exe`)

> ⚠️ **macOS Installation Notice (Must Read)**:
> Since this app is a free and hardcore open-source build, we haven't paid the high Apple Developer annual fee to digitally sign (Notarize) the application. When you open the downloaded `.app` on your Mac for the first time, Apple's Gatekeeper might falsely report: **`"FlashRun.app" is damaged and can't be opened. You should move it to the Trash.`**
> 
> **Ultimate Solution**: Open your Mac's `Terminal`, and simply type the following command to forcibly remove the quarantine flag (assuming you have dragged the App into the `Applications` folder):
> ```bash
> sudo xattr -rd com.apple.quarantine /Applications/FlashRun.app
> ```

---

## 📖 What is FlashRun?

If you maintain 3~5 frontend projects daily, are tired of constantly using `cd` to switch directories, annoyed by typing `pnpm dev` upon every boot, and loathe having mountains of terminal windows cluttered on your screen... then **FlashRun** is your ultimate cure.

**FlashRun** is a purely native desktop console panel (built on Tauri). It automatically reads your provided project paths, sniffs out command scripts in `package.json`, and transforms boring CLIs into slick, intuitive operation tiles. You can smoothly start/stop any service with a single click and immerse yourself in real-time build logs via the built-in high-performance terminal engine (Xterm.js).

## ✨ Core Features 

- 🚀 **1-Click Start/Terminate**: Automatically parses `[npm/pnpm/yarn/bun] run xxx` scripts, enabling you to run and stop child processes directly via graphical tiles.
- 🔮 **Independent Log Stream Terminal**: Comes with an immersive colorful terminal (`Xterm.js`) to display standard backend stdout/stderr streams. Supports `Ctrl+Click` on URL links inside the terminal to instantly launch your browser!
- 🗂 **Lightning-fast Sidebar Manager**: A 260px widened management panel clearly lists and aligns all your workspace projects and their package manager properties.
- 🎮 **Esports-grade Smooth Animations**: Adopts a highly pure dark (dark purple/metal) aesthetic UI. All dropdowns, tiles, and side panels feature complex physics-engine-level easing animations (`Headless UI`).
- 💻 **Fully Intelligent Integration**: It acts not only as a launcher but also as an explorer. Open your project code in `VS Code / Cursor / Default Editor` or even the OS default file explorer with a single tap.
- 📦 **Zero Memory Burden**: Thanks to the magic of Rust + Tauri architecture, even for such a complex GUI tool, the background memory and storage footprint it occupies is practically negligible.

## 📸 Interface Preview
![Main Interface Overview](./docs/screenshot.png)

## 🛠️ Want to Contribute?

If you want to build a custom UI or add private features on top of this framework, simply follow these steps to run it locally:

### Prerequisites:
1. [Node.js](https://nodejs.org/) (Currently tested on Node 20+)
2. [Rust](https://www.rust-lang.org/tools/install) Native toolchain
3. (Depending on OS, [Tauri System Dependencies](https://tauri.app/v1/guides/getting-started/prerequisites) may be required)

### Clone & Start:
```bash
# 1. Clone the repository
git clone https://github.com/Jveen-D/flashrun.git

# 2. Go to directory and install frontend dependencies
cd flashrun
pnpm install

# 3. Spin up local dev server (Rust compiler will take over to launch independent app window)
pnpm tauri dev
```

### Build Locally:
```bash
# Generate localized .exe (Windows) or .dmg (Mac)
pnpm tauri build
```

## 💖 License & Acknowledgements

This repository is released under the **MIT License**. It is fully open-source, and all derivatives or PRs are warmly welcomed.
A special thanks to the `Tauri` engine and `Lucide` icon set for making native system development this elegant.
