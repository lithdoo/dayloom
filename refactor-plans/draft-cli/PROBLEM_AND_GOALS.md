# Dayloom Draft / CLI 重构：问题与目标

> 状态：方向已收敛  
> 范围：围绕现有 Draft 与 Archive 重新划分系统边界  
> 非目标：不修改 Draft 格式，不把 Draft 变成 DSL，不继续扩展旧 Core runtime

## 1. 为什么重构

当前 `@dayloom/core` 同时承担：

- Session 生命周期；
- Conversation 持久化与恢复；
- Draft authority；
- Turn / operation 生命周期；
- Draft 同步与 pending 状态；
- Submission；
- AI runtime；
- Archive publication；
- cancellation / recovery；
- 面向 TUI 的事件与展示状态。

这些职责耦合后，引入了 Aggregate Head、Conversation revision、Turn Commit、pendingDraftSync、retryDraftSync、CoreEvent、presentation reducer 等机制。

这些机制解决了真实问题，但主要是在解决“Conversation 和 Draft submission 必须被同一个长期 runtime 协调”的复杂度。

这次重构的目标是拆开这两个生命周期。

## 2. 核心判断

Draft 的格式和定位不变：

> Draft 是面向人和 AI 的创作语义文档。

Draft 不升级为 mutation DSL，也不承担 Archive authority。

真正改变的是 ownership：

> Draft 从 Core 内部状态变成显式外部文档接口。

Conversation 负责产生 / 修改 Draft；CLI 负责把 Draft 应用到 World；Archive 继续是唯一已发布事实权威。

## 3. 新的系统边界

```text
New TUI / editor / external AI
        ↓
     Conversation
        ↓
       Draft
        ↓
    Dayloom CLI
        ↓
 temporary Workspace
        ↓
       Patch
        ↓
      Archive
```

三个长期核心对象：

```text
Draft
Patch
Archive
```

Workspace 和 AI execution 都是一次 CLI invocation 内的临时实现细节。

## 4. Draft → Archive 的新主流程

Draft 驱动 mutation：

```text
Draft
  ↓ exact snapshot
pin current Archive base
  ↓
materialize 完整公开 World Workspace
  ↓
AI 根据 Draft 直接编辑 Workspace
  ↓
Programmatic Validation
  ↓
必要时有限次数 Repair
  ↓
base / Workspace diff
  ↓
Dayloom Patch
  ↓
Patch path / mutation policy validation
  ↓
re-check pinned Archive base
  ↓
atomic Archive publish
  ↓
归档 Patch + Draft snapshot
```

不再把 Change Plan、Assignment、Candidate lifecycle 作为 v1 必需架构。

如果未来实际数据证明需要额外 semantic planning / review，再根据具体问题增加，而不是预先冻结复杂协议。

## 5. Workspace 模型

Workspace 是普通的、完整的 World 文档工作树：

```text
temporary workspace/
  canon/
  characters/
  locations/
  arcs/
  state/
  days/
  ...
```

它不是 Archive，也不复制：

```text
objects/
commits/
trees/
operations/
patches/
current.json
```

AI 可以读取完整 World，但只能写 command-specific 允许路径。

最终 diff 后程序再次检查 changed paths，防止 AI 越权。

Workspace 成功或失败后都删除，不需要 Session Head、恢复或长期持久化。

## 6. Patch 模型

所有产生新 World commit 的 mutation 都必须先产生 Patch：

```text
init
plan
play
revise
settle
abandon
```

Patch 记录：

```text
path
beforeBlobHash
afterBlobHash
```

统一表达：

```text
修改： A    → B
新增： null → B
删除： A    → null
```

Patch 不保存 textual diff，也不重复保存 blob bytes。

Archive 已有 immutable blobs，因此 Patch 只引用前后 blob hash。

Patch 的职责是：

> 记录这次 mutation 相对 base 改了什么。

它不取代：

- tree：完整版本状态；
- commit：版本历史节点；
- operation：领域操作身份和 base / target 关系。

推荐关系：

```text
current.json
    ↓
  commit
    ├──────────────→ tree → blobs
    │
    └→ operation
          ├→ patch
          └→ target commit
```

Patch 不需要再保存 `targetCommitId`，避免和 operation / commit 重复 authority。

## 7. 备份与恢复边界

Patch 保存 `beforeBlobHash / afterBlobHash`，Archive 长期保留仍被 commit / Patch 引用的 immutable blobs。

因此历史 mutation 的精确前后内容可以被追溯。

但是 v1 明确不提供：

