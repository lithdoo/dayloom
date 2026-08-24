# Dayloom TUI → Core 完整交互适配实现冻结

> Status: Implementation Freeze / 可直接实施  
> Date: 2026-08-14  
> Target package: `@dayloom/tui`  
> Backend target: `@dayloom/core`
> Core accepted baseline before Gate 0: `bc74d3fcf3205695ef3386cfeef539beeb996a59`
>
> Gate 0 accepted amendment: `64dc4c5521c320db79859b91c1c15f6fcbdab503`
>
> Gate 1 Core acceptance baseline: `64dc4c5521c320db79859b91c1c15f6fcbdab503`

本文档取代此前所有 Play-only、兼容层式或功能残缺的 TUI → Core 适配方案。

本次目标是：

> **在不复活旧 Runtime、不复制业务状态机、不让 Core 知道 TUI 的前提下，用 Core application semantics 完整、交互一致地驱动恢复后的 Dayloom TUI。**

实现者不得再决定 lifecycle、action mapping、message ownership、page transition、loading、failure presentation、selection、cancel race、CLI bootstrap、PTY seam、example wiring 或 CI build ordering 应如何工作。若真实依赖与本文冲突，必须先修改 Freeze，再修改实现。

---

## 1. Freeze 总体 theorem

实施严格分两道 Gate：

```text
Gate 0
Core consumer-neutral running interrupt cancel
→ Core freeze 同步
→ Core acceptance green
→ Core dedicated CI green
→ 产生新的 accepted Core SHA

Gate 1
TUI backend replacement
@dayloom/core → @dayloom/core
→ unit / PTY / examples / TUI CI green
```

Gate 0 未完成前，不得删除 TUI 的 `@dayloom/core` dependency，也不得在 TUI 中通过 kill child、queue、dispose/recreate Core 等方式模拟 running cancel。

除 §5 的窄 interrupt-cancel amendment 外，本适配不修改：

```text
Archive Protocol
Core World Profile
Core persisted phases
Core publication theorem
Promptpile / React / compression ownership
Init / Planning / Play / Revise submission contracts
Settle / Abandon semantics
```

---

## 2. 双域规范来源

### 2.1 Application truth

唯一来源：

```text
@dayloom/core public root contract
CORE_FUNCTIONAL_COMPLETION_DRAFT.md
```

它决定：

```text
World truth
Session truth
capabilities / legality
CoreResult
CoreEvent
publication result
cancel result
```

### 2.2 Interaction truth

唯一来源：

```text
恢复后的 packages/tui
packages/tui/DESIGN.md
doc/guide/TUI.md
packages/tui/test/*
```

它决定：

```text
Hub / Session 两页模型
status / help
HubSelect / Textarea
shortcuts
streaming message
loading
slash commands
input history
scroll / focus / resize
failure transcript
```

### 2.3 历史参考

`@dayloom/core` 只用于解释旧行为，不得决定新 API、DTO、event 或 state shape。

禁止恢复：

```text
RuntimeSnapshot
RuntimeEvent
RuntimeCommand
CommandAvailability
MessageStore
World transient phases
legacy SessionStatus
createDayloomRuntime()
SessionFactory
```

当 interaction truth 需要一个 Core 当前没有、但显然属于 consumer-neutral application semantic 的能力时，必须先补 Core。本文唯一这样的能力是 §5 的 running interrupt cancel。

---

## 3. Ownership theorem

```text
Core
  owns application legality
  owns World / Session lifecycle
  owns Promptpile Conversation
  owns React execution
  owns publication
  owns cancellation of active agent work
  owns terminal business result

TUI driver
  owns projection
  owns product vocabulary
  owns one current presentation transcript
  owns local status/help mode
  owns selection
  owns pending visual feedback
  owns recent-result presentation

ViewModel / Components
  own focus
  own input/history
  own scroll/stick-to-bottom
  own viewport/layout
```

禁止：

```text
TUI 自己实现 World state machine
TUI 自己实现 Session business state machine
TUI 自己推断 publication 是否成功
TUI queue Core business mutation
TUI kill Core child
TUI dispose + recreate Core 模拟 Session cancel
Core import TUI type
Fake DayloomRuntime compatibility facade
RuntimeBackend / OldCoreBackend / CoreBackend
packages/tui2
```

最终依赖方向唯一为：

```text
@dayloom/core
      ↓
TUI-owned projection driver
      ↓
ViewModel
      ↓
existing BindTTY components
```

---

## 4. 必须完整保留的用户能力

### 4.1 Hub

```text
init
daily
revise
play
settle
abandon-day
status
help
quit
```

### 4.2 Session

```text
自然语言多轮输入
AI Final streaming
显式 /submit
ready 时 /exit / /cancel
AI streaming/running 时高优先级 /exit / /cancel
partial output 保留
failure feedback
failure transcript 查看后显式返回 Hub
输入历史
滚动
焦点
resize
```

`submitting` 时恢复后的 TUI 本来就禁用输入，因此不要求 publication 中 interrupt cancel。

### 4.3 Lifecycle

```text
empty
→ Init Session
→ idle
→ Daily / Planning Session
→ planned
→ Play Session
→ awaiting-settle
→ Settle
→ idle
→ Daily next day
```

旁路：

```text
idle → Revise Session → idle
planned → abandon-day → idle
awaiting-settle → abandon-day → idle
```

---

## 5. Gate 0 — Core running interrupt-cancel amendment

这是 TUI migration 前唯一新增的 Core application semantic。

### 5.1 Public state

`CoreState` 不增加 TUI-specific 字段。

`capabilities.cancel`：

```text
ready Session      → true
running Session    → true
submitting Session → false
no Session         → false
disposed           → false
同一 running Session 已登记 interrupt intent → false
```

`send` / `submit` legality 不变：

