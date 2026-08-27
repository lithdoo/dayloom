# Dayloom Draft / CLI 重构：问题与目标

> 状态：Frozen v1  
> 范围：围绕 Draft、Patch、Archive 重新划分系统边界  
> 非目标：不修改 Draft 格式，不把 Draft 变成 DSL，不继续扩展旧 Core runtime，不做旧 Archive 文件兼容

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
- TUI 事件与展示状态。

这些职责耦合后，引入 Aggregate Head、Conversation revision、Turn Commit、pendingDraftSync、retryDraftSync、CoreEvent、presentation reducer 等机制。

它们主要是在解决一个根问题：

> Conversation 和 Draft submission 被迫共享同一个长期 runtime 和 authority。

新的设计直接拆开这两个生命周期。

## 2. 核心判断

Draft 的格式和定位不变：

> Draft 是面向人和 AI 的创作语义文档。

Draft 不升级成 mutation DSL，也不承担 Archive authority。

真正改变的是 ownership：

> Draft 从 Core 内部状态变成显式外部输入。

Conversation 负责产生 / 修改 Draft；CLI 负责把 Draft 应用到 World；Archive 是唯一 Published World authority。

## 3. 新系统只保留三个长期概念

```text
Draft
Patch
Archive
```

含义：

```text
Draft   = 想表达什么
Patch   = 这次版本具体怎么变化
Archive = 当前事实和完整历史
```

Workspace、AI edit、repair、publish lock 都只是一次 CLI invocation 内部机制。

## 4. 新边界

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

最重要的拆分：

```text
Conversation → Draft
```

属于客户端。

```text
Draft → Archive
```

属于 CLI。

两者不再共享长期 Session authority。

## 5. Draft → Archive 主流程

```text
Draft
  ↓ exact snapshot
pin current Archive base
  ↓
materialize complete World Workspace
  ↓
AI 根据 Draft 编辑 Workspace
  ↓
Programmatic Validation
  ↓
必要时 bounded Repair
  ↓
Workspace file diff
  +
deterministic control transition
  ↓
Dayloom Patch
  ↓
Patch validation
  ↓
re-check pinned Archive
  ↓
atomic Archive publish
  ↓
Published commit
```

v1 不需要 Change Plan、Assignment 或 Candidate lifecycle。

如果以后真实运行数据证明需要 semantic planning，再针对具体问题增加，而不是预先冻结成 protocol authority。

## 6. Workspace

Workspace 是完整、普通的 World 文档工作树：

```text
temporary workspace/
  canon/
  characters/
  locations/
  arcs/
  state/
  story-seeds/
  days/
  ...
```

它不是 Archive，也不是 Candidate overlay。

不包含：

```text
manifest.json
current.json
commits/
objects/
operations/
.locks/
```

AI 可以读完整公开 World，但只能写 command-specific paths。

最终 Patch 生成后，程序再独立检查 changed paths。

Workspace 成功或失败后都删除，不需要 Session Head、恢复或长期持久化。

## 7. Patch 是完整版本跃迁记录

Patch 不只记录文件变化，还记录 World control 的前后状态。

World 一个版本由：

```text
root tree
+
commit.control
```

共同组成。

所以 Patch 表达：

```text
base commit
+
file changes
+
control before/after
```

文件变化：

```text
path
beforeBlobHash
afterBlobHash
```

统一表示：

```text
修改： A    → B
新增： null → B
删除： A    → null
```

Patch 不保存 textual diff，也不重复保存 blob bytes。

它使用 immutable blob hash 表达精确前后内容。

因此 `settle` 即使没有文件变化，只要 control 从 `awaiting-settle` 合法变为 `idle`，仍然可以形成完整 Patch。

## 8. 新 Archive 的核心关系

新实现直接采用新的 Archive 数据模型，不设计旧文件兼容或旧 history 迁移。

核心关系：

```text
current
  ↓
commit
  ├──→ tree → blobs
  ├──→ parent commit
  └──→ operation
          └──→ patch
                  └──→ Draft snapshot (optional)
```

职责固定：

```text
blob      = 文件内容
tree      = 完整文件集合
patch     = 相对父版本改了什么
operation = 这次是什么领域 command
commit    = 发布后的完整版本
current   = 当前可见版本
```

每个 reachable commit 必须恰好有一个 operation 和一个 Patch。

Draft-driven mutation 还必须有 exact Draft snapshot。

## 9. Operation 不再是状态机

新的 Operation 是 immutable command record。

不再需要：

```text
open
prepared
published
aborted
```

是否已发布只由：

```text
current → reachable commit
```

决定。

publish 失败时可以留下不可达 immutable orphan artifacts，它们没有 authority，不需要恢复状态机。

## 10. Patch 必须能重新证明 Commit

`verify` 必须能够对历史中的每一个 commit 执行：

```text
parent tree/control
+
Patch
  ↓
重新推导
  ↓
child tree/control
```

