# FlashRun 函数级索引

> 用途：给后续大模型快速定位“该改哪个函数、该读哪个入口”。文档导航见 `docs/INDEX.md`，完整背景见 `docs/llm-project-context.md`，速读版见 `docs/llm-project-context-short.md`，变更维护规则见 `docs/llm-change-guide.md`，收尾检查见 `docs/llm-doc-sync-checklist.md`。




## 1. 阅读优先级最高的函数

如果时间很少，优先看这几个：

| 函数 | 文件 | 行号 | 作用 |
|---|---|---:|---|
| `App` | `src/App.tsx` | 12 | 应用总布局与顶层交互 |
| `useStore` | `src/store.ts` | 280 | 前端状态总入口 |
| `hydrate` | `src/store.ts` | 290 | 从本地配置恢复状态 |
| `handleAddProject` | `src/components/Sidebar.tsx` | 17 | 接入项目入口 |
| `handleRun` | `src/components/ActionGrid.tsx` | 14 | 运行命令入口 |
| `TerminalWindow` | `src/TerminalWindow.tsx` | 19 | xterm 与后端 shell 桥接 |
| `parse_project_info` | `src-tauri/src/lib.rs` | 94 | 解析项目与 scripts |
| `run_command` | `src-tauri/src/lib.rs` | 167 | 启动脚本子进程 |
| `create_shell_session` | `src-tauri/src/lib.rs` | 250 | 创建终端 shell |
| `run` | `src-tauri/src/lib.rs` | 496 | 注册所有 Tauri 命令 |





---

## 2. 前端入口层

| 函数 / 组件 | 文件 | 行号 | 作用 | 何时阅读 |
|---|---|---:|---|---|
| `App` | `src/App.tsx` | 12 | 总布局；组合 `Sidebar`、`TopBar`、`ActionGrid`、`TerminalPanel`；控制设置弹窗、主题、终端高度 | 想快速理解 UI 结构时 |
| `main.tsx` 默认入口 | `src/main.tsx` | 1 | React 挂载入口，加载 `App` 与 i18n | 确认前端启动方式时 |
| `i18n` 初始化 | `src/i18n.ts` | 92 | 初始化中英文文案资源 | 改语言或新增文案时 |

---

## 3. `src/store.ts`：数据模型与持久化辅助函数

### 3.1 基础辅助函数

| 函数 | 行号 | 作用 | 备注 |
|---|---:|---|---|
| `createDefaultTerminalTab` | 65 | 创建默认终端 tab | 新项目/新 tab 初始值 |
| `createDefaultProjectTerminalState` | 72 | 创建某项目默认终端状态 | 包含 `tabs + activeTabId` |
| `serializeProjects` | 80 | 将持久化项目转为运行期项目 | 会把命令状态重置为 `idle` |
| `sanitizeActiveProjectId` | 91 | 确保激活项目 id 合法 | 防止指向不存在项目 |
| `clampTerminalHeight` | 103 | 限制终端高度范围 | 避免过高/过低 |
| `sanitizeProjectTerminalState` | 111 | 修正单个项目的终端状态 | 防止空 tab / 非法 tab |
| `sanitizeProjectTerminals` | 135 | 修正所有项目的终端状态 | 以项目列表为准 |
| `sanitizeUiPreferences` | 145 | 修正 UI 偏好结构 | 统一恢复默认值 |
| `sanitizePersistedState` | 154 | 修正完整持久化状态 | 启动恢复时很关键 |
| `buildUiPreferencesSnapshot` | 165 | 生成 UI 快照 | 用于持久化前整理状态 |
| `getNextTerminalTitle` | 174 | 生成下一个终端标题 | 如 `Terminal 2` |
| `loadPersistedState` | 185 | 调 `load_app_config` 读配置 | 前端恢复入口 |
| `enqueuePersist` | 191 | 持久化写队列 | 避免高频并发写入 |
| `persistProjects` | 217 | 持久化项目列表 | 内部调用 `enqueuePersist` |
| `persistSettings` | 224 | 持久化全局设置 | 同上 |
| `persistActiveProject` | 231 | 持久化当前激活项目 | 同上 |
| `persistUiPreferences` | 238 | 持久化 UI 偏好 | 同上 |
| `flushPersistence` | 245 | 等待写队列完成 | 调试/测试时可能有用 |

### 3.2 `useStore` 内的核心 action