```text
ready      → send=true / submit=true
running    → send=false / submit=false
submitting → send=false / submit=false
```

### 5.2 Error code

增加：

```ts
'CANCELLED'
```

唯一含义：

> 当前 in-flight Session operation 因一个已成功登记的 `cancel()` intent 被主动终止。

intentional cancel 不得被映射成 `AGENT_FAILED`、`CONVERSATION_FAILED` 或 `INTERNAL_ERROR`。

### 5.3 Cancel linearization theorem

**成功登记 interrupt-cancel intent 是 cancellation 的唯一 linearization point。**

定义：

```text
sessionStatus == running
且 cancel() 原子地确认：
  当前 Session id 与 active send 的 Session id 相同
  当前未存在该 Session 的 interrupt intent
→ 写入 cancelRequestedSessionId
→ 创建/安装该 Session 唯一 interruptCancelPromise
```

从这一点开始：

```text
同一 send 永远不得再返回 ok:true
即使 child 已经自然退出
即使 completion 已经算出结果但 send Promise 尚未 settle
即使 cancel 与 child completion 发生在同一 event-loop turn
```

一旦 linearization 成立，最终必须满足：

```text
send()   → CANCELLED
cancel() → owns terminal outcome
World    → unchanged
Session  → terminal
```

反之，如果 send 在 cancel intent 成功登记前已经恢复为 ready：

```text
cancel() 按 ready contract 执行
```

如果 Session 在登记前已经 terminal：

```text
cancel() → NOT_AVAILABLE
```

因此自然完成与 cancel 不允许“双赢”。

### 5.4 ready cancel

保持当前语义：

```text
ready
→ terminalize Session
→ World unchanged
→ await one complete workspace cleanup attempt
→ cleanup success: ok:true
→ cleanup failure: INTERNAL_ERROR
   但 Session 仍必须为 null
```

### 5.5 running cancel exact sequence

running cancel 是唯一允许绕过普通 `BUSY` admission 的 public path，并且只针对**当前同一个 running Session**。

顺序冻结：

```text
capture sessionId
→ establish §5.3 linearization point
→ state.changed: cancel capability false
→ suppress future public output.delta for this session
→ kill exact active child if present
→ any child subsequently started by the same send is killed immediately
→ wait existing send lifecycle to unwind
→ wait provider drain / child close owned by existing runtime
→ send settles CANCELLED
→ cancel owns one terminalize(session)
→ await one workspace cleanup attempt
→ World unchanged
→ cancel settles
```

已经在 linearization 之前公开的 delta 不回滚。

linearization 之后不得再公开该 Session 的新 delta。

### 5.6 Terminal ownership

running cancellation path 严格只有一个 Session terminal owner：

```text
cancel()
```

被中断的 `send()`：

```text
不得独立 terminalize
不得 delete Session workspace
不得恢复 Session ready
不得覆盖 cancel terminal result
```

它只负责让原 send execution 安全 unwind，并返回 `CANCELLED`。

### 5.7 Repeated cancel / join

同一 running Session 第一次 cancel 已 linearize、但尚未 settle 时：

```text
第二次及后续 cancel()
→ join 同一个 interruptCancelPromise
→ 不创建第二 intent
→ 不重复 terminalize
→ 返回同一个 terminal outcome
```

不建立 queue。

### 5.8 Interrupt state lifetime

Core 允许的新增 concrete state 只限：

```text
cancelRequestedSessionId: string | null
interruptCancelPromise: Promise<CoreResult> | null
```

它们必须满足：

```text
interruptCancelPromise 创建前二者均为空
intent 存活期间二者指向同一 Session terminal request
terminal outcome + workspace cleanup attempt 完成后
→ finally 清理二者
```

清理规则：

```text
if cancelRequestedSessionId == sessionId
  → cancelRequestedSessionId = null

if interruptCancelPromise == thisPromise
  → interruptCancelPromise = null
```

stale cancellation state 不得影响后续新 Session。

### 5.9 Child / provider interaction

现有 child ownership 保持不变：

```text
append-user
semantic-summary provider child
promptpile-react child
```

仍通过现有 active-child hooks 串行暴露。

规则：

```text
child start
→ 若当前 session 已有 cancel intent
   → 立即 kill
→ 否则成为 current active child
```

不新增 child registry。

semantic summary provider 继续由其现有 `drain()` 收尾；cancel 不绕过 compression lifecycle。

### 5.10 Dispose interaction

`dispose()` 继续满足强 theorem，并等待 pending interrupt cancellation：

```text
dispose settle
→ no child
→ no compression provider
→ no current operation
→ no interrupt-cancel continuation
→ cancelRequestedSessionId == null
→ interruptCancelPromise == null
→ no Session workspace access
→ runtimeRoot removed
```

不得通过 dispose 抢占或复制 cancel terminalization。

### 5.11 明确不是 concurrency framework

只允许：

```text
one send execution
+
one terminal cancel intent for that same Session
```

仍然禁止：

```text
two React executions
parallel World mutation
queue
scheduler
actor
cancellation manager
operation registry
```

### 5.12 Gate 0 acceptance

必须新增并通过：

```text
core-running-session-exposes-cancel-capability
core-running-cancel-linearizes-once
core-running-cancel-intent-wins-send-completion-race
core-running-cancel-kills-active-child
core-running-cancel-kills-child-started-after-intent
core-running-cancel-stops-future-output-delta
core-interrupted-send-returns-cancelled
core-interrupted-send-never-restores-ready
core-interrupted-send-does-not-terminalize-independently
core-running-cancel-leaves-world-unchanged
core-running-cancel-terminalizes-session-once
core-running-cancel-awaits-provider-drain
core-running-cancel-cleanup-failure-does-not-resurrect-session
core-repeated-running-cancel-joins-one-terminal-intent
core-interrupt-state-clears-after-terminal-outcome
core-new-session-is-not-affected-by-old-cancel-state
core-submitting-cancel-remains-unavailable
core-dispose-awaits-pending-interrupt-cancel
```

