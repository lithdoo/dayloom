# Dayloom Core 完整化与正式 Runtime 晋升计划

> 状态：**Implemented**；验证结果见 [实施记录](./CORE_PRODUCTIZATION_IMPLEMENTATION.md)
> 日期：2026-08-24
> 当前实现：`@dayloom/core@0.0.0`
> 最终产品包：`@dayloom/core`
> 数据规范：`@dayloom/archive-protocol` V2 + Dayloom World Profile V1
> 消费方：`@dayloom/tui`、未来 CLI/Web/GUI
> 目标：把已经具备完整产品生命周期的 Core，从并行实验命名、beta 依赖和冲突文档中收口为 Dayloom 唯一正式 Runtime。

本文定义 Core 完整化的范围、优先级、目标架构、迁移顺序、发布门禁与验收证据。确认后它成为本次改造计划；实施者不得把“完整化”解释为复制旧 Core 的内部框架，也不得引入第二套 Runtime、World authority、Session API 或兼容 facade。

---

## 0. 执行结论

Core 已经完成最初 Play-only MVP 之后的主要产品能力：

```text
empty World
→ Init
→ Planning
→ Play
→ Settle
→ next Planning

idle → Revise → idle
planned / awaiting-settle → Abandon → idle
```

它同时已经具备：

- Archive V2 publication；
- World Profile V1；
- legacy filesystem World 显式迁移；
- 四类 conversational Session；
- Promptpile Conversation 压缩；
- Promptpile React Thought / Observe / Check / Final 过程流；
- Final streaming；
- ready/running cancel；
- deterministic publication、OCC、dispose/drain 和失败闭环；
- 正式 TUI consumer 接入。

因此本改造不重新实现生命周期。剩余工作按以下顺序推进：

```text
Gate 0  核对外部包、消费者、旧存档与退役条件
P0      修复当前协议正确性缺陷
P1      建立唯一现行契约并完成发布级加固
P2      一次原子 cutover：Core、消费者、文档和 CI 同时晋升
P3      完成必要的存档迁移、外部安装和发布验证
```

最终完成条件不是“代码目录不再叫 core”这一项机械变化，而是：

> 一个公开包、一个 Runtime truth、一个 World Profile、一个 TUI backend、一套现行文档、一条可重复安装和迁移的发布链路。

---

## 1. 当前基线与剩余缺口

### 1.1 已完成能力

当前 `@dayloom/core` public surface 已保持 consumer-neutral：

```ts
createDayloomCore(options)
core.getState()
core.subscribe(listener)
core.startSession(kind)
core.send(text)
core.submit()
core.cancel()
core.settle()
core.abandonDay()
core.dispose()
```

当前稳定业务状态：

```text
uninitialized
invalid
published idle
published planned
published awaiting-settle
```

当前 Session：

```text
init
planning
play
revise
```

当前实现已经有针对以下边界的自动化证据：

- 空 World 到 day2 planned 的完整 headless lifecycle；
- Profile V1 Init、Planning、Play、Settle、Revise；
- planned/awaiting-settle 的 Abandon 与 replan；
- migration inventory、未知 UTF-8 文件保留、binary/symlink fail-closed；
- publication visibility switch 与冲突处理；
- Conversation compression；
- Process Pile 流式消费；
- running cancel linearization；
- dispose 等待 child/provider/operation drain；
- TUI scripted contract 与生产 Core startup PTY。

### 1.2 阻止正式晋升的问题

#### A. 已知协议正确性缺陷

Core 当前显式传入：

```text
--max-step 1
```

当 Check 返回 `continue=true` 时，Promptpile React 合法地产生：

```json
{
  "type": "process.completed",
  "stop_reason": "max_step",
  "final": { "status": "completed", "content": "..." }
}
```

但 Core reducer 当前只接受：

```text
final.status=completed + stop_reason=final
```

从而把合法终态误报为：

```text
React Process Pile Final evidence is inconsistent.
```

这是 P0 blocker。修复前不得宣称 Runtime 已达到正式发布正确性。

#### B. 产品身份不一致

仓库目前同时存在：

```text
packages/core     → 根 README / 发布站点称为正式 Core
packages/core    → 实际驱动正式 TUI
packages/core-old → legacy CLI 依赖
```

这造成 package identity、文档、示例和维护责任不一致。

#### C. 规范代际不一致

- `CORE_IMPLEMENTATION_DRAFT.md` 仍以初始 MVP 为边界；
- `CORE_FUNCTIONAL_COMPLETION_DRAFT.md` 主要冻结 Profile V0；
- `CORE_WORLD_PROFILE_V1_IMPLEMENTATION_PLAN.md` 已将数据模型推进到 Profile V1；
- 根 README、发布站点和 TUI 文档对正式 Runtime 的说法不一致。

