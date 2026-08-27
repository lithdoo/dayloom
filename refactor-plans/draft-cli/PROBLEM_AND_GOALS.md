# Dayloom Draft / CLI 重构：问题与目标

> 状态：讨论起点  
> 范围：围绕现有 Draft 设计与 Archive 存档机制重新划分系统边界  
> 非目标：本文件不冻结具体实现，不重新设计 Draft 格式

## 1. 背景

Dayloom 最初希望保持一个简洁、清晰的实现，但随着 Session、Conversation、Draft、Submission、恢复、取消、事件流和 TUI 展示等职责逐步进入 `@dayloom/core`，当前架构已经明显变得更复杂。

现有主流程本身仍然合理：

```text
Conversation
  -> Draft
  -> Submission
  -> Candidate
  -> Validation / Repair / Review
  -> Archive Publish
```

问题主要不在这条业务主流程，而在于围绕它建立的 runtime ownership 和生命周期协调机制过重。

当前 Core 同时承担了：

- Session 生命周期；
- Conversation 持久化与恢复；
- Draft 持久化与 authority；
- Turn / operation 生命周期；
- Draft 同步与 pending 状态；
- Submission pipeline；
- Candidate 与发布；
- cancellation / recovery；
- 面向 TUI 的状态与事件模型。

这些职责相互耦合后，引入了 Aggregate Head、Conversation revision、Turn Commit、pendingDraftSync、retryDraftSync、CoreEvent、presentation reducer 等机制。它们解决了真实问题，但也使整体实现偏离了项目最初希望保持的简洁性。

## 2. 核心判断

这次重构不准备改变 Draft 的内容模型，也不准备把 Draft 变成领域 DSL、命令语言或可确定编译的机器格式。

Draft 继续保持现有定位：

> Draft 是面向人和 AI 的创作语义文档。

它仍然可以由 Conversation 驱动生成和修改，也仍然可以在提交阶段由 AI 根据当前 Published World 转换成 Candidate。

这次真正需要改变的是 Draft 的 ownership 和系统边界：

> Draft 从 Core 内部隐藏的持久状态，变成系统明确暴露的外部文档接口。

## 3. 目标架构方向

新的主流程目标如下：

```text
New TUI
  -> Conversation
  -> Draft document

Draft document
  + World directory
  + command kind
  -> Dayloom CLI
  -> Submission pipeline
  -> Archive Publish
```

其中：

### 3.1 CLI

新建独立 CLI，接受：

- World / Archive 目录；
- 操作命令，如 `init`、`plan`、`play`、`revise` 等；
- 一个 Draft 文档地址。

示意：

```text
dayloom init <world-dir> <draft-path>
dayloom plan <world-dir> <draft-path>
dayloom play <world-dir> <draft-path>
dayloom revise <world-dir> <draft-path>
```

CLI 的职责是把“一个 Draft 应用到一个当前存档”这件事独立完成。

内部仍然可以保留现有可靠提交链路中的核心部分：

```text
Draft
  -> lint / input validation
  -> read and pin Published World
  -> Change Plan / assignment
  -> AI conversion
  -> Candidate
  -> programmatic validation
  -> bounded repair
  -> advisory review
  -> diff
  -> re-check pinned World
  -> atomic Archive publish
```

CLI 不应承担 Conversation 或交互式 Session 的长期生命周期。

### 3.2 New TUI

现有 TUI 不继续作为新架构基础，重新建立一个更薄的 TUI 项目。

新 TUI 的主要职责是：

- 读取当前 World 上下文；
- 与用户进行 AI Conversation；
- 生成和修改现有格式的 Draft；
- 将 Draft 作为普通文档保存；
- 在提交时调用 CLI；
- 展示 CLI 的结果。

TUI 不再拥有 World publication authority，也不需要维护 Core 当前那套完整 Session / Turn / operation 状态机。

### 3.3 Archive

Archive 继续作为 Published World 的唯一事实权威。

现有 Archive V2 的关键性质原则上继续保留，包括：

- immutable object / tree / commit；
- 原子 current 切换；
- 发布前重新验证基线；
- 失败不部分修改 Published World；
- 程序校验作为硬发布边界。