Gate 0 完成时必须同步：

```text
CORE_FUNCTIONAL_COMPLETION_DRAFT.md
packages/core README/public docs if relevant
packages/core tests
Core dedicated CI
```

并把本文件顶部的 Gate 1 baseline 更新为包含该 amendment 的新 accepted SHA。

---

## 6. Package / dependency 决策

Gate 1 继续直接修改：

```text
packages/tui
examples/dayloom-tui
相关 TUI docs / CI
```

目标依赖：

```text
@dayloom/tui
├── @dayloom/core
├── bindtty
└── @bindtty/*
```

删除：

```text
@dayloom/tui → @dayloom/core
```

Node baseline：

```json
{ "engines": { "node": ">=20" } }
```

默认不重写 `Header / MessageList / LoadingBar / HubSelect / TextInputArea / Footer`。

---

## 7. Product action mapping

| TUI action | Core call | Presentation |
|---|---|---|
| `init` | `startSession('init')` | Hub → Session |
| `daily` | `startSession('planning')` | Hub → Session |
| `revise` | `startSession('revise')` | Hub → Session |
| `play` | `startSession('play')` | Hub → Session |
| `settle` | `settle()` | Hub short request |
| `abandon-day` | `abandonDay()` | Hub short request |
| ordinary text | `send(text)` | Session |
| `/submit` | `submit()` | Session terminal |
| `/exit` / `/cancel` | `cancel()` | ready/running Session terminal |

`daily` 只属于 TUI product vocabulary；Core 不增加 `daily()` compatibility API。

---

## 8. Hub legality / selection

唯一 legality source：

```text
CoreState.capabilities
```

映射：

```text
startSessions contains init     → init
startSessions contains planning → daily
startSessions contains revise   → revise
startSessions contains play     → play
settle                           → settle
abandonDay                       → abandon-day
```

稳定顺序：

```text
init
daily
revise
play
settle
abandon-day
status
help
quit
```

快捷键：

```text
i init
d daily
r revise
p play
t settle
s status
? help
q quit
```

`abandon-day` 无单字符快捷键。

推荐只决定默认 selection：

```text
init available   → init
daily available  → daily
play available   → play
settle available → settle
otherwise        → status
```

selection：

```text
old selection 仍存在 → keep
否则 → recommended
否则 → actions[0]
```

不得通过 world phase 自己重建 legality。

---

## 9. Exact presentation types

```ts
export type TuiBusinessActionId =
  | 'init' | 'daily' | 'revise' | 'play' | 'settle' | 'abandon-day';

export type TuiLocalActionId = 'status' | 'help' | 'quit';
export type HubMode = 'status' | 'help';

interface TuiActionBase {
  label: string;
  summary: string;
  shortcut: string | null;
  recommended: boolean;
}

export type TuiHubAction =
  | (TuiActionBase & { id: TuiBusinessActionId; kind: 'business' })
  | (TuiActionBase & { id: TuiLocalActionId; kind: 'local' });

export interface TuiBusyState {
  actionId: TuiBusinessActionId;
  label: string;
}

export type TuiWorldView =
  | { status: 'uninitialized'; worldRoot: string }
  | { status: 'invalid'; worldRoot: string; error: string }
  | {
      status: 'published';
      worldRoot: string;
      worldId: string;
      title: string;
      revision: number;
      commitId: string;
      phase: 'idle' | 'planned' | 'awaiting-settle';
      day: string | null;
      lastSettledDay: string | null;
    };

export type TuiSessionPresentationStatus =
  | 'ready' | 'running' | 'submitting' | 'cancelling' | 'failed';

export interface TuiSessionPresentation {
  id: string;
  kind: 'init' | 'planning' | 'play' | 'revise';
  status: TuiSessionPresentationStatus;
  error: { code: string; message: string } | null;
}

export type TuiPage =
  | { kind: 'hub'; mode: HubMode; busy: TuiBusyState | null }
  | { kind: 'session'; sessionId: string; sessionKind: 'init' | 'planning' | 'play' | 'revise' };

export interface TuiSessionControls {
  input: boolean;
  submit: boolean;
  cancel: boolean;
  dismiss: boolean;
}

export interface TuiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error' | 'warn';
  text: string;
  status: 'streaming' | 'complete' | 'error';
}

export interface TuiRecentResult {
  kind: 'completed' | 'cancelled' | 'failed';
  label: string;
  detail: string | null;
}

export interface TuiDriverState {
  page: TuiPage;
  world: TuiWorldView;
  session: TuiSessionPresentation | null;
  sessionControls: TuiSessionControls;
  hubActions: readonly TuiHubAction[];
  selectedHubActionId: string | null;
  recent: TuiRecentResult | null;
  messages: readonly TuiMessage[];
}
```

Hub DTO 不保存 Core method/function，不创建 command object。

---

## 10. Exact driver-private request state

只允许：

```ts
interface PendingHubRequest {
  actionId: TuiBusinessActionId;
  frozenActions: readonly TuiHubAction[];
  frozenSelectedId: string | null;
}

interface ActiveSendRequest {
  sessionId: string;
  assistantMessageId: string | null;
  cancelRequested: boolean;
}

interface PendingSessionCancel {
  sessionId: string;
}
```

Driver 可以拥有：

```text
core
latestCoreState
resolvedWorldRoot
hubMode
selectedHubActionId
pendingHubRequest
activeSendRequest
pendingSessionCancel
recent
presentedSession
one current transcript
local message id counter
disposed / disposePromise
```

禁止：

```text
world phase authority
command availability authority
second Session lifecycle
publication result authority
operation queue
backend abstraction
request manager
```

---

## 11. World projection

