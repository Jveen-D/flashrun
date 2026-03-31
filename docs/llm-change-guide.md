# FlashRun 变更同步手册

> 用途：约束后续维护者或大模型在修改代码后，同步维护 LLM 理解文档，避免文档滞后。
>
> 相关文档：
> - 文档导航：`docs/INDEX.md`
> - 完整上下文：`docs/llm-project-context.md`
> - 超短上下文：`docs/llm-project-context-short.md`
> - 函数索引：`docs/llm-function-index.md`
> - 文档同步检查模板：`docs/llm-doc-sync-checklist.md`
> - 本手册：`docs/llm-change-guide.md`


## 1. 核心原则

**凡是会影响项目认知、功能行为、关键函数入口、数据流、配置方式、目录结构的改动，都必须同步更新对应文档。**

不要把这几份文档当成“补充说明”，而要把它们当成项目的一部分：

- 代码变了，文档也要变
- 函数位置变了，索引也要变
- 功能语义变了，项目理解文档也要变
- 架构边界变了，完整版和速读版都要变

---

## 2. 五份文档分别负责什么


### `docs/llm-project-context.md`
完整版项目理解文档。

适合维护的内容：
- 项目定位
- 技术栈
- 目录结构
- 核心架构
- 数据流
- 前后端职责分工
- 关键能力说明

### `docs/llm-project-context-short.md`
给大模型快速建立上下文的短版文档。

适合维护的内容：
- 一句话概述
- 最关键文件
- 三条主链路
- 核心命令/事件
- 最容易踩坑的点

### `docs/llm-function-index.md`
给大模型快速定位入口的函数级索引。

适合维护的内容：
- 核心函数/组件
- 文件路径
- 行号
- 作用描述
- 常见需求对应函数入口

### `docs/llm-change-guide.md`
本手册。

适合维护的内容：
- 哪些变更需要同步哪些文档
- 文档维护规则
- 提交前检查项

---

## 3. 变更类型 -> 必须同步哪些文档

| 变更类型 | 必更文档 | 说明 |
|---|---|---|
| 新增/删除核心功能 | `context`、`short`、必要时 `function-index` | 功能面变化会影响项目理解 |
| 修改核心交互流程 | `context`、`short` | 如项目接入、命令运行、终端交互、设置持久化 |
| 新增/删除关键函数 | `function-index`、必要时 `context` | 尤其是公开入口、主流程函数 |
| 关键函数移动导致行号变化 | `function-index` | 行号必须保持可定位，禁止保留旧行号 |

| 修改 Zustand 状态模型 | `context`、`short`、`function-index` | 如 `Project`、`Command`、`GlobalSettings`、终端状态 |
| 修改 Tauri/Rust 命令 | `context`、`short`、`function-index` | 如 `run_command`、`create_shell_session` |
| 修改事件通道 | `context`、`short`、`function-index` | 如 `terminal-out`、`shell-out-*` |
| 修改配置存储位置/格式 | `context`、`short` | 会影响项目认知与调试方法 |
| 修改目录结构或关键文件职责 | `context`、必要时 `short` | 结构认知必须同步 |
| 只做小型 UI 样式调整 | 通常可不改，除非影响功能认知 | 纯视觉改动一般不更新文档 |
| 只修文案/注释/拼写 | 通常可不改 | 前提是不影响行为说明 |

其中：
- `context` 指 `docs/llm-project-context.md`
- `short` 指 `docs/llm-project-context-short.md`
- `function-index` 指 `docs/llm-function-index.md`

---

## 4. 高频改动场景的同步要求

### 4.1 改了项目接入逻辑
例如：
- 选择目录方式改变
- `parse_project_info` 行为改变
- 包管理器识别规则改变
- 新增项目初始化字段

必须同步：
- `docs/llm-project-context.md`
- `docs/llm-project-context-short.md`
- `docs/llm-function-index.md`（如果相关函数位置或职责变化）

### 4.2 改了命令运行逻辑
例如：
- `run_command` 参数变化
- 命令状态管理变化
- 停止/重启逻辑变化
- 日志归属变化