#### D. 发布成熟度不足

- `@dayloom/core` 版本仍是 `0.0.0`；
- workspace consumer 使用 `"*"`；
- Promptpile 生态依赖仍为 beta；
- 缺少以最终包名执行的 packed fresh-install、升级安装和迁移验收；
- 当前 migration CLI 隶属于临时包名 `dayloom-core`。

#### E. 真实模型分支覆盖不足

当前成功 E2E 主要让 Check 返回 `decision=false`，没有覆盖：

- Check `decision=true`；
- 单步预算耗尽后仍完成 Final；
- 多个非 ASCII Final delta；
- Final 完成后 child 非零退出；
- provider 返回合法但极端分片；
- 诊断模式下失败 work 的可定位性。

---

## 2. 规范来源与收口规则

### 2.1 实施前的事实来源

在现行 contract 文档建立前，判断当前行为只使用：

```text
1. @dayloom/archive-protocol public contract
   → Archive V2 control plane、hash、tree、commit、operation、OCC

2. package public schema/type 与生产代码
   → 当前可执行 public contract

3. executable tests、fixtures、CI workflow
   → 当前实现证据

4. CORE_WORLD_PROFILE_V1_IMPLEMENTATION_PLAN.md
   → Profile V1 已实施设计的解释来源

5. 其它 Core/TUI plan 或 draft
   → 历史设计证据，不单独定义现行行为
```

若计划文字与 public schema、生产实现和一致的测试证据冲突，先把冲突记录为待修问题，不能让计划稿静默覆盖可执行事实。

### 2.2 收口后的唯一规范

P1 必须建立并发布：

```text
doc/contracts/WORLD_PROFILE_V1.md
doc/contracts/CORE_RUNTIME_V1.md
```

收口后的优先级固定为：

```text
1. @dayloom/archive-protocol public contract
2. Dayloom published contracts
3. public schema/type
4. executable conformance evidence
5. implementation plans and history
```

其中：

```text
WORLD_PROFILE_V1
→ persisted document、authority 与 relation

CORE_RUNTIME_V1
→ public API/state/capability/error/temporal semantics
→ 内含 Process Pile adapter、停止原因、Final、cancel/drain 章节
```

计划稿在对应 contract 和实施证据落地后归档，不继续充当规范拼图。

---

## 3. 完整化目标与非目标

### 3.1 目标

完成后必须满足：

1. Dayloom 只有一个正式 Runtime 包：`@dayloom/core`。
2. 正式 Runtime 的实现来自当前 Core，不来自旧 Core 的框架式重写。
3. TUI 只依赖最终 `@dayloom/core` package root。
4. Archive V2 + World Profile V1 是唯一现行持久化模型。
5. 所有合法 Process Pile 成功/失败终态得到与上游协议一致的解释。
6. caller 只能配置 provider/LLM，不得控制目录、prompt、tools、hook 或 Runtime agent budget。
7. Session、World、publication、cancel、dispose 的 public temporal semantics 有测试证据。
8. legacy World 迁移显式、只读源、可审计、可重复验证。
9. 包安装不依赖 monorepo workspace link 或源码 deep import。
10. 活跃文档不再出现 Core/Core 身份矛盾。

### 3.2 非目标

本次不实现：

- 旧 Core public API 兼容层；
- RuntimeSnapshot/RuntimeEvent 模拟层；
- CommandRegistry、StateMachine、RuntimeOperations framework；
- 双 backend 或运行时 backend selector；
- 并发 Session、mutation queue、scheduler、actor、worker；
- agent retry framework；
- active Session crash resume；
- 跨 Core instance Conversation resume；
- 自动迁移 legacy World；
- plugin/provider framework；
- MCP/application tools；
- Promptpile tools/after-hook；
- Web/GUI consumer；
- 为了“功能数量对等”复制旧 Core 中没有真实 consumer 的导出。

这些能力只有在出现独立产品需求、失败语义和真实第二 consumer 后，才通过后续版本化设计进入范围。

---

## 4. 冻结不变量

### 4.1 Authority invariant

```text
Published World truth
= validated Archive V2 current graph
+ World Profile V1 relation validation
```

模型输出、Conversation、React work、Observe、Final、TUI transcript 都不是 Published World authority。

### 4.2 Conversation invariant

每个 Session 只有：

```text
immutable Dayloom context
+ one writable Conversation
```

Context/user/submit marker 只通过 Promptpile public CLI append。Core 不直接制造 Promptpile message、receipt 或 private work artifact。

### 4.3 Agent completion invariant