```text
Core uninitialized → TuiWorldView.uninitialized
Core invalid       → TuiWorldView.invalid
Core published     → TuiWorldView.published
```

`worldRoot = path.resolve(options.worldRoot)`，不得从 Core 推断。

invalid World：

```text
Hub 可正常进入
显示 error
business actions = none
recommended = status
status/help/quit 可用
```

Malformed World 不是 TUI startup fatal error。

---

## 12. Hub pending theorem

Hub business request 开始前：

```text
capture PendingHubRequest
→ page.busy = action label
→ freeze current action topology + selected id
→ hide HubSelect
→ emit
→ invoke Core
```

operation 期间即使 capabilities 暂时全 false，也继续显示 frozen topology；它只防闪烁，不参与 legality。

Promise settle：

```text
finalState = core.getState()
latestCoreState = finalState
→ clear pendingHubRequest
→ recompute actions from final capabilities
```

---

## 13. Page / transcript ownership

TUI 永远只有：

```text
Hub
Session
```

同一时刻严格只有：

```text
0 or 1 presentedSession
0 or 1 transcript
```

### 13.1 startSession

只有 `startSession()` Promise success 后才切 Session：

```text
read final core.getState()
→ must contain expected kind Session
→ discard old presentation if any
→ create presentedSession
→ create empty transcript
→ append one local opening system message
→ Hub → Session
```

`state.changed` 在 Promise settle 前出现新 session id 时，只更新 `latestCoreState`，不得提前切页。

### 13.2 successful terminal

```text
submit success
cancel success
cancel failure but final Core Session == null
→ discard transcript
→ clear presentedSession
→ Hub(status)
```

### 13.3 failed terminal transcript

普通 send/submit failure 若最终：

```text
core.getState().session == null
```

则：

```text
presentedSession.status = failed
presentedSession.error = CoreResult.error
transcript preserved
normal input disabled
only local /exit / /cancel dismiss
```

failed dismiss：

```text
never call core.cancel()
keep recent=failed
→ discard transcript
→ clear presentedSession
→ Hub(status)
```

### 13.4 Intentional interaction-semantic correction

恢复后的旧 Runtime TUI 在 failed Session 中执行 `/exit` 后，曾把 Hub recent 展示为“会话已取消”。这不再是新 contract。

新语义有意修正为：

```text
application terminal result = failure
→ failure truth cannot be rewritten as cancellation by presentation dismissal
```

因此：

```text
failed transcript + /exit|/cancel
→ dismiss presentation only
→ Hub recent remains failed
```

这里保持的是用户仍可查看 failure transcript、显式返回 Hub 的交互；修正的是旧 Runtime 对 terminal result 的错误分类。该差异不是功能回归，也不得为了字面兼容复活 fake cancel。

### 13.5 Transcript final release

以下路径都必须 discard 当前 transcript：

```text
submit success
cancel terminal
failed dismiss
new Session install
driver dispose
```

TUI 不保存历史 Session transcript database。

---

## 14. Opening guidance

每个新 Session 安装后追加一条 `system / complete` 本地消息：

```text
init     → 你想从什么样的世界开始？
planning → 今天想怎么展开？可以先说你希望发生什么。
play     → 行动会话已开始。你想先做什么？
revise   → 你想修订哪些 World 设定？
```

这些消息：

```text
presentation only
不调用 core.send()
不进入 Promptpile Conversation
不进入 semantic summary
不参与 submit
```

---

## 15. CoreEvent / Promise temporal authority

**CoreEvent 只同步事实；调用 Core API 的 Promise/CoreResult 负责 presentation boundary transition。**

### 15.1 `state.changed`

始终：

```text
latestCoreState = event.state
```

当前已有同 id presentedSession 且没有 local `cancelling` override 时：

```text
Core ready      → presentation ready
Core running    → presentation running
Core submitting → presentation submitting
```

event Session 变 null：

```text
do not switch page
wait request Promise reducer
```

出现尚未由 TUI 安装的新 Session id：

```text
update latestCoreState only
```

### 15.2 Core call settle

每个 reducer 第一行必须是：

```text
finalState = core.getState()
latestCoreState = finalState
```

不得只根据 error code 推断 final Session/World。

### 15.3 stale completion guard

每个 Session async request 都携带发起时 `sessionId`。

settle 时若：

```text
presentedSession == null
or presentedSession.id != request.sessionId
```

不得修改 transcript/page/recent，只可 diagnostic。

---

## 16. User text / streaming

### 16.1 ordinary text

仅当 `sessionControls.input == true`：

```text
trim
→ non-empty
→ append user / complete locally
→ install ActiveSendRequest
→ core.send(trimmed)
```

### 16.2 delta

只接受：

```text
activeSendRequest != null
&& event.sessionId == activeSendRequest.sessionId
&& presentedSession.id == same sessionId
&& activeSendRequest.cancelRequested == false
```

首个 delta：创建一个 `assistant / streaming` message。

后续 delta：append 到同一条 message。

stale/mismatched delta：ignore + diagnostic。

### 16.3 send success

```text
read final CoreState
→ same Session ready
→ assistant streaming → complete
→ activeSendRequest = null
→ presentation ready
```

### 16.4 ordinary send failure

若不是 user interrupt cancel：

```text
preserve user message
preserve partial assistant
streaming assistant → error
append error / complete
read final CoreState
```

final same Session active：stay Session。

final Session null：enter failed presentation；recent = failed。

### 16.5 running cancel request

用户在 running 输入 `/exit` 或 `/cancel`：

```text
activeSendRequest.cancelRequested = true
pendingSessionCancel = { sessionId }
presentedSession.status = cancelling
emit
→ core.cancel()
```

被 interrupt 的 send 返回 `CANCELLED`：

```text
if same request && cancelRequested == true
→ do not enter failed view
→ do not overwrite recent
→ do not change page
→ clear only send-side completion ownership when safe
```

