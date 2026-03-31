# FlashRun 项目理解指南（供后续大模型快速上手）

> 相关文档：
> - 文档导航：`docs/INDEX.md`
> - 完整版：`docs/llm-project-context.md`
> - 速读版：`docs/llm-project-context-short.md`
> - 函数索引：`docs/llm-function-index.md`
> - 变更同步手册：`docs/llm-change-guide.md`
> - 文档同步检查模板：`docs/llm-doc-sync-checklist.md`






## 1. 项目一句话概述

`FlashRun` 是一个基于 `Tauri + React + TypeScript` 的桌面应用，用来集中管理多个本地前端/Node 项目：

- 选择项目目录
- 自动解析 `package.json` 中的 `scripts`
- 以图形化卡片方式运行、停止、重启命令
- 在应用内查看输出日志
- 为每个项目提供多标签页内嵌终端
- 一键用编辑器或系统文件管理器打开项目目录

它本质上是一个“多项目脚本启动器 + 内嵌终端面板”。

---

## 2. 技术栈

### 前端
- `React 19`
- `TypeScript`
- `Vite 7`
- `Tailwind CSS 3`
- `Zustand`：状态管理
- `i18next + react-i18next`：中英文切换
- `xterm.js`：内嵌终端渲染
- `lucide-react`：图标

### 原生层
- `Tauri 2`
- `Rust 2021`
- Tauri 插件：
  - `dialog`
  - `opener`
  - `shell`
  - `fs`
  - `store`

---

## 3. 运行方式

### 开发
```bash
pnpm install
pnpm tauri dev
```

### 仅前端开发
```bash
pnpm dev
```

### 打包
```bash
pnpm tauri build
```

### 关键说明
- 前端 dev server 端口固定为 `1420`
- Tauri 开发时会先执行 `pnpm dev`
- 前置依赖通常需要：`Node.js 20+`、`Rust` 工具链

---

## 4. 目录结构速览

```text
flashrun/
├─ src/                 # React 前端界面
│  ├─ components/       # 主要 UI 组件
│  ├─ App.tsx           # 应用总布局
│  ├─ store.ts          # 全局状态中心（最关键）
│  ├─ TerminalWindow.tsx# xterm 终端窗口
│  ├─ i18n.ts           # 国际化资源
│  └─ main.tsx          # 前端入口
├─ src-tauri/           # Tauri/Rust 原生层
│  ├─ src/lib.rs        # Rust 端核心逻辑（最关键）
│  ├─ src/main.rs       # Rust 入口
│  ├─ tauri.conf.json   # Tauri 配置
│  └─ Cargo.toml        # Rust 依赖
├─ docs/
│  └─ screenshot.png    # 项目截图
├─ package.json         # 前端依赖与脚本
└─ README.zh-CN.md      # 中文说明
```

---

## 5. 建议优先阅读的文件

如果你是后续接手的大模型，建议按这个顺序理解：

1. `package.json`
   - 看技术栈和 npm 脚本
2. `src/App.tsx`
   - 看整体页面布局和顶层交互
3. `src/store.ts`
   - 看应用核心状态模型、持久化机制、终端 tab 管理
4. `src/components/Sidebar.tsx`
   - 看“添加项目”和项目切换逻辑
5. `src/components/ActionGrid.tsx`
   - 看脚本执行/停止/重启逻辑
6. `src/components/TopBar.tsx`
   - 看编辑器打开、包管理器切换等行为
7. `src/components/TerminalPanel.tsx`
   - 看多终端 tab 组织方式
8. `src/TerminalWindow.tsx`
   - 看 xterm 与后端 shell session 的桥接
9. `src-tauri/src/lib.rs`
   - 看 Rust 侧命令解析、进程管理、配置持久化、shell 事件推送

---

## 6. 前端架构

## 6.1 `src/App.tsx`
负责整个应用总布局：

- 左侧 `Sidebar`
- 顶部 `TopBar`
- 中间 `ActionGrid`
- 底部 `TerminalPanel`
- 全局设置弹窗
- 主题切换
- 语言切换
- 终端面板显示/隐藏
- 终端高度拖拽

核心特点：
- 应用启动时调用 `hydrate()` 从本地配置恢复状态
- 如果当前项目存在运行中的命令，则终端区域自动可见

## 6.2 `src/store.ts`
这是整个前端的核心状态中心。

主要管理以下数据：

### 项目数据
- `projects`
- `activeProjectId`

每个项目大致包含：
- 项目名
- 项目路径
- 包管理器
- 命令列表

### 命令数据
每个命令包含：
- `label`
- `cmd`
- `status`：`idle | running`
- `pid`