| Action | 行号 | 作用 | 常见改动场景 |
|---|---:|---|---|
| `hydrate` | 290 | 启动时恢复状态 | 应用启动/配置兼容 |
| `addProject` | 319 | 添加项目并初始化命令与终端状态 | 改项目接入逻辑 |
| `updateProjectManager` | 353 | 更新包管理器并批量替换命令前缀 | 切换 `npm/pnpm/yarn/bun` |
| `setActiveProject` | 374 | 切换当前项目 | 项目导航 |
| `removeProject` | 379 | 删除项目并清理终端状态 | 项目删除/清理 |
| `addCommand` | 405 | 添加自定义命令 | 扩展命令能力 |
| `updateCommand` | 416 | 更新命令配置或运行状态 | 编辑命令、更新 pid/status |
| `removeCommand` | 430 | 删除命令 | 命令管理 |
| `updateGlobalSettings` | 441 | 更新主题/语言/默认编辑器 | 设置面板 |
| `setTerminalOpen` | 447 | 显式开关终端 | 顶栏/卡片区触发 |
| `toggleTerminal` | 458 | 切换终端开关 | 顶栏按钮 |
| `setTerminalHeight` | 470 | 更新终端高度 | 拖拽终端高度 |
| `setSidebarExpanded` | 482 | 更新侧边栏展开状态 | 侧边栏折叠 |
| `addTerminalTab` | 493 | 新增项目终端 tab | 多终端能力 |
| `closeTerminalTab` | 521 | 关闭终端 tab | tab 管理 |
| `setActiveTerminalTab` | 554 | 切换终端 tab | tab 切换 |

结论：如果不确定改动应该从哪开始，前端通常先看 `useStore`。

---

## 4. 组件层函数索引

### 4.1 `src/components/Sidebar.tsx`

| 函数 | 行号 | 作用 | 依赖 |
|---|---:|---|---|
| `handleAddProject` | 17 | 选择目录并调用后端解析项目 | `open`、`parse_project_info`、`addProject` |
| `Sidebar` | 13 | 项目列表 UI、项目切换、侧边栏折叠 | `useStore`、`i18n` |

### 4.2 `src/components/TopBar.tsx`

| 函数 | 行号 | 作用 | 依赖 |
|---|---:|---|---|
| `handleOpenEditor` | 20 | 调 `open_in_editor` 打开当前项目 | `invoke`、`globalSettings.defaultEditor` |
| `TopBar` | 14 | 顶栏 UI；项目名、路径、包管理器切换、终端开关 | `useStore`、`revealItemInDir` |

### 4.3 `src/components/ActionGrid.tsx`

| 函数 | 行号 | 作用 | 依赖 |
|---|---:|---|---|
| `handleRun` | 14 | 启动命令并记录 pid/status | `run_command`、`updateCommand` |
| `handleStop` | 31 | 停止命令并重置状态 | `kill_command`、`updateCommand` |
| `handleRestart` | 43 | 先杀进程再延迟重启 | `kill_command`、`run_command` |
| `handleAddCustom` | 71 | 用 `prompt` 新增自定义命令 | `addCommand` |
| `handleEdit` | 80 | 编辑命令名与 CLI | `updateCommand` |
| `ActionGrid` | 7 | 命令卡片列表 UI | `useStore`、`invoke` |

### 4.4 `src/components/TerminalPanel.tsx`

| 函数 | 行号 | 作用 | 依赖 |
|---|---:|---|---|
| `addTab` | 18 | 新建终端 tab | `addTerminalTab` |
| `handleCloseTab` | 25 | 关闭终端 tab；仅剩一个时收起面板 | `closeTerminalTab`、`onClose` |
| `TerminalPanel` | 12 | 终端 tab 容器与活动 tab 切换 | `useStore`、`TerminalWindow` |

### 4.5 `src/TerminalWindow.tsx`

| 函数 / 逻辑块 | 行号 | 作用 | 备注 |
|---|---:|---|---|
| `TerminalWindow` | 19 | 初始化 xterm、监听输出、转发输入 | 前端终端桥接核心 |
| `useEffect` 主流程 | 33 | 创建终端实例、创建 shell session、绑定事件、清理资源 | 几乎所有终端行为都在这里 |
| `term.onData` 输入处理 | 96 | 处理回车、退格、`Ctrl+C`、`Ctrl+L`、普通输入 | 输入通过 `send_input` 回传给 Rust |

说明：`TerminalWindow` 虽然没有拆很多具名函数，但它是整个终端能力最关键的前端文件。

---

## 5. Rust / Tauri 函数索引（`src-tauri/src/lib.rs`）

### 5.1 配置与基础设施

| 函数 | 行号 | 作用 | 备注 |
|---|---:|---|---|
| `config_file_path` | 16 | 计算配置文件路径 | Windows 优先 `%USERPROFILE%` |
| `legacy_config_file_path` | 27 | 旧配置路径定位 | 仅旧版本迁移使用 |
| `migrate_legacy_config_if_needed` | 41 | 迁移旧配置到新路径 | 兼容历史数据 |
| `ProcessManager::new` | 74 | 初始化进程 stdin 管理器 | 用于交互输入 |