以下成功层级互不等价：

```text
Promptpile React process completed
→ Process Pile terminal validated
→ Core accepted non-empty Final
→ submission parsed and business-validated
→ Archive publication visible
```

下游成功必须以前一层成功为必要条件，但上游成功不保证下游成功。

### 4.4 Publication invariant

```text
staging validate
→ candidate tree
→ commit
→ current.json final visibility switch
```

`current.json` 替换前失败不得产生新 Published World；替换后不得假装已回滚。

### 4.5 Lifecycle invariant

```text
terminal business state
→ child/provider/pipe drain
→ workspace cleanup attempt
→ public Promise settle
```

dispose settle 时不得残留 Core-owned child、operation、cancel continuation 或 runtimeRoot filesystem access。

### 4.6 Consumer invariant

Core 只公开 application facts。Hub/Session page、loading label、transcript formatting、焦点、快捷键和错误展示仍由 TUI 拥有。

---

## 5. ReAct 调用策略冻结

### 5.1 当前版本保持单步预算

本次完整化保持：

```text
max_steps = 1
```

理由：

- 保持现有一次用户操作的 provider 调用上界；
- 不在修复协议错误时同时改变成本、延迟与取消窗口；
- 当前业务 prompts 与 E2E 都基于一次 Thought/Observe/Check；
- 多步 agent 是独立产品策略，不是包晋升前置条件。

`max_steps=1` 的准确语义是：

```text
Check continue=false
→ stop_reason=final
→ required Final

Check continue=true 且已到预算
→ stop_reason=max_step
→ required Final
```

二者都允许：

```text
final.status=completed
```

Core 不得把 `stop_reason=max_step` 当作 agent failure。

### 5.2 Final 校验规则

Reducer 必须从最后一个 Check 自己推导唯一合法的停止原因：

```text
Check continue=false
→ expectedStopReason=final

Check continue=true && completedSteps >= maxSteps
→ expectedStopReason=max_step

Check continue=true && completedSteps < maxSteps
→ expected next phase=thought，不允许 terminal
```

`process.completed` 必须满足：

```text
无 active phase
steps_completed == completed Check count
完整经历 work.ready
完整经历 Final started → delta* → completed
final.status == completed
stop_reason == expectedStopReason
terminal final.content == concatenated Final delta content
Final trim 后非空
Process Pile EOF
child exit code == 0
```

`final.status=skipped` 对 Dayloom 始终是 `AGENT_FAILED`，无论上游停止原因是什么，因为 Dayloom 的 send/submit 均要求非空 Final。

### 5.3 配置 authority

CLI invocation 是 agent budget 的唯一运行权威。实现抽取一个 Core-owned 常量：

```ts
const REACT_MAX_STEPS = 1;
```

并只在启动 Promptpile React 时显式传入：

```text
--max-step <REACT_MAX_STEPS>
```

derived TOML 不再写 `max_step`；它只投影 provider、prompts 和 Core-owned tools file。caller `[promptpile-react]` 仍整体禁止。这样 Runtime policy 不依赖配置合并，也没有 TOML/CLI 双通道漂移。

### 5.4 后续多步版本

若未来启用 `max_steps > 1`，必须独立冻结：

- 固定预算值与 provider 调用上界；
- Check continue 的产品语义；
- 每一步 work streaming；
- cancel 在任意 phase 的线性化；
- max-step Final 的用户提示；
- 费用/延迟诊断；
- submit 与 send 是否共享预算。

不得通过 caller TOML 偷偷开放该能力。

---

## 6. P0 — 当前正确性修复

### 6.1 Reducer 修复

修改：

```text
packages/core/src/promptpile/react-runner.ts
```

处理 Check completion 时记录：

```text
expectedStopReason =
  continue=false                    ? final
  : completedSteps >= maxSteps      ? max_step
  : null and expect next Thought
```

完成 Final 时要求 `event.stop_reason === expectedStopReason`。仍必须保持 phase order、step count、delta equality、EOF 和 exit-code 校验。

不要通过删除 evidence equality 或放宽 schema 规避问题。

### 6.2 单元回归

增加至少以下 Process Pile fixtures：

```text
completed + final + matching deltas             → success
completed + max_step + matching deltas          → success
check=false + terminal max_step                  → AGENT_FAILED
check=true at budget + terminal final            → AGENT_FAILED
completed + final + mismatching content         → AGENT_FAILED
completed + max_step + mismatching content      → AGENT_FAILED
completed + unknown stop_reason                  → schema/protocol failure
skipped + max_step                               → AGENT_FAILED: Final required
completed Final + empty content                  → AGENT_FAILED
terminal success + child exit nonzero            → AGENT_FAILED
```