```text
dayloom revert
公开 revert API
公开 inverse-patch apply 接口
```

当前只保证数据层不丢失未来实现恢复工具所需的信息，不在这次重构中继续扩展公开还原语义。

## 8. Archive 保留的能力

Archive 继续作为唯一 Published World authority，保留：

- immutable blobs / trees / commits；
- append-only history；
- atomic `current.json` visibility switch；
- publication lock；
- pinned base re-check；
- path / media type / content policy；
- World validator；
- 任意失败不产生部分可见 World。

新的 Patch 应作为现有 Archive protocol 的增量扩展，而不是建立第二套版本系统。

## 9. CLI 的职责

CLI 是单次、无长期 Session authority 的执行器。

Draft 驱动命令：

```text
init
plan
play
revise
```

确定性命令：

```text
settle
abandon
```

只读命令：

```text
status
verify
```

CLI 负责：

- 读取 / pin Archive；
- snapshot Draft；
- materialize Workspace；
- 运行 AI edit / repair；
- programmatic validation；
- 生成 Patch；
- publication conflict 检查；
- Archive publish；
- 归档 Patch / Draft snapshot；
- 输出稳定 CLI / JSON 结果。

CLI 不负责 Conversation 或交互式 Session 的长期生命周期。

## 10. AI 边界

Dayloom 不自己实现 provider adapter。

外部模型继续由 Promptpile caller config 决定，例如 provider、model、base URL 和 API key 来源。

Dayloom CLI 自己控制：

- prompt；
- tools；
- Workspace 读写权限；
- validator；
- repair policy；
- publish policy。

CLI 的 AI 能力应尽量缩到：

```text
edit workspace
repair workspace from diagnostics
```

不迁移旧：

- AiTurnAgent；
- Turn Coordinator；
- Conversation compression；
- response arbitration；
- Draft curation；
- Conversation revision；
- Session recovery；
- Change Plan authority；
- Candidate lifecycle。

## 11. New TUI

新 TUI 保持薄层，只负责：

- 读取 World 上下文；
- Conversation；
- 生成 / 修改现有格式 Draft；
- 保存 Draft；
- 调用 CLI；
- 展示 CLI 结果和低复杂度进度。

TUI 不拥有 publication authority，也不重新实现 lifecycle rules。

生命周期和当前可用命令应通过 CLI / 共享领域层查询，例如 `dayloom status --json`。

## 12. 希望删除的复杂度

新的边界成立后，重点删除或不迁移：

- Core 常驻 runtime；
- active Session authority；
- Aggregate Head；
- Conversation revision 作为 submission authority；
- Turn Coordinator；
- Commit A / Commit B；
- pendingDraftSync；
- retryDraftSync；
- CoreEvent presentation protocol；
- TUI presentation reducer；
- runtime-driver 中的 Session synchronization；
- 为 Conversation + Draft 联合事务服务的 recovery/cancellation 状态机。

进程内 AI child cancellation 等普通执行控制可以保留，但不再发展成长期 Session authority。

## 13. 成功标准

重构成功后应满足：

1. 不启动 TUI，也可以手工准备现有格式 Draft 并通过 CLI 更新 World。
2. 外部编辑器、Agent 或人类都可以成为 Draft producer。
3. TUI 崩溃或 Conversation 丢失不会破坏 Published World 一致性。
4. CLI 单次启动即可完成一次 mutation，不依赖长期 Session runtime。
5. AI 永远不直接写 Archive。
6. Validator 仍然是唯一硬 publication boundary。
7. 每个 mutation commit 都有对应 Patch，可以明确解释这次修改了哪些文件、从什么 blob 变为什么 blob。
8. Archive publication 的原子性和冲突保护不弱于当前实现。
9. Draft 的创作表达能力不因 CLI 化而下降。
10. 从代码结构上能清晰看出：Conversation 属于客户端，Draft 是输入接缝，Workspace 是临时执行区，Patch 是 mutation 记录，Archive 是唯一事实。

## 14. 下一步实现设计

当前架构方向已经足够收敛，下一阶段不再继续增加新领域概念，重点冻结：

1. Patch V1 schema 与 Archive 存放位置。
2. `operation.patchId` 等 Archive V2 最小协议改动。
3. 各 command 的 write policy。
4. Workspace materialize / validate 实现，尤其 `init`。
5. Draft snapshot 的归档形式。
6. CLI JSON / exit-code / error contract。
7. 从当前 `@dayloom/core` 逐模块标记 KEEP / ADAPT / DELETE，并开始迁移。