最终 page/recent 只由 cancel reducer 决定。

### 16.6 cancel failure recovery theorem

这是 running cancel 的必要反向闭包。

如果 `core.cancel()` failure 后：

```text
finalState.session != null
&& finalState.session.id == pendingSessionCancel.sessionId
```

则 cancel **没有 terminalize 该 Session**。TUI 必须完整撤销 local cancellation suppression：

```text
pendingSessionCancel = null
activeSendRequest.cancelRequested = false   // 若该 send 仍是当前 request
presentedSession.status = final Core session status
append local error / complete
emit
```

之后：

```text
future output.delta for that still-active send must be accepted again
send completion reducer regains normal ownership
```

不得因为一次失败的 cancel intent，让 UI 永久吞掉后续 delta 或停留 `cancelling`。

如果 cancel failure 后 final Session null：

```text
terminal intent already took effect despite diagnostic failure
→ clear pendingSessionCancel
→ clear activeSendRequest
→ discard transcript
→ Hub(status)
→ recent failed / cancel error
```

---

## 17. Transcript resource policy

```text
MAX_MESSAGES = 500
MAX_TEXT_CHARS = 250_000
```

超限：

```text
从最旧 complete/error whole message 淘汰
不拆 message
当前 streaming message 永不淘汰/截断
最新一条 message 即使自身超过 char cap 也完整保留
```

---

## 18. Session controls / Textarea

### ready

```text
input   = capabilities.send
submit  = capabilities.submit
cancel  = capabilities.cancel
dismiss = false
```

Textarea enabled。

### running

Gate 0 后：

```text
input=false
submit=false
cancel=true
dismiss=false
```

Textarea enabled，但只接受高优先级 cancel slash。

普通文本或 `/submit`：local warn，不调用 Core。

### cancelling

```text
input=false
submit=false
cancel=false
dismiss=false
```

Textarea disabled；loading=`正在取消会话...`。

### submitting

全部 false；Textarea disabled。

### failed

```text
input=false
submit=false
cancel=false
dismiss=true
```

Textarea enabled，仅用于 local `/exit` / `/cancel`。

ViewModel：

```text
inputEnabled        = sessionControls.input
inputControlEnabled = input || submit || cancel || dismiss
```

---

## 19. Slash contract

slash token case-insensitive；参数不解析。

### ready

```text
/submit       → core.submit()
/exit         → core.cancel()
/cancel       → core.cancel()
/status       → local system message
/help         → local system message
/next         → local warn
/revise       → local warn
unknown /...  → local warn
```

### running

```text
/exit /cancel → core.cancel()
other input   → local warn only
```

### submitting

Textarea disabled。

### failed presentation

```text
/exit /cancel → local dismiss only
other input   → local warn
```

unknown slash 永远不进入 `core.send()`。

---

## 20. Result / recent reducer

每个 reducer 先读取 final `core.getState()`。

### startSession

```text
success → install expected Session presentation; recent unchanged
failure → stay Hub; recent failed
```

### send

```text
success → §16.3
ordinary failure → §16.4
CANCELLED + cancelRequested → §16.5; no failed recent
```

### submit

```text
success + final Session null
→ discard transcript
→ Hub(status)
→ recent completed / 会话已提交

failure + final same Session active
→ append error
→ stay Session
→ recent failed

failure + final Session null
→ failed presentation
→ recent failed / 会话提交失败
```

### cancel

success：

```text
pendingSessionCancel = null
activeSendRequest = null
final Session must be null
→ discard transcript
→ Hub(status)
→ recent cancelled / 会话已取消
```

failure + final Session null：

```text
pendingSessionCancel = null
activeSendRequest = null
→ discard transcript
→ Hub(status)
→ recent failed
→ detail = Core error
```

failure + final same Session active：

```text
pendingSessionCancel = null
if activeSendRequest belongs to same Session:
  activeSendRequest.cancelRequested = false
→ presentation status = final Core status
→ append local error
→ stay Session
→ future delta resumes
```

### settle / abandonDay

```text
success → recent completed
failure → recent failed
```

### WORLD_CONFLICT

必须展示 Core one-shot refresh 后的 final World；不得保留 stale projection。

---

## 21. Loading

Hub：

```text
init        → 正在启动初始化会话...
daily       → 正在启动计划会话...
revise      → 正在启动修订会话...
play        → 正在启动行动会话...
settle      → 正在结算当日...
abandon-day → 正在放弃当日...
```

Session：

```text
ready       → null
running     → AI 正在回复...
cancelling  → 正在取消会话...
submitting  → 正在提交会话...
failed      → null
```

禁止第二套 Session loading FSM。

---

## 22. Status / help / terminology

Status 展示：

```text
World root
World status
published: title / revision / phase / day / lastSettledDay
invalid: error
recent
available business actions
```

Help 展示：

```text
Hub Enter / Up / Down
visible shortcuts
Session ordinary text
/submit
/exit / /cancel
/status / /help / /next / /revise
running 时 /exit 可中断 AI 回复
submitting 时输入禁用
```

World terminology：

```text
uninitialized   → 未初始化
invalid         → 异常
idle            → 空闲
planned         → 已计划
awaiting-settle → 待结算
```

禁止重新制造 World phase：

```text
initializing
planning
playing
revising
```

Session label：

```text
init/planning/play/revise → 初始化/计划/行动/修订
ready/running/cancelling/submitting/failed → 等待输入/AI 回复中/取消中/提交中/会话失败
```

---

## 23. ViewModel / Components

保持：

```text
Hub / Session 两页
input history 100
Ctrl+P / Ctrl+N
draft restore
Textarea minRows=1 / maxRows=4
page change scroll reset
stick-to-bottom
manual scroll preservation
resize
HubSelect / Textarea autofocus
Ctrl+C global exit
```

