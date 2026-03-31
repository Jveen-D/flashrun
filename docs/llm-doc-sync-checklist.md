# FlashRun 文档同步检查模板

> 用途：在每次完成代码任务前，快速确认 LLM 理解文档是否已经同步，避免“代码已变、文档仍旧”的情况。
>
> 相关文档：
> - 文档导航：`docs/INDEX.md`
> - 完整上下文：`docs/llm-project-context.md`
> - 超短上下文：`docs/llm-project-context-short.md`
> - 函数索引：`docs/llm-function-index.md`
> - 变更同步手册：`docs/llm-change-guide.md`
> - 本模板：`docs/llm-doc-sync-checklist.md`


## 1. 什么时候必须使用这份模板

只要本次任务涉及以下任一情况，就必须在任务结束前跑一遍本模板：

- 改了功能行为
- 改了核心交互流程
- 改了数据结构或状态模型
- 改了 Tauri / Rust 命令
- 改了终端事件或日志通道
- 改了关键函数入口或函数位置
- 改了配置保存方式、配置结构、配置路径
- 改了目录结构或关键文件职责
- 新增了项目理解文档或规则

如果不确定是否需要，默认需要。

---

## 2. 快速判断矩阵

| 本次改动 | 必查文档 |
|---|---|
| 改功能/架构/数据流 | `llm-project-context.md`、`llm-project-context-short.md` |
| 改函数入口/函数职责/行号 | `llm-function-index.md` |
| 改文档维护规则 | `llm-change-guide.md` |
| 新增理解文档/规则 | 上述相关文档的导航区 |

---

## 3. 执行顺序

1. 先确认代码已经改完
2. 对照本次改动，判断哪些文档受影响
3. 更新受影响文档
4. 如果关键函数位置变了，刷新 `llm-function-index.md` 的行号；只要索引中已记录的函数、组件或 Tauri 命令位置变化，就不允许保留旧行号

5. 如果新增了文档或规则，补齐导航链接
6. 任务结束前，再过一遍下面的强制检查表

---

## 4. 强制检查表

在结束任务前，逐项确认：

- [ ] 本次改动是否影响项目整体理解
- [ ] `docs/llm-project-context.md` 已同步到当前实现
- [ ] `docs/llm-project-context-short.md` 已同步到当前实现
- [ ] `docs/llm-function-index.md` 的函数描述、文件路径、行号仍然准确
- [ ] 若索引中已记录函数、组件或 Tauri 命令位置变化，相关行号已全部刷新

- [ ] `docs/llm-change-guide.md` 仍符合当前文档维护流程
- [ ] 如果新增了文档/规则，所有相关文档已补齐导航
- [ ] 文档内容描述的是“当前代码”，不是“旧代码”

---

## 5. 可直接复用的任务收尾模板

在一次代码任务结束前，可直接按下面格式自检：

```md
## 文档同步检查
- [ ] 是否影响项目理解 / 架构 / 数据流
- [ ] 是否影响关键函数入口 / 行号 / 文件职责
- [ ] `docs/llm-project-context.md` 已检查
- [ ] `docs/llm-project-context-short.md` 已检查
- [ ] `docs/llm-function-index.md` 已检查
- [ ] 若有函数/组件/Tauri 命令位置变化，相关行号已刷新

- [ ] `docs/llm-change-guide.md` 已检查
- [ ] 新增文档或规则的导航已补齐
```

如果本次改动只影响其中一部分，也至少要明确说明哪些文档无需更新，而不是跳过不看。

---

## 6. 高频场景速查

### 改了 `src/store.ts`
通常要检查：
- `docs/llm-project-context.md`
- `docs/llm-project-context-short.md`
- `docs/llm-function-index.md`

### 改了 `src/TerminalWindow.tsx` 或 `src-tauri/src/lib.rs` 的终端相关逻辑
通常要检查：
- `docs/llm-project-context.md`
- `docs/llm-project-context-short.md`
- `docs/llm-function-index.md`

### 改了 `ActionGrid` / `run_command` / `kill_command`
通常要检查：
- `docs/llm-project-context.md`
- `docs/llm-project-context-short.md`
- `docs/llm-function-index.md`

### 改了规则或新增了文档体系
通常要检查：
- `docs/llm-change-guide.md`
- 其他文档顶部导航

---

## 7. 一句硬性标准

> 只要代码语义、关键入口或