### 6.3 真实 beta.5 E2E

fixture provider 必须新增 `react_check_decision={decision:true}` 分支，并验证：

```text
max_steps=1
→ one Thought/Observe/Check
→ stop_reason=max_step
→ Final streamed once
→ output.completed once
→ send returns ok
→ work directory cleaned
```

### 6.4 TUI 回归

生产 Core TUI integration 增加同一路径，正向验证：

```text
send result == ok
Final text visible exactly once
output.completed exactly once
no work.failed/output.failed for the operation
session remains ready
下一次 send 或 submit 仍可执行
```

### 6.5 P0 出口

```text
Core unit/integration green
TUI integration green
check=false and check=true real provider fixtures green
known error no longer reproducible
```

---

## 7. P1A — 现行契约与文档收口

### 7.1 建立唯一现行 Runtime 文档

建立 §2.2 的两份 published contract，并据此重写活跃 Core 文档，至少覆盖：

- package identity；
- public API；
- state/capability theorem；
- World Profile V1；
- Session/Conversation topology；
- ReAct/Process Pile；
- cancellation/dispose；
- migration；
- error taxonomy；
- installation/testing。

### 7.2 历史文档归档

以下文档在其实施证据被 published contract 吸收后移动到 `doc/archive/plans/`：

```text
CORE_IMPLEMENTATION_DRAFT.md
CORE_FUNCTIONAL_COMPLETION_DRAFT.md
CORE_CONVERSATION_COMPRESSION_DRAFT.md
CORE_PROMPTPILE_REACT_BETA4_UPGRADE_PLAN.md
TUI_CORE_ADAPTATION_DRAFT.md
```

`CORE_WORLD_PROFILE_V1_IMPLEMENTATION_PLAN.md` 同样在 `WORLD_PROFILE_V1.md` 落地后归档。现行 contract 不再由多份根目录计划稿拼接而成。

### 7.3 修正直接矛盾

必须同步修改：

```text
README.md
doc/README.md
doc/index.md
doc/packages/CORE.md
doc/reference/ARCHIVE_FORMAT.md
doc/guide/GETTING_STARTED.md
doc/guide/TROUBLESHOOTING.md
doc/testing/OVERVIEW.md
packages/tui/README.md
examples/dayloom-tui/README.md
```

P1A 只修正行为契约，不提前伪造包身份。包晋升前允许一个明确状态说明：“正式候选实现当前位于 `packages/core`，TUI 已使用该实现”；最终包名相关文档在原子 cutover 中一次切换。

### 7.4 文档 guard

文档 guard 分两步启用。

P1A 扩展检查范围：

```text
doc/**
README.md
packages/*/README.md
examples/*/README.md
两份 published contract
```

并检查：

- 同一文件不得同时宣称旧 Core 与 Core 为正式 Runtime；
- 活跃文档禁止引用已归档计划作为现行规范；
- archive 目录豁免历史术语。

原子 cutover 后再启用最终身份 guard：

- 活跃文档禁止 `@dayloom/core`；
- 活跃文档禁止把正式 Runtime 称为 MVP；
- 示例和 TUI 只允许最终包名；
- 生产源码与 workspace 依赖禁止旧包名。

---

## 8. P1B — 公共 API、错误证据与依赖加固

### 8.1 Public API 冻结

最终 `@dayloom/core` package root 只公开：

```text
createDayloomCore
CreateDayloomCoreOptions
DayloomCore
CoreInitializationError
CoreError/CoreErrorCode/CoreResult
CoreEvent/ReactWorkPhase
CoreState/CoreWorldState
CoreSessionKind/CoreSessionStatus
PublishedWorldPhase
```

不得重新导出 internal repository、publisher、parser、runner、prompt、schema validator 或测试 seam。

增加 package-surface 与 TypeScript consumer fixture，防止 accidental export。

离线迁移不属于 Runtime application surface，单独从以下 subpath 导出：

```text
@dayloom/core/migration
→ importLegacyFilesystemWorldV1
→ migration report/result types
```

### 8.2 Error contract

冻结现有错误码：

```text
NOT_AVAILABLE
BUSY
INVALID_INPUT
CONVERSATION_FAILED
AGENT_FAILED
SUBMISSION_INVALID
WORLD_CONFLICT
WORLD_INVALID
CANCELLED
DISPOSED
INTERNAL_ERROR
```

要求：

- public message 不含 secret、provider payload、完整 prompt 或本地正文；
- protocol error code 与必要标量可进入安全短消息和既有 TUI diagnostics；
- World truth 类错误与 agent/conversation 类错误不得混映射；
- TUI 不解析英文 message 决定行为，只依赖 code/result/state。