## 4. 希望删除的复杂度

本次重构希望通过拆开 Conversation 生命周期和 Draft application 生命周期，删除或显著弱化当前 Core 为协调二者而产生的机制。

重点重新评估以下概念是否还需要存在：

- Core 常驻 runtime；
- active Session authority；
- Aggregate Head；
- Conversation revision 作为 World 提交流程前置条件；
- Turn Coordinator；
- Commit A / Commit B；
- pendingDraftSync；
- retryDraftSync；
- CoreEvent；
- TUI presentation reducer；
- runtime-driver；
- Core 与 TUI 之间复杂的 capability / lifecycle 同步。

这些概念并非一定设计错误，而是在 Draft 成为外部接口后，可能不再需要由同一个 runtime 统一协调。

## 5. 明确保留的设计原则

本次重构不是对现有设计的全面推翻。以下原则应优先保留：

1. Published World 是唯一已发布事实权威。
2. Draft 是不可信的创作提议，而不是已发布事实。
3. Draft 格式保持现有设计，不为了 CLI 改造成 DSL。
4. AI 可以理解 Draft、生成 Change Plan、转换 Candidate、进行受限修复，但 AI 不拥有最终发布权。
5. Candidate 必须经过确定性程序校验。
6. 发布前必须再次验证所基于的 Published World 没有发生冲突。
7. 任意失败都不能产生部分 Published World 更新。
8. Archive publication 的原子性继续作为最终 authority 线性化点。

## 6. 这次重构要解决的问题

希望最终回答并解决以下问题：

### 6.1 系统边界

- Draft 作为外部接口后，CLI 的最小职责是什么？
- 哪些现有 Core 模块属于真正的 Submission / World 逻辑，应该迁移或保留？
- 哪些模块只是为了 Session / Conversation / TUI runtime 协调而存在，可以删除？

### 6.2 Draft ownership

- Draft 由 TUI / 用户 / 外部工具直接持有后，是否还需要 Core-owned Draft store？
- Draft 的 diagnostics、快照与 audit 应如何保存，才能既简单又可追溯？
- 是否需要额外 sidecar metadata，而不污染 Draft 本身？

### 6.3 CLI application model

- `init`、`plan`、`play`、`revise` 是否都可以统一为 “World + Draft -> Publication” 模型？
- `settle`、`abandon` 等无 AI 的确定性操作如何放入同一个 CLI？
- CLI 是否应完全无状态、单次启动、完成一次操作后退出？

### 6.4 AI submission pipeline

- 现有 Change Plan、assignment、Converter、Candidate、validator、repair、review 哪些应原样保留？
- 去掉 Session / Head / Turn 前置条件后，Submission V2 应如何重新定义输入和 authority？
- Draft 与当前 Published World 的冲突检测应该放在哪一层？

### 6.5 New TUI

- TUI 如何只负责 Conversation 与 Draft editing，而不重新长出一套 Core？
- TUI 如何获取只读 World context？
- TUI 与 CLI 之间应采用进程调用、JSON 输出还是更薄的 library wrapper？

## 7. 成功标准

如果这次改造成功，Dayloom 应具备以下特征：

- 不启动 TUI，也可以手工准备一个现有格式 Draft，并通过 CLI 推进存档；
- 不使用 Dayloom 自带 TUI，也可以由其他编辑器、Agent 或人类生成 Draft 后调用 CLI；
- TUI 崩溃或 Conversation 丢失不会影响 Published World 的一致性；
- CLI 不依赖一个长期存在的 Session runtime；
- World publication 的安全性和原子性不弱于当前实现；
- Draft 的创作表达能力不因机器接口化而下降；
- 从代码结构上可以清晰看到：Conversation 属于客户端，Draft 是接缝，Submission 属于 CLI，Published World 属于 Archive。

## 8. 当前首要设计问题

下一阶段首先回答：

> 为了实现 `dayloom plan <world-dir> <draft-path>`，从当前 `@dayloom/core` 中最少需要保留哪些模块？哪些 Session / Turn / Aggregate Head 依赖可以彻底移除？

这个问题应作为后续详细改造计划和代码迁移设计的起点。