### 全局设置
- 默认编辑器
- 主题：`dark | light | system`
- 语言：`zh | en`

### UI 状态
- 终端是否展开
- 终端高度
- 侧边栏是否展开
- 每个项目的终端 tab 状态

### 持久化机制
前端通过 Tauri `invoke` 调用 Rust 命令：
- `load_app_config`
- `save_app_config`

状态不会直接写浏览器 `localStorage`，而是走 Tauri/Rust 存到本机配置文件。

另外，`store.ts` 里做了几件重要事情：
- 启动时把持久化状态做 sanitize
- 命令运行态不会持久化，恢复后统一回到 `idle`
- 终端 tab 是按项目维度保存的
- 持久化写入使用了简单队列，避免频繁并发覆盖

---

## 7. 主要 UI 组件职责

## 7.1 `src/components/Sidebar.tsx`
负责：
- 展示项目列表
- 切换当前项目
- 通过系统目录选择器添加项目
- 收起/展开侧边栏
- 打开全局设置

添加项目流程：
1. 通过 Tauri `dialog` 选择目录
2. 调 Rust 端 `parse_project_info`
3. 获取 `manager + scripts`
4. 调 `store.addProject()` 写入状态

## 7.2 `src/components/TopBar.tsx`
负责：
- 展示当前项目名称和路径
- 切换包管理器（`npm / pnpm / yarn / bun`）
- 在系统资源管理器中打开目录
- 调 `open_in_editor` 用外部编辑器打开项目
- 切换终端显示状态

注意：
- 编辑器是通过命令行方式唤起的，依赖对应编辑器命令已在系统 `PATH` 中
- 默认编辑器来自全局设置

## 7.3 `src/components/ActionGrid.tsx`
负责：
- 展示当前项目的命令卡片
- 点击运行命令
- 停止命令
- 重启命令
- 新增自定义命令
- 编辑命令显示名和实际命令

运行逻辑核心：
- 前端先把状态设成 `running`
- 调 Rust `run_command`
- Rust 返回 `pid`
- 前端保存 `pid`
- 停止时调用 `kill_command`

## 7.4 `src/components/TerminalPanel.tsx`
负责：
- 渲染终端容器
- 管理多标签页终端 UI
- 创建 tab / 切换 tab / 关闭 tab
- 每个 tab 对应一个 `TerminalWindow`

终端状态是“按项目分组”的：
- 每个项目有自己的 tab 列表
- 每个项目有自己的当前激活 tab

## 7.5 `src/TerminalWindow.tsx`
这是前端终端能力的核心桥接层。

职责：
- 初始化 `xterm.js`
- 调 Rust `create_shell_session` 创建真实 shell
- 监听后端 shell 输出事件
- 监听全局命令输出事件
- 接管键盘输入并通过 `send_input` 发给后端进程
- 支持 `Ctrl/Cmd + 点击链接` 打开浏览器

重要认识：
- 前端终端只是显示层
- 真正的 shell/子进程在 Rust 后端

---

## 8. Rust / Tauri 架构

核心文件：`src-tauri/src/lib.rs`

它负责把前端 UI 和操作系统能力连接起来。

### 8.1 `parse_project_info`
作用：
- 校验目标目录是否存在 `package.json`
- 自动识别包管理器
- 读取 `scripts`

识别规则大致是：
- 有 `pnpm-lock.yaml` => `pnpm`
- 有 `yarn.lock` => `yarn`
- 有 `package-lock.json` => `npm`
- 否则默认 `npm`

### 8.2 `run_command`
作用：
- 在项目目录中执行命令
- 捕获 `stdout/stderr`
- 通过 Tauri 事件把输出推回前端
- 返回子进程 `pid`

平台差异：
- Windows 下用 `cmd /c`
- 非 Windows 下用 `sh -c`

### 8.3 `create_shell_session`
作用：
- 为每个终端 tab 创建独立 shell 会话
- 每个会话绑定一个 `session_id`
- 输出事件名为 `shell-out-{session_id}`

这就是多标签页终端的后端基础。

### 8.4 `send_input`
作用：
- 将用户输入写入指定进程的 `stdin`
- 用于 shell 交互和部分可交互命令

### 8.5 `kill_command`
作用：
- 按 `pid` 杀死子进程
- Windows 下走 `taskkill /F /T /PID`
- 同时会清理内部 `stdin` 映射

### 8.6 `open_in_editor`
作用：
- 使用命令行方式打开外部编辑器
- 例如 `code path`、`cursor path`

### 8.7 配置读写：`load_app_config` / `save_app_config`
作用：
- 读取和保存应用持久化配置
- 配置文件名：`flashrun-config.json`