### 8.3 Typed protocol failure evidence

不增加 generic diagnostics sink。React adapter 内部使用一个不从 package root 导出的 typed error，携带最小脱敏证据：

```text
ReactProtocolError
  code
  eventType?
  sequence?
  phase?
  expectedStopReason?
  actualStopReason?
  expectedLength?
  actualLength?
  childExitCode?
```

error 不携带 delta 正文、prompt、provider payload、credential 或 Conversation 内容。Core 将其映射为 `AGENT_FAILED` 和包含 protocol error code/必要标量的安全短消息；TUI 现有 DiagnosticLogger 记录 CoreResult 摘要，无需 Core 再拥有文件 sink，也不向 TUI 暴露 internal error class。

需要调查上游 work 时使用 `PROMPTPILE_REACT_DEBUG` 的既有行为；默认清理策略不改变。

### 8.4 依赖兼容矩阵

为每个 Promptpile 依赖记录：

```text
package version
consumed public CLI/schema
pinned behavior
real packed acceptance
upgrade owner
```

任何升级必须验证：

- Process Pile schema；
- stop reason；
- work lifecycle；
- Observe handoff；
- Final streaming；
- cancellation/drain；
- Completion Receipt ownership；
- Windows fd3 行为。

禁止 semver range 自动跨越协议行为版本。

### 8.5 安装证据

新增 packed smoke：

```text
npm pack archive-protocol
npm pack final core package
npm pack tui
install into clean temp project
resolve package roots and bins
create empty World
run fixture-provider lifecycle
dispose with no residue
```

smoke 不得依赖仓库源码路径或 workspace symlink。

---

## 9. P2 — Core、消费者与文档原子晋升

### 9.0 Gate 0 结论是前置输入

执行 cutover 前必须已经回答：

```text
@dayloom/core 是否发布过、当前版本和 dist-tags
@dayloom/core 是否发布过、当前版本和 dist-tags
仓库内哪些 package/bin/workflow 仍消费旧 Core/CLI/TUI
已知仓库外 consumer 是否存在
旧 packages/core 是否需要一个有截止版本的迁移窗口
```

这些是只读事实盘点，不引入 registry、backend selector 或兼容框架。没有证据时不得假设“无人使用”，也不得因此默认永久保留旧实现。

### 9.1 晋升策略

采用一次受控 cutover，不建立永久双 backend，也不提交中间不可构建状态：

```text
处理 current packages/core 的最终去向
处理 core-old/cli/tui-old 的最终去向
current packages/core → packages/core
package name           → @dayloom/core
binary                 → dayloom-core
TUI imports/dependency → @dayloom/core
examples/workflows     → @dayloom/core
lockfile/guards/docs   → @dayloom/core
```

旧实现链必须作为一个整体处理：

```text
packages/core
packages/core-old
packages/cli
packages/tui-old
```

默认终态是删除它们的产品 workspace 身份。若 Gate 0 证明存在真实过渡消费者，只允许把必要源码移到默认 workspace、build、test、publish 之外的历史区，并记录确定删除版本；不得发布或维护第二个 production Runtime/TUI/CLI。

```text
允许：doc/archive、fixtures/legacy、明确的迁移输入
禁止：@dayloom/core-legacy runtime package、双 backend、运行时 selector
```

### 9.2 不提供旧 API adapter

旧 `@dayloom/core` 的 command registry、state machine、operation classes 和大量 internal exports 不进入新 package root。

这是一次明确的 pre-1.0 breaking replacement。迁移说明必须列出：

```text
旧 API                         新 API
Runtime/CommandRegistry        createDayloomCore + capabilities
command execution              explicit startSession/settle/abandonDay
legacy phase snapshot          CoreState.world.phase
session callbacks              CoreEvent + CoreResult
legacy filesystem state        explicit import via @dayloom/core/migration
```

没有真实调用方的旧导出不建立映射。

### 9.3 单一 cutover 变更集

同一个可构建 cutover 提交中更新：

```text
packages/tui/package.json
packages/tui/src/**
packages/tui/test/**
examples/dayloom-tui/**
scripts/check-examples.mjs
root package.json
package-lock.json
.github/workflows/**
published docs
```

提交结束时必须同时满足：

```text
npm install/ci 可解析
archive-protocol → core → tui 可构建
TUI 不再引用 core
examples 与 workflows 不再构建 core
default workspace/build/test/publish 不再包含旧 Core/CLI/TUI
published docs 与真实依赖图一致
最终身份 guards 已启用
```

生产代码 guard 必须禁止：