### 5.2 Tauri 命令

| 函数 | 行号 | 作用 | 前端调用方 |
|---|---:|---|---|
| `parse_project_info` | 94 | 校验目录、识别包管理器、读取 `scripts` | `Sidebar.tsx` |
| `load_app_config` | 127 | 读取配置文件 | `store.ts` |
| `save_app_config` | 149 | 写入配置文件 | `store.ts` |
| `run_command` | 167 | 启动脚本进程并发出 `terminal-out` | `ActionGrid.tsx` |
| `send_input` | 232 | 向指定进程写入 `stdin` | `TerminalWindow.tsx` |
| `create_shell_session` | 250 | 创建 shell 并发出 `shell-out-{sessionId}` | `TerminalWindow.tsx` |
| `kill_command` | 327 | 杀死指定 pid | `ActionGrid.tsx`、`TerminalWindow.tsx` |
| `open_in_editor` | 432 | 打开外部编辑器 | `TopBar.tsx` |
| `run` | 496 | 注册插件与所有命令 | Tauri 启动入口 |





### 5.3 需要特别理解的后端细节

| 主题 | 位置 | 说明 |
|---|---|---|
| 包管理器识别 | `parse_project_info` | 通过 lockfile 判断，默认 `npm` |
| 脚本输出事件 | `run_command` | 统一发到 `terminal-out` |
| shell 输出事件 | `create_shell_session` | 发到 `shell-out-{sessionId}` |
| 输入回传 | `send_input` | 基于 `stdinmap` 按 pid 写入 |
| 进程终止 | `kill_command` | Windows 用 `taskkill /F /T /PID` |
| 编辑器打开 | `open_in_editor` | 支持 `VS Code`、`Cursor`、`Zed`、`CodeBuddy`、`Antigravity`；Windows 下会按候选列表依次尝试编辑器自己的 CLI、`.cmd/.exe` 名称与默认安装路径；失败时返回尝试明细 |





---

## 6. 事件与命令对照表

| 类型 | 名称 | 来源 | 去向 | 用途 |
|---|---|---|---|---|
| Tauri invoke | `parse_project_info` | 前端 | Rust | 解析项目 scripts |
| Tauri invoke | `load_app_config` | 前端 | Rust | 读取配置 |
| Tauri invoke | `save_app_config` | 前端 | Rust | 写入配置 |
| Tauri invoke | `run_command` | 前端 | Rust | 启动脚本 |
| Tauri invoke | `send_input` | 前端 | Rust | 终端输入 |
| Tauri invoke | `create_shell_session` | 前端 | Rust | 创建 shell |
| Tauri invoke | `kill_command` | 前端 | Rust | 停止进程 |
| Tauri invoke | `open_in_editor` | 前端 | Rust | 打开编辑器 |
| Tauri event | `terminal-out` | Rust | 前端 | 脚本输出 |
| Tauri event | `shell-out-{sessionId}` | Rust | 前端 | shell 输出 |

---

## 7. 常见修改需求 -> 应该看哪些函数

| 需求 | 优先看 |
|---|---|
| 改项目接入逻辑 | `handleAddProject` -> `parse_project_info` -> `addProject` |
| 改包管理器切换逻辑 | `TopBar` -> `updateProjectManager` |
| 改命令运行/停止/重启 | `handleRun` / `handleStop` / `handleRestart` -> `run_command` / `kill_command` |
| 改自定义命令 | `handleAddCustom` / `handleEdit` -> `addCommand` / `updateCommand` |
| 改终端 tab 行为 | `addTerminalTab` / `closeTerminalTab` / `setActiveTerminalTab` -> `TerminalPanel` |
| 改 shell 输入输出 | `TerminalWindow` -> `send_input` -> `create_shell_session` |
| 改持久化结构 | `sanitizePersistedState` / `persist*` -> `load_app_config` / `save_app_config` |
| 改默认编辑器支持 | `TopBar` / `App` 设置项 -> `open_in_editor` |

---

## 8. 给后续大模型的最短建议

- UI 结构看 `App.tsx`
- 前端状态看 `store.ts`
- 命令执行看 `ActionGrid.tsx + run_command`
- 终端能力看 `TerminalWindow.tsx + create_shell_session + send_input`
- 配置持久化看 `store.ts + load_app_config + save_app_config`
- 若不确定入口，优先从 `useStore` 和 Rust `run` 开始顺藤摸瓜