`ViewModel` 只消费 `TuiDriverState`；components 不读取 Core。

如果 component 需要 Core business-specific branch，优先视为 projection 设计错误。

---

## 24. Driver public seam

```ts
export interface TuiRuntimeDriver {
  getState(): TuiDriverState;
  subscribe(listener: (state: TuiDriverState) => void): () => void;
  runHubAction(actionId: string): Promise<'continue' | 'exit'>;
  submitSessionText(text: string): Promise<void>;
  setHubMode(mode: HubMode): void;
  selectHubAction(actionId: string): void;
  dispose(): Promise<void>;
}

export interface CreateRuntimeDriverOptions {
  worldRoot: string;
  llmConfigPath: string;
  diagnostic?: DiagnosticLogger;
}
```

生产创建唯一：

```ts
createDayloomCore({
  worldRoot: path.resolve(options.worldRoot),
  llmConfigPath: path.resolve(options.llmConfigPath),
});
```

删除：

```text
runtime?: DayloomRuntime
sessionFactory?: SessionFactory
```

---

## 25. Test-only Core seam

只允许 concrete seam：

```ts
createRuntimeDriverFromCoreForTest({
  worldRoot,
  core, // exact DayloomCore public interface
  diagnostic,
})
```

要求：

```text
non-package-root internal module
不从 packages/tui/src/index.ts 导出
不进入 package exports
production main 永远不用
```

禁止泛化成 RuntimeBackend/CoreProvider/BackendAdapter。

---

## 26. PTY 验证分层

### 26.1 Production PTY smoke

真实：

```text
packages/tui/dist/main.js
→ createDayloomCore()
→ packaged Promptpile boundaries
```

使用合法 caller TOML，但不触发 LLM，仅验证：

```text
startup
empty Hub
status/help
resize
quit
shutdown
```

production CLI 不允许读取 fake backend / `PROMPTPILE_BIN` override。

### 26.2 Scripted interaction PTY

使用 test-only entrypoint，例如：

```text
packages/tui/test/support/pty-entry.mjs
```

必须复用 production：

```text
mountApp
createViewModel
same driver projection
same components
```

唯一差异是通过 §25 注入 deterministic `ScriptedDayloomCore`。

Scripted Core 只实现 public `DayloomCore` contract，不模拟 Archive/Promptpile/React/publication internals。

### 26.3 Core headless truth

真实 Core lifecycle / publication / Promptpile / running cancel correctness 由 Core acceptance 自己证明。

最终证据组合：

```text
real Core application truth
+
real terminal interaction against scripted public contract
+
production CLI → real Core startup smoke
=
TUI → Core integration acceptance
```

---

## 27. CLI exact contract

```text
dayloom-tui [worldRoot] --llm-config <path>
dayloom-tui --llm-config <path> [worldRoot]
```

规则：

```text
0/1 positional worldRoot
0/1 --llm-config <path>
-h / --help
unknown option → error
second positional → error
duplicate --llm-config → error
missing option value → error
```

precedence：

```text
CLI non-empty --llm-config
→ non-empty DAYLOOM_LLM_CONFIG
→ startup error + usage
```

`--help` 不需要 config，不创建 Core。

relative paths 均基于 cwd resolve。

TUI 不解析 provider config、不注入 `[promptpile-react]`、不拥有 Promptpile topology。

Core initialization failure：stderr + exitCode 1，mount 前退出。

---

## 28. Official example closure

`examples/dayloom-tui/**` 属于 Gate 1 必改范围。

最终唯一路径：

```text
empty world/
+
caller llm.toml
→ current Core
→ current TUI
→ real Init
```

删除：

```text
PROMPTPILE_BIN
old-core assumptions
prebuilt planned World
fake init publication
world2 legacy naming
```

推荐：

```text
llm.example.toml checked in
llm.toml ignored
world/ ignored
open-world.sh/.bat current launcher
```

launcher 不创建 Archive manifest/current/plan，只负责 build/check + 启动：

```text
node packages/tui/dist/main.js <world> --llm-config <llm.toml>
```

---

## 29. Build / CI ordering

clean checkout：

```text
npm ci
→ build @dayloom/archive-protocol
→ build/test @dayloom/core
→ build/test @dayloom/tui
```

TUI matrix 至少：

```text
Ubuntu  Node 20 / 22
Windows Node 20 / 22
```

每个 TUI job 在测试前必须先 build protocol + core。

至少一个 Ubuntu required PTY job：

```text
node-pty unavailable → FAIL
no silent skip
```

必须有：

```text
tui-esm-loads-core-public-root
```

证明 ESM TUI 可以通过 package root 消费当前 CommonJS Core。

legacy Core conformance 是否继续存在是独立事项，不是 TUI acceptance backend requirement。

---

## 30. Dispose / shutdown

```text
request exit
→ dispose mounted app
→ ViewModel unsubscribe
→ Driver unsubscribe Core
→ core.dispose()
→ process exit
```

Driver dispose idempotent。

开始 dispose：

```text
disposed=true
→ stop TUI emits
→ listeners clear
→ discard transcript
→ late async reducers become no-op
→ core.dispose()
```

Core owns child kill/provider drain/interrupt cancel/runtimeRoot cleanup。

---

## 31. Diagnostics / guards

允许记录：

```text
CoreEvent type
world status/revision/phase
session id/kind/status
capability booleans
TUI page
pending action id
message length
CoreResult code
```

禁止记录：

```text
full user text
full model output
semantic summary
LLM secret
```

Production source 禁止：

```text
@dayloom/core
@dayloom/core-old
@dayloom/core/src/
@dayloom/core/dist/
```

只允许 `@dayloom/core` root。

禁止新增：

```text
RuntimeBackend
CoreBackend
BackendProvider
CommandRegistry
EventNormalizer
SessionManager
OperationQueue
CancellationManager
```