```text
@dayloom/core
@dayloom/core-legacy
@dayloom/core-old
deep import from @dayloom/core
```

### 9.4 Version policy

版本号由 Gate 0 的 registry 事实决定。若包从未对外发布，建议候选版本：

```text
@dayloom/core@1.0.0-beta.1
@dayloom/tui@1.0.0-beta.1
```

若已有公开版本，则按其 semver 历史选择合法的下一版本，不能覆盖既有 tarball 或错误复用 dist-tag。beta 阶段允许修复契约缺陷，但 public state/event/error 和 Profile V1 的破坏性变更必须升级版本并附 migration note。达到稳定门禁后才发布 `1.0.0`。

内部 workspace 依赖使用明确同步版本，不再使用 `"*"`。

---

## 10. P3 — 必要的 World 迁移

### 10.1 支持的输入

正式产品必须明确区分：

```text
existing valid Archive V2 / Profile V1
existing Archive V2 / Profile V0
legacy filesystem World
invalid/partial/corrupt root
```

处理方式固定为：

```text
valid Profile V1
→ createDayloomCore 直接打开，不进入 migration

legacy filesystem World
→ explicit import into a separate empty target

Profile V0
→ 仅当 Gate 0 证明存在真实 durable fixture/用户存档时实现独立 upgrade

invalid/partial/corrupt root
→ fail-closed diagnostic，不猜测来源、不自动修复
```

不得为了理论兼容性预先实现 Profile V0 upgrader。

### 10.2 迁移原则

- 自动启动不迁移；
- source 始终只读；
- target 必须独立且预检查；
- target 非空时 fail-closed；
- 每个 legacy 输入文件进入 imported authority、`legacy/**` 或 explicit rejection，不能静默遗漏；
- import report 包含结果 revision 和逐文件 hash/disposition；
- 成功后使用正式 Core read-side 重新分类；
- 失败不产生伪成功 `current.json`；
- 文档必须要求用户保留 source 备份直到验收完成。

### 10.3 CLI

legacy filesystem import 的最终命令：

```text
dayloom-core archive import-legacy-world \
  --source <legacy-world> \
  --target <archive-v2-world>
```

保持 CLI 最小：

- `--help`；
- 成功时输出已有 JSON result；
- 非零失败码；
- 不输出 credential 或 World 正文。

不为未发布或无真实消费者的旧 bin 建立转发 alias。只有 Gate 0 证明 `dayloom-core` 已有外部使用时，才允许保留一个明确截止版本的提示入口。

如果确需 Profile V0 upgrade，使用不同命令和 fixture：

```text
dayloom-core archive upgrade-world-profile-v1 \
  --source <archive-v2-profile-v0> \
  --target <archive-v2-profile-v1>
```

import 与 upgrade 不共享 source parser；只复用 publication/read-back 等已经存在的 mechanical primitive。

### 10.4 Migration acceptance

至少验证：

```text
legacy → Profile V1 → restart → Planning
unknown UTF-8 retained
binary rejected explicitly
symlink rejected
source/target overlap rejected
non-empty target rejected
partial failure leaves no visible target World
report accounts for every source entry once
```

只有 Gate 0 证明需要 Profile V0 upgrade 时，额外验收：

```text
Profile V0 → Profile V1 → restart → next legal action
source remains byte-identical
target read-back satisfies Profile V1
```

不要求两个独立 target 的 Archive bytes、随机 ID 或 timestamp 相等。

---

## 11. CI、测试与发布矩阵

### 11.1 必须保留的测试层

```text
schema/parser unit
World relation and builder unit
publication integration
Session lifecycle integration
Process Pile adapter conformance
real packed Promptpile React E2E
TUI driver/presentation unit
scripted PTY
production Core startup PTY
packed fresh-install smoke
migration/restart acceptance
```

### 11.2 平台矩阵

核心门禁：

```text
Ubuntu latest × Node 20/22
Windows latest × Node 20/22
```

如果根 `engines.node` 提升，必须先更新矩阵与 packed smoke，不得只修改 metadata。

### 11.3 协议矩阵

必须覆盖：

```text
sequence gap
process_id change
schema-invalid event
event after terminal
phase overlap/order error
step index/count mismatch
check=false → final
check=true at budget → max_step
Final delta/content mismatch
Final empty/skipped
process.failed
pipe truncation/malformed JSONL
EOF before terminal
child exit nonzero after terminal
cancel during every active phase
multibyte UTF-8 split across chunks
1 MiB line boundary
```

### 11.4 产品闭环矩阵

