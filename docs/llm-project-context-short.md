# FlashRun LLM 超短上下文

> 用途：给后续大模型快速建立可操作的项目认知。文档导航见 `docs/INDEX.md`，更完整版本见 `docs/llm-project-context.md`，函数定位见 `docs/llm-function-index.md`，变更维护规则见 `docs/llm-change-guide.md`，收尾检查见 `docs/llm-doc-sync-checklist.md`。




## 1. 一句话

`FlashRun` 是一个基于 `Tauri + React + TypeScript` 的桌面应用，用来集中管理多个本地前端/Node 项目，将 `package.json scripts` 变成可点击的命令卡片，并配有多标签页内嵌终端。

## 2. 运行模型

```text
React UI
  -> Zustand store
  -> Tauri invoke
  -> Rust 后端执行系统能力/进程管理
  -> Tauri event 回推输出
  -> xterm.js 显示终端内容
```

核心不是纯 Web，而是“前端界面 + Rust 原生执行层”的桌面应用。

## 3. 技术栈

- 前端：`React 19`、`TypeScript`、`Vite 7`、`Tailwind CSS`
- 状态：`Zustand`
- 国际化：`i18next + react-i18next`
- 终端：`xterm.js`
- 原生层：`Tauri 2 + Rust`

## 4. 项目核心能力

- 接入多个本地项目目录
- 自动解析 `package.json` 的 `scripts`
- 自动识别包管理器：`npm / pnpm / yarn / bun`
- 一键运行 / 停止 / 重启命令
- 内嵌多标签页终端
- 一键在编辑器中打开项目
- 一键在系统资源管理器中打开目录
- 持久化保存项目、设置和终端 UI 状态

## 5. 最关键的数据结构

定义位置：`src/store.ts`

- `Project`
  - `id`
  - `name`
  - `path`
  - `manager`
  - `commands`
- `Command`
  - `id`
  - `label`
  - `cmd`
  - `status: 'idle' | 'running'`
  - `pid`
- `GlobalSettings`
  - `defaultEditor`
  - `theme`
  - `language`
- `ProjectTerminalState`
  - `tabs`
  - `activeTabId`

## 6. 最重要的文件

### 前端
- `src/App.tsx`
  - 应用总布局、设置弹窗、终端面板显示控制
- `src/store.ts`
  - 全局状态中心、持久化桥接、终端 tab 状态管理
- `src/components/Sidebar.tsx`
  - 添加项目、切换项目
- `src/components/ActionGrid.tsx`
  - 运行/停止/重启命令
- `src/components/TopBar.tsx`
  - 打开编辑器、切换包管理器、切换终端
- `src/components/TerminalPanel.tsx`
  - 多终端 tab UI
- `src/TerminalWindow.tsx`
  - xterm 与 Rust shell session 的桥接

### Rust / Tauri
- `src-tauri/src/lib.rs`
  - 所有核心后端逻辑都在这里：项目解析、子进程、shell、配置读写
- `src-tauri/tauri.conf.json`
  - Tauri 应用配置

## 7. 三条关键链路

### 7.1 添加项目
1. `Sidebar` 选择目录
2. 前端调用 `parse_project_info`
3. Rust 读取 `package.json` + lockfile
4. 前端把 `scripts` 转成命令卡片
5. `store` 持久化

### 7.2 运行脚本
1. `ActionGrid` 点击运行
2. 前端调用 `run_command`
3. Rust 在项目目录中启动子进程
4. Rust 通过 `terminal-out` 推送输出
5. 前端终端显示日志

### 7.3 使用内嵌终端
1. `TerminalPanel` 打开 tab
2. `TerminalWindow` 调 `create_shell_session`
3. Rust 创建真实 shell
4. 输出通过 `shell-out-{sessionId}` 回推
5. 输入通过 `send_input` 回传给 Rust

## 8. 前后端桥接命令

Rust 暴露给前端的主要命令：

- `parse_project_info`
- `load_app_config`
- `save_app_config`
- `run_command`
- `send_input`
- `create_shell_session`
- `kill_command`
- `open_in_editor`（支持 `VS Code`、`Cursor`、`Zed`、`CodeBuddy`、`Antigravity`；Windows 下会依次尝试编辑器自己的 CLI、`.cmd/.exe` 名称与默认安装路径，不会跨编辑器回退）





## 9. 关键事件通道

- `terminal-out`
  - 普通脚本输出
- `shell-out-{sessionId}`
  - 某个终端 tab 对应 shell 的输出

理解日志归属时要特别注意这两个通道不同。

## 10. 持久化方式

不是 `localStorage`。

前端通过 Tauri `invoke` 让 Rust 读写本地配置文件：

- 文件名：`flashrun-config.json`
- Windows 下优先在用户目录，如 `%USERPROFILE%/flashrun-config.json`

会持久化：
- 项目列表
- 当前激活项目
- 全局设置
- UI 偏好（终端开关、高度、侧边栏、每个项目的终端 tab）

不会持久化：
- 命令运行中状态；恢复后统一回到 `idle`

## 11. 如果后续要改功能，先看哪里

- 改项目接入：`src/components/Sidebar.tsx` + `src-tauri/src/lib.rs::parse_project_info`
- 改命令执行：`src/components/ActionGrid.tsx` + `run_command` / `kill_command`
- 改终端：`src/components/TerminalPanel.tsx` + `src/TerminalWindow.tsx` + `create_shell_session` / `send_input`
- 改设置保存：`src/store.ts` + `load_app_config` / `save_app_config`
- 改编辑器打开：`src/components/TopBar.tsx` + `open_in_editor`

## 12. 当前阅读优先级

只看 4 个文件就能建立主认知：

1. `package.json`
2. `src/App.tsx`
3. `src/store.ts`
4. `src-tauri/src/lib.rs`

再补：

5. `src/components/Sidebar.tsx`
6. `src/components/ActionGrid.tsx`
7. `src/components/TopBar.tsx`
8. `src/components/TerminalPanel.tsx`
9. `src/TerminalWindow.tsx`

## 13. 大模型最容易踩坑的点

- 这是桌面应用，很多关键逻辑在 Rust，不在 React。
- 终端输出分两类：脚本输出和 shell 输出，不要混淆。
- 前端 `status/pid` 只是 UI 层运行态，不等于完整进程生命周期管理。
- 配置存本地文件，不在浏览器存储。
- `src/store.ts` 是前端改动的第一入口。

## 14. 一句最终结论

> `FlashRun` 的本质是：用 Tauri 把“多个 Node/前端项目的脚本运行、日志查看、终端交互、编辑器打开”统一收拢到一个桌面 GUI 中。