当前实现特点：
- Windows 优先存在用户目录下（如 `%USERPROFILE%`）
- 带有旧配置迁移逻辑

---

## 9. 关键数据流

## 9.1 添加项目
1. 用户点击“接入新项目”
2. 前端选择本地目录
3. Rust `parse_project_info` 解析 `package.json`
4. 前端将 `scripts` 转成命令卡片
5. 项目加入 `store.projects`
6. 自动持久化到本地配置

## 9.2 运行脚本
1. 用户点击某个命令卡片的 `Run`
2. 前端调用 `run_command`
3. Rust 在目标目录启动子进程
4. Rust 将日志通过 `terminal-out` 事件推给前端
5. 前端终端区域显示输出

## 9.3 使用内嵌终端
1. 打开某个项目的终端面板
2. 当前 tab 调 `create_shell_session`
3. Rust 创建一个真实 shell
4. 前端监听 `shell-out-{sessionId}`
5. 用户输入通过 `send_input` 回传给后端

## 9.4 修改设置
1. 前端更新 Zustand 状态
2. 调 `save_app_config`
3. Rust 写入本地配置文件
4. 下次启动 `hydrate()` 恢复

---

## 10. 当前已支持的能力

- 多项目管理
- 自动识别 `package.json scripts`
- 自动识别包管理器
- 自定义命令
- 命令运行/停止/重启
- 多标签页终端
- 全局主题切换
- 中英文切换
- 一键打开编辑器
- 一键在系统资源管理器中打开目录
- 本地配置持久化

---

## 11. 阅读代码时需要特别注意的点

### 11.1 这是桌面应用，不是纯 Web App
很多关键能力不在前端，而在 Rust/Tauri：
- 目录选择
- 启动子进程
- 杀进程
- shell session
- 打开外部编辑器
- 本地文件持久化

### 11.2 `store.ts` 是前端的核心入口
如果后续要改：
- 项目模型
- 命令模型
- 终端 tab 状态
- 设置持久化

优先看 `src/store.ts`。

### 11.3 终端有两类输出源
前端终端实际混合了两类输出：
- 脚本运行输出：`terminal-out`
- shell 会话输出：`shell-out-{sessionId}`

理解日志来源时不要混淆。

### 11.4 命令状态和真实进程状态不完全等价
前端依赖 `pid + status` 维护运行态，但没有做特别复杂的进程生命周期同步。
如需增强可靠性，可能要补充：
- 子进程退出事件回传
- 运行态自动归零
- 更细粒度日志归属

### 11.5 配置文件不是浏览器存储
配置由 Rust 写本地文件，所以调试“状态为什么没保存”时，不要去找 `localStorage`。

---

## 12. 后续如果要扩展，优先从这些方向切入

### 前端方向
- 命令分组 / 收藏 / 排序
- 更丰富的项目元信息展示
- 更完善的错误提示与状态提示
- 终端日志过滤、复制、清空、搜索
- 命令输出按项目/按命令隔离显示

### Rust 方向
- 进程退出事件通知前端
- 更稳定的 shell 交互能力
- 更严格的路径/命令校验
- 更细的日志通道隔离
- 更健壮的跨平台行为处理

---

## 13. 如果你是后续接手的大模型，建议的理解策略

### 第一轮：建立结构认知
先看：
- `package.json`
- `src/App.tsx`
- `src/store.ts`
- `src-tauri/src/lib.rs`

### 第二轮：建立交互认知
再看：
- `src/components/Sidebar.tsx`
- `src/components/TopBar.tsx`
- `src/components/ActionGrid.tsx`
- `src/components/TerminalPanel.tsx`
- `src/TerminalWindow.tsx`

### 第三轮：准备改功能
若要改具体功能：
- 改项目接入：看 `Sidebar.tsx + parse_project_info`
- 改命令执行：看 `ActionGrid.tsx + run_command + kill_command`
- 改终端：看 `TerminalPanel.tsx + TerminalWindow.tsx + create_shell_session + send_input`
- 改配置持久化：看 `store.ts + load_app_config + save_app_config`
- 改外部编辑器打开：看 `TopBar.tsx + open_in_editor`

---

## 14. 总结

`FlashRun` 的核心设计非常清晰：

- `React` 负责 UI
- `Zustand` 负责状态
- `Tauri invoke/event` 负责前后端桥接
- `Rust` 负责系统能力、进程管理与配置持久化

如果只记一句话，请记住：

> 这是一个把“多个前端项目的 scripts 执行与终端交互”集中到一个桌面 GUI 中管理的 Tauri 工具。