```text
empty → Init → idle
idle → Planning → planned
planned → Play → awaiting-settle
awaiting-settle → Settle → idle
idle → Planning(day2)
idle → Revise → restart → idle
planned → Abandon → replan same day
awaiting-settle → Abandon → replan same day
all legal states expose at least one legal next action
invalid exposes diagnostics and no mutation capability
```

### 11.5 发布门禁

门禁按阶段收敛，避免 legacy package 的无关失败阻断前置正确性修复。

P0/P1 在当前包名下必须通过：

```text
npm ci
archive-protocol build/test
core build/guard/test
tui build/guard/test
published contract/docs check
examples architecture check
packed core/tui smoke
```

原子 cutover 完成后，发布候选必须通过：

```text
npm ci
npm run build
npm test
npm run docs:check
npm run examples:check
packed fresh-install smoke
legacy import acceptance
Profile V0 upgrade acceptance（仅 Gate 0 证明需要时）
TUI real-terminal smoke
clean git status after generated-output cleanup
```

CI green 必须对应待发布 commit；测试文件存在或本地单次通过不等价于发布证据。

---

## 12. 实施顺序与提交边界

### Gate 0 — 事实盘点

```text
检查 npm registry 版本/dist-tags
盘点仓库内外已知 consumer
盘点旧 core/core-old/cli/tui-old 的实际依赖
盘点是否存在真实 Profile V0 durable fixture
冻结旧实现删除条件和最终版本策略
```

出口：§9 和 §10 的条件项都有明确答案；不创建任何兼容框架。

### Phase A — 精确协议修复

```text
从 Check 推导 expectedStopReason
移除 derived TOML 的 max_step
CLI 使用唯一 REACT_MAX_STEPS
补 unit + real beta.5 + TUI regression
```

出口：已知对话失败不可复现。

### Phase B — Published contract 收口

```text
建立 WORLD_PROFILE_V1 / CORE_RUNTIME_V1
归档已被吸收的计划稿
修正当前行为文档，不提前切换包身份
启用迁移前 docs guard
```

出口：现行行为只有两份 published contract，不再由计划稿拼接。

### Phase C — 当前包名下发布级加固

```text
public type contract tests
typed redacted ReactProtocolError
dependency compatibility evidence
packed Core/TUI smoke
必要的 legacy import 加固
仅在 Gate 0 要求时实现 Profile V0 upgrade
```

出口：当前包名下已经具备可晋升证据。

### Phase D — 单一原子 cutover

```text
删除或移出旧 core/core-old/cli/tui-old 的产品 workspace 身份
core implementation → packages/core / @dayloom/core
同时切换 TUI、examples、workflows、lockfile、published docs
启用最终身份 guards
在同一个提交中恢复全仓 build/test green
```

出口：提交始终可构建，生产依赖图中不存在 `@dayloom/core` 或第二 Runtime。

### Phase E — Beta release

```text
按 Gate 0 选择合法版本
pack/install smoke
publish prerelease
validate installation outside monorepo
validate legacy import and any required Profile V0 upgrade
```

出口：beta 可安装、可启动、可迁移、可跑完整闭环。

### Phase F — Stable release

```text
close beta defects
freeze API/Profile V1 compatibility
publish 1.0.0
remove one-version aliases and legacy default build entries
```

出口：满足 §15 Definition of Done。

提交纪律：

- 协议 bug fix 不与 package rename 混在一个提交；
- package cutover 不与 World schema 变更混在一起；
- migration 行为变化必须独立提交并带 fixture；
- 删除 legacy 包前先证明默认依赖图无消费者；
- generated dist、tarball、临时 World 不提交；
- 不使用大规模格式化掩盖语义 diff。

---

## 13. 风险与控制

### 13.1 包名替换破坏外部调用方

控制：

- Gate 0 先核对 registry 和已知消费者；
- 在 beta release note 明确 breaking replacement；
- 提供 API mapping，不提供假兼容 facade；
- 在删除前搜索仓库与已知 consumer；
- 过渡期仅保留文档/安装提示，不维护双实现。

### 13.2 Promptpile beta 协议漂移

控制：

- exact pin；
- 随包 schema；
- real packed E2E；
- terminal matrix regression；
- 升级单独 PR/commit。

### 13.3 迁移损失 World 信息

控制：

- source read-only；
- per-file disposition；
- unknown UTF-8 preservation；
- explicit binary rejection；
- post-migration read-back；
- 用户验收前保留 source。

### 13.4 为追求“完整”重新引入旧框架

控制：

- public API allowlist；
- architecture guard；
- consumer-driven capability review；
- 没有第二实现不抽象 provider/backend；
- 没有真实需求不加入 scheduler/retry/recovery。

### 13.5 TUI 掩盖 Core 错误

控制：