---

## 32. 文件级实施边界

### Gate 0

```text
CORE_FUNCTIONAL_COMPLETION_DRAFT.md
TUI_CORE_ADAPTATION_DRAFT.md  // promote new Core accepted SHA after Gate 0
packages/core/src/state.ts
packages/core/src/errors.ts
packages/core/src/core.ts
packages/core/test/*
packages/core README/docs if public behavior is described
```

### Gate 1

```text
packages/tui/package.json
packages/tui/src/argv.ts
packages/tui/src/main.ts
packages/tui/src/types.ts
packages/tui/src/theme.ts
packages/tui/src/hub/actions.ts
packages/tui/src/hub/content.ts
packages/tui/src/message-history.ts
packages/tui/src/runtime-driver/create-runtime-driver.ts
packages/tui/src/runtime-driver/test-only seam if needed
packages/tui/src/view-model.ts
packages/tui/src/diagnostics.ts
packages/tui/test/*
packages/tui/README.md
packages/tui/DESIGN.md
doc/guide/TUI.md
doc/packages/TUI.md
examples/dayloom-tui/**
TUI-related CI
package-lock.json
```

默认不改 components/app；如果需要 business branch，先检查 projection 是否错误。

---

## 33. 实施顺序

```text
Step 0  Core cancel linearization + running interrupt implementation
Step 1  Core tests / freeze sync / CI / accepted SHA promotion
Step 2  TUI architecture guard / dependency / Node baseline
Step 3  exact presentation types
Step 4  Hub projection + pendingHubRequest
Step 5  Core production driver wiring
Step 6  Promise/Event temporal reducer
Step 7  transcript / streaming / failed presentation
Step 8  running cancel + cancel-failure recovery UI
Step 9  ViewModel projection; preserve history/scroll/focus
Step 10 CLI + caller config
Step 11 test-only DayloomCore seam + scripted PTY
Step 12 official example cleanup
Step 13 docs/theme/diagnostics
Step 14 unit + required PTY
Step 15 TUI CI matrix
Step 16 full acceptance gate
```

禁止 migration 与大规模 component refactor 同阶段进行。

---

## 34. Unit acceptance

必须至少覆盖：

```text
tui-uninitialized-projects-init
tui-idle-projects-daily-and-revise
tui-planned-projects-play-and-abandon
tui-awaiting-settle-projects-settle-and-abandon
tui-invalid-projects-no-business-action

tui-daily-maps-to-startSession-planning
tui-all-six-business-actions-map-exactly-once
tui-business-action-dto-has-no-core-function

tui-selection-persists-while-visible
tui-pending-hub-request-freezes-action-topology
tui-pending-hub-request-reconciles-final-core-state

tui-start-session-does-not-switch-page-before-result
tui-start-session-success-installs-one-transcript
tui-opening-message-is-local-and-kind-specific

tui-user-text-appears-before-send-result
tui-output-delta-aggregates-one-assistant-message
tui-partial-output-survives-send-failure
tui-stale-delta-is-ignored
tui-old-request-cannot-mutate-new-session

tui-send-failure-terminal-keeps-failed-presentation
tui-submit-failure-terminal-keeps-failed-presentation
tui-nonterminal-failure-keeps-active-session-if-core-does
tui-failed-dismiss-does-not-call-core-cancel
tui-failed-dismiss-preserves-failed-recent
tui-failed-dismiss-is-intentional-result-classification-correction
tui-terminal-path-discards-transcript

tui-ready-enables-normal-input-submit-cancel
tui-running-enables-only-high-priority-cancel
tui-running-normal-text-is-local-warning
tui-running-submit-is-local-warning
tui-running-exit-calls-core-cancel
tui-running-cancel-shows-cancelling
tui-interrupted-send-cancelled-result-does-not-create-failure-view
tui-cancel-result-owns-final-page-transition
tui-running-cancel-failure-restores-session-status
tui-running-cancel-failure-clears-local-cancel-suppression
tui-running-cancel-failure-resumes-delta-rendering
tui-submitting-disables-textarea

tui-status-help-next-revise-remain-local
tui-unknown-slash-never-reaches-core-send

tui-world-conflict-renders-refreshed-world
tui-cancel-cleanup-error-does-not-resurrect-session

tui-transcript-evicts-oldest-whole-messages
tui-transcript-never-truncates-current-stream
tui-input-history-preserves-draft
tui-page-transition-resets-scroll
tui-manual-scroll-preserves-stick-choice
tui-autofocus-hub-session-hub

tui-dispose-idempotent
tui-dispose-discards-transcript
tui-dispose-prevents-late-async-presentation-write

tui-cli-option-order-is-stable
tui-cli-config-flag-beats-env
tui-cli-help-needs-no-llm-config
tui-esm-loads-core-public-root
```

---

## 35. Required PTY acceptance

### Production smoke

```text
real dist/main.js
+ empty World
+ valid caller TOML
→ 未初始化 Hub
→ Init recommended
→ help/status
→ resize
→ quit
→ clean exit
```

不触发 LLM。

### Scripted interaction PTY

```text
Init → opening → text → streaming → ready
running → /exit → cancelling → Hub cancelled
running cancel rejected/nonterminal → Session resumes + later delta visible
Init submit → idle
Daily → planning → submit → planned
Play → multi-turn → submit → awaiting-settle
Settle → Hub loading → idle
Revise → submit → idle
planned abandon → idle
awaiting-settle abandon → idle
partial AI failure → failed transcript → /exit dismiss → Hub still reports failure
invalid submit → failed transcript → /cancel dismiss → Hub still reports failure
history / draft
manual scroll / stick-to-bottom
autofocus
resize
Ctrl+C shutdown
```

PTY harness 禁止 import old Core。

---

## 36. Composed lifecycle acceptance