并严格核对 child commit。

因此 Patch 不是日志文本，而是可程序验证的版本跃迁证明。

至少验证：

```text
Patch base == parent commit
Patch control.before == parent.control
Patch control.after == child.control
apply(parent tree, Patch changes) == child root tree
Operation command == Patch command
Patch hash == Operation anchor
Draft snapshot hash 正确（如有）
```

这形成修改记录和版本历史的闭环。

## 11. 备份与恢复边界

Patch 保存：

```text
beforeBlobHash
afterBlobHash
```

Archive 保存 immutable blobs。

Draft-driven operation 还归档 exact Draft snapshot。

所以历史 mutation 的输入和前后内容都不会丢失。

但 v1 明确不提供：

```text
dayloom revert
公开 revert API
inverse-patch apply 接口
```

当前只保证数据层保留完整信息，不扩展公开恢复产品面。

## 12. CLI 职责

CLI 是单次执行器。

Draft-driven mutation：

```text
init
plan
play
revise
```

确定性 mutation：

```text
settle
abandon
```

只读：

```text
status
verify
```

CLI 负责：

- 读取 / pin Archive；
- exact snapshot Draft；
- materialize Workspace；
- AI edit / repair；
- programmatic validation；
- deterministic control transition；
- 生成 / 验证 Patch；
- conflict re-check；
- atomic publication；
- 归档 Patch / Draft snapshot；
- 稳定 CLI / JSON 输出。

CLI 不负责 Conversation 或长期 Session lifecycle。

## 13. Publication 原则

所有 mutation 使用同一个 publisher。

顺序：

```text
validated Patch
  ↓
acquire publish lock
  ↓
re-check base
  ↓
install immutable blobs
  ↓
install target tree
  ↓
install Draft artifacts（如有）
  ↓
install Patch
  ↓
install Operation
  ↓
install Commit
  ↓
verify target graph
  ↓
atomic current.json switch
```

`current.json` 是最后 visibility step。

在此之前失败：Published World 不变。

current 切换成功之后：mutation 已发布，临时 cleanup 失败不能反向污染业务状态。

## 14. AI 边界

Dayloom 不实现 provider adapter。

具体模型连接由 Promptpile caller config 决定。

Dayloom CLI 控制：

- prompt；
- tools；
- Workspace write policy；
- validator；
- repair policy；
- publication。

AI 能力缩到：

```text
edit workspace
repair workspace from diagnostics
```

AI 没有 Archive authority，也不能生成 control / commit / Patch protocol files。

## 15. New TUI

新 TUI 保持薄层：

- Conversation；
- 生成 / 修改现有 Draft；
- 保存 Draft；
- 调用 CLI；
- 展示 CLI 最终结果。

TUI 不拥有 publication authority，也不重新实现 lifecycle rules。

生命周期和 command availability 通过：

```text
dayloom status --json
```

获得。

## 16. 希望删除的复杂度

新的边界成立后，不迁移：

- Core 常驻 runtime；
- active Session authority；
- Aggregate Head；
- Conversation revision 作为 submission authority；
- Turn Coordinator；
- Commit A / Commit B；
- pendingDraftSync；
- retryDraftSync；
- Candidate lifecycle；
- Change Plan / Assignment authority；
- CoreEvent presentation protocol；
- TUI presentation reducer；
- runtime-driver Session synchronization；
- 为 Conversation + Draft 联合事务服务的 recovery/cancellation 状态机。

普通进程内 AI child cancellation 可以存在，但不得发展成长期 Session authority。

## 17. 成功标准

重构完成后必须满足：

1. 不启动 TUI，也能手工准备 Draft 并通过 CLI 更新 World。
2. 外部编辑器、Agent、人类都可以成为 Draft producer。
3. Draft 格式保持原样。
4. CLI 单次 invocation 即可完成 mutation。
5. AI 永远不直接写 Archive。
6. Validator 是唯一硬 publication boundary。
7. 所有 mutation commit 都有 Patch。
8. Patch 同时解释 file delta 和 control delta。
9. 每个 reachable commit 都能从 parent + Patch 重新证明。
10. Draft-driven commit 可以追溯 exact Draft snapshot。
11. publication 失败不会产生部分可见 World。
12. `current.json` 永远是最后 visibility step。
13. `status` 与 command guard 使用同一个 lifecycle 判断。
14. New TUI 不重新获得 Archive authority。
15. 新代码结构中长期核心概念只剩 Draft、Patch、Archive。

## 18. 实施依据

上层命令设计：

```text
refactor-plans/draft-cli/CLI_COMMAND_DESIGN.md
```

可直接实施的 schema、publication theorem、JSON contract、阶段顺序和测试门槛：

```text
packages/cli/IMPLEMENTATION_DRAFT.md
```

实施过程中不再以旧 Core / 旧 Archive 文件结构为兼容约束。