- TUI 只依据 CoreResult/CoreState 跳转；
- terminal failure transcript 是 presentation-only；
- production Core PTY 覆盖真实错误码；
- TUI 可记录安全的 CoreResult 摘要，但不靠 message parsing 决定行为。

---

## 14. 回滚与恢复策略

### 14.1 P0/P1

P0/P1 不改变 World persisted shape。出现回归时可以回滚代码，但必须保留新生成 World 的 Archive V2/Profile V1 兼容读取能力。

### 14.2 Package cutover

cutover 前创建可追溯 tag/commit。回滚以 Git/package version 回滚，不通过运行时 backend selector 回滚。

### 14.3 Migration

迁移从不修改 source，因此恢复方式固定为：

```text
停止使用 target
保留失败 report/diagnostics
修复 migrator
选择新的空 target 重跑
```

不得在未知 partial target 上原地续跑或删除用户 source。

### 14.4 Publication

Runtime publication 继续遵守 `current.json` visibility theorem：

- pre-current 失败：现有 Published World 不变；
- post-current 失败：新 World 已成立，只能报告 diagnostic failure，不能伪回滚。

---

## 15. Definition of Done

只有全部满足，Core 完整化才算完成：

1. Reducer 从最后一个 Check 推导 `expectedStopReason`，合法 `max_step` Final 得到接受，错误的 stop-reason/Check 组合仍 fail-closed。
2. §11.3 列出的 Process Pile 等价类全部有明确测试，不要求无界组合穷举。
3. 单步 ReAct budget 只有一个 Core-owned 常量和一个 CLI transport；derived config 不再包含 `max_step`。
4. Archive V2 + World Profile V1 是唯一现行 persisted contract。
5. 空 World 到 day2 planned、Revise、两种 Abandon/replan、restart 全绿。
6. legacy filesystem import 全绿；只有 Gate 0 证明存在真实 Profile V0 存档时，Profile V0 upgrade 才成为必需门禁。
7. 正式包为 `@dayloom/core`，版本不再是 `0.0.0`。
8. TUI、示例、CI、文档只依赖 `@dayloom/core` package root。
9. 生产依赖图不存在 `@dayloom/core`、旧 Core backend 或 compatibility facade。
10. 旧 Core 不再位于默认 build/test/publish 产品路径。
11. Runtime root exports 符合 allowlist，offline migration 只从 `@dayloom/core/migration` 和 CLI 暴露，TypeScript consumer fixture 通过。
12. public error/state/event 不泄漏 secret、prompt、正文或 private artifact。
13. Typed protocol error 足以区分 schema、sequence、phase、stop reason、Final evidence和 child exit，不引入 generic sink，也不携带过程正文。
14. Promptpile 依赖 exact pin 并有 packaged compatibility evidence。
15. Core/TUI packed fresh-install 在干净项目中通过。
16. Linux/Windows × Node 20/22 CI 对发布 commit 全绿。
17. 文档检查覆盖 `doc/**`、根 README、package/example README 和 published contracts；与 examples guard 一起阻止 Runtime 身份回退。
18. 活跃文档不再称正式 Runtime 为 Play-only MVP，也不再要求用户选择 Core/Core。
19. migration guide、API breaking-change guide、release notes 完整。
20. beta 外部安装验证完成，并按 Gate 0 确认的 semver 路径发布稳定 `@dayloom/core` 与兼容版本的 `@dayloom/tui`。
21. 没有为了完成本计划引入 command bus、双 backend、queue、scheduler、plugin framework 或自动 recovery。
22. 仓库中只有一个能够创建正式 Dayloom Runtime 的生产实现。

---

## 16. 最终架构

```text
                         Consumer
                    TUI / future CLI/Web
                            │
                    application semantics
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    @dayloom/core                        │
│                                                         │
│  CoreState / capabilities / CoreEvent                   │
│  Init / Planning / Play / Revise                        │
│  Settle / Abandon                                       │
│  Session / cancellation / dispose                       │
│  World Profile V1 validation and builders               │
│  Archive publication policy                             │
└──────────────┬──────────────────┬───────────────────────┘
               │                  │
               ▼                  ▼
     Promptpile ecosystem   @dayloom/archive-protocol
               │                  │
               └────────┬─────────┘
                        ▼
             Archive V2 / World Profile V1
```

最终原则：

```text
一个公开 Runtime 包
一个 application truth
一个 persisted World contract
一个 production TUI backend
一个版本化迁移入口
一套可安装、可验证、可发布的证据
```

> **完整化不是继续向 Core 堆功能，而是把已经形成闭环的实现修正确、说清楚、稳定下来，并让它成为 Dayloom 唯一正式 Core。**