必须同步：
- `docs/llm-project-context.md`
- `docs/llm-project-context-short.md`
- `docs/llm-function-index.md`

### 4.3 改了终端逻辑
例如：
- `TerminalWindow` 输入输出逻辑变化
- `create_shell_session` 行为变化
- 多 tab 策略变化
- 事件通道变化

必须同步：
- `docs/llm-project-context.md`
- `docs/llm-project-context-short.md`
- `docs/llm-function-index.md`

### 4.4 改了 store 或持久化模型
例如：
- 新增/删除 state 字段
- `hydrate` 流程变化
- 持久化策略变化
- 配置结构变化

必须同步：
- `docs/llm-project-context.md`
- `docs/llm-project-context-short.md`
- `docs/llm-function-index.md`

### 4.5 改了外部编辑器或系统能力
例如：
- `open_in_editor` 支持的编辑器变化（例如新增 `VS Code` / `Cursor` / `Zed`）

- 资源管理器打开逻辑变化
- 平台兼容策略变化

必须同步：
- `docs/llm-project-context.md`
- `docs/llm-project-context-short.md`
- `docs/llm-function-index.md`（函数定位变化时）

---

## 5. 更新文档时的最小动作标准

每次涉及有效代码变更时，至少执行下面动作：

1. 判断本次改动是否影响：
   - 功能说明
   - 关键函数入口
   - 行号定位
   - 数据结构
   - 事件/命令名
   - 配置说明
2. 若影响，则立刻同步修改对应文档
3. 若修改了关键函数位置，必须刷新 `docs/llm-function-index.md` 的行号；只要索引中已记录的函数、组件或 Tauri 命令位置变化，就不允许保留旧行号

4. 若修改了主流程、架构或行为，必须同时检查完整版和短版是否都需要更新
5. 若新增了新的理解文档，也要把互相导航补齐

---

## 6. 提交前检查清单

在一次任务完成前，必须自检：

- [ ] 代码变更是否影响了项目认知？
- [ ] `docs/llm-project-context.md` 是否仍准确？
- [ ] `docs/llm-project-context-short.md` 是否仍准确？
- [ ] `docs/llm-function-index.md` 的函数描述和行号是否仍准确？
- [ ] `docs/llm-doc-sync-checklist.md` 是否仍能覆盖当前收尾流程？
- [ ] 如果新增了规则/文档，导航链接是否补齐？
- [ ] 文档是否仍然与当前代码实现一致，而不是和旧实现一致？

### 可直接复用的强制检查模板

```md
## 文档同步检查
- [ ] 是否影响项目理解 / 架构 / 数据流
- [ ] 是否影响关键函数入口 / 行号 / 文件职责
- [ ] `docs/llm-project-context.md` 已检查
- [ ] `docs/llm-project-context-short.md` 已检查
- [ ] `docs/llm-function-index.md` 已检查
- [ ] `docs/llm-change-guide.md` 已检查
- [ ] `docs/llm-doc-sync-checklist.md` 已检查
- [ ] 新增文档或规则的导航已补齐
```

---

## 7. 推荐维护顺序


如果一次改动较大，建议按以下顺序同步：

1. 先改代码
2. 再更新 `docs/llm-function-index.md`
   - 因为函数名、位置、入口最容易受影响
3. 再更新 `docs/llm-project-context.md`
   - 补充完整行为和架构说明
4. 最后更新 `docs/llm-project-context-short.md`
   - 把变化浓缩成可快速消费的版本
5. 若维护规则发生变化，再更新 `docs/llm-change-guide.md`

---

## 8. 维护边界

以下情况通常**不要求**同步更新这几份 LLM 文档：

- 纯样式微调，不影响功能认知
- 纯文案调整，不影响逻辑
- 非关键位置的小重构，且不影响入口、结构、行为和数据流

但只要你不确定，就默认**更新文档**，而不是默认跳过。

---

## 9. 一句执行标准

> 每次修改代码后，都要把 LLM 文档当作同一批次产物一起维护；只要代码语义变了，