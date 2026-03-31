# FlashRun 文档导航

> 用途：作为项目内 LLM 理解文档与同步规则的统一入口。

## 文档总览

### 1. `docs/llm-project-context.md`
完整版项目理解文档。

适合查看：
- 项目定位
- 技术栈
- 架构分层
- 数据流
- 前后端职责
- 关键能力说明

### 2. `docs/llm-project-context-short.md`
超短上下文版。

适合查看：
- 快速建立项目心智模型
- 快速知道关键文件和关键链路
- 快速给大模型提供上下文

### 3. `docs/llm-function-index.md`
函数级索引。

适合查看：
- 关键函数/组件入口
- 文件路径
- 行号定位
- 常见需求对应入口

### 4. `docs/llm-change-guide.md`
变更同步手册。

适合查看：
- 什么改动要同步什么文档
- 文档维护边界
- 提交前检查要求
- 推荐维护顺序

### 5. `docs/llm-doc-sync-checklist.md`
文档同步检查模板。

适合查看：
- 任务结束前的文档检查表
- 可直接复用的收尾模板
- 高频场景的快速检查方法

---

## 推荐阅读顺序

### 想快速理解项目
1. `docs/llm-project-context-short.md`
2. `docs/llm-project-context.md`
3. `docs/llm-function-index.md`

### 想快速改功能
1. `docs/llm-function-index.md`
2. `docs/llm-project-context-short.md`
3. `docs/llm-project-context.md`

### 想确保文档不滞后
1. `docs/llm-change-guide.md`
2. `docs/llm-doc-sync-checklist.md`

---

## 最短使用建议

- 新接手项目：先看 `short`，再看 `context`
- 要定位改动入口：看 `function-index`
- 要同步维护文档：看 `change-guide`
- 任务收尾时：跑 `doc-sync-checklist`

---

## 一句总结

> 如果把代码看作实现本体，那么这套文档就是给后续大模型和维护者准备的“理解层”和“同步层”。