TUI-visible scripted lifecycle：

```text
empty
→ Init
→ natural language
→ submit
→ idle
→ Daily
→ submit
→ planned day1
→ Play
→ multi-turn
→ submit
→ awaiting-settle day1
→ Settle
→ idle / lastSettledDay=day1
→ Revise
→ submit
→ idle
→ Daily
→ submit
→ planned day2
```

同时 real Core headless suite 必须证明相同 application lifecycle + Gate 0 cancellation theorem。

acceptance 不依赖外部 LLM availability。

---

## 37. Official example acceptance

```text
open-world.sh syntax green
open-world.bat contract checked
launcher 不引用 PROMPTPILE_BIN
launcher 不创建 fake planned World
launcher 传 --llm-config
llm.example.toml 是 caller config
empty world 由 Core 表达 uninitialized
README 与实际 command 一致
```

---

## 38. Definition of Done

全部满足才算完成：

1. Gate 0 已同步回 Core Freeze。
2. TUI 文件顶部 baseline 已更新为包含 Gate 0 的 accepted Core SHA。
3. Core cancel 在 ready/running 可用，在 submitting 不可用。
4. running cancel 有唯一 linearization point。
5. linearization 后同一 send 不可能再成功。
6. interrupted send 返回 `CANCELLED`。
7. cancel intent 后没有新公开 delta。
8. running cancel 只有 cancel 一个 terminal owner。
9. repeated cancel join 同一个 terminal intent。
10. interrupt state terminal 后 finally 清零。
11. stale interrupt state 不影响新 Session。
12. Gate 0 不引入 queue/scheduler/manager。
13. Core Gate 0 acceptance 与 CI green。
14. TUI 不再依赖 `@dayloom/core`。
15. TUI 只消费 Core public root。
16. Hub 六个 business actions 完整。
17. legality 只来自 Core capabilities。
18. `daily` 只在 TUI vocabulary 映射 planning。
19. uninitialized/invalid/published 都有 Hub presentation。
20. TUI 不复制 World 或 Core Session business FSM。
21. 只有 Hub/Session 两页。
22. action order/shortcut/recommended selection 保持。
23. pending Hub 不造成 topology flicker。
24. 四种 Session 使用同一 UI。
25. 同一时间只有一个 current transcript。
26. opening guidance 不进入 Conversation。
27. user text 只调用一次 `core.send()`。
28. delta 聚合到一条 assistant message。
29. partial output failure 时保留。
30. terminal failure 只保留 presentation failed view，不伪造 Core Session。
31. failed dismiss 不调用 Core cancel。
32. failed dismiss 保留 failure recent；这是明确的语义修正。
33. ready 普通输入/submit/cancel 与 capability 一致。
34. running 保留高优先级 `/exit`/`/cancel`。
35. running 普通文本与 `/submit` 不进入 Core。
36. interrupted send late result 不可复活 failed page。
37. cancel failure + Session active 会清 local suppression 并恢复 delta。
38. submitting 输入 disabled。
39. slash interception 保持。
40. settle/abandon 使用 Hub short loading。
41. 每个 CoreResult settle 后以 final `core.getState()` reconcile。
42. WORLD_CONFLICT 展示 refreshed truth。
43. stale async completion 不污染新 Session。
44. terminal/new/dispose 释放 transcript。
45. transcript policy 不截断 current streaming message。
46. history/draft/resize/scroll/stick-to-bottom 保持。
47. Hub/Session autofocus 保持。
48. Ctrl+C 完整 shutdown/dispose。
49. production driver 无 backend abstraction。
50. test seam 只接受 exact DayloomCore，且不进入 production exports。
51. production CLI 不读取 fake backend/PROMPTPILE_BIN override。
52. CLI exact grammar/config precedence 测试通过。
53. official example 使用 empty World + caller TOML + real Init。
54. example 无 fake Archive publication。
55. clean CI ordering 为 protocol → core → tui。
56. TUI Ubuntu/Windows Node20/22 build/unit green。
57. required Ubuntu PTY 不 silent skip。
58. production Core startup PTY smoke green。
59. scripted interaction PTY matrix green。
60. composed lifecycle 到 day2 planned green。
61. architecture guard 阻止 old/deep imports。
62. diagnostics 不记录 secret/full conversation。
63. 除 Gate 0 外不修改 Core application/persistence semantics。
64. implementation 没有新增 queue/manager/backend/cancellation framework。

---

## 39. 最终架构 theorem

```text
                           User
                             │
                   restored TUI interaction
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                      @dayloom/tui                            │
│                                                              │
│ Hub / Session                                                │
│ product vocabulary / shortcuts                               │
│ one presentation transcript                                  │
│ streaming projection / failed transcript                     │
│ pending visual feedback / selection / recent                 │
│ input / history / scroll / focus                             │
│                                                              │
│              no business lifecycle authority                 │
└────────────────────────────┬─────────────────────────────────┘
                             │
                     application semantics
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                      @dayloom/core                           │
│                                                              │
│ World truth / capabilities                                   │
│ init / planning / play / revise Sessions                     │
│ send / submit / ready+running cancel                          │
│ cancellation linearization / terminal ownership              │
│ settle / abandonDay                                          │
│ publication / Promptpile / React / compression               │
│                                                              │
│                 single application authority                 │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
                      Published Archive V2
```

最终原则：

```text
完整产品能力不能通过删 TUI 来迁就 Core。
Core 没有但属于 application semantic 的能力，先在 Core 补齐。
TUI 不伪造 Core lifecycle。

application fact     → Core
presentation need    → TUI
running interrupt    → Core cancel
cancel linearization → Core
failed transcript    → TUI presentation only
Hub loading          → TUI presentation only
World/Session legality → Core only
```

**这就是可直接实施的 TUI → Core 完整交互适配边界。**
