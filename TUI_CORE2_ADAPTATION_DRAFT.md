# Dayloom TUI → Core2 完整能力适配实现冻结

> Status: Implementation Freeze / 可直接实施  
> Date: 2026-08-14  
> Target package: `@dayloom/tui`  
> Backend target: `@dayloom/core2`  
> Core2 acceptance baseline: `bc74d3fcf3205695ef3386cfeef539beeb996a59`

本文档**取代此前 Play-only 的 TUI → Core2 适配冻结**。

此前版本把“Core2 不兼容旧 Runtime API”错误地扩大成了“允许减少 TUI 产品能力”，导致完整 TUI 被压缩成只有 Play 的产品。当前 Core2 已经拥有完整 Dayloom application lifecycle，因此本次适配的目标不再是“让 TUI 能调用 Core2”，而是：

> **在不复活旧 Runtime、不复制业务状态机、不让 Core2 知道 TUI 的前提下，用 Core2 完整 application semantics 无损驱动恢复后的完整 TUI 产品交互。**

实施者不得再决定 lifecycle、action mapping、message ownership、page transition、loading、failure presentation、selection、CLI bootstrap 或 test seam 应该如何工作。若实际 Core2 public contract 与本文冲突，必须先修改本文，再修改实现。

---

## 1. 规范来源

本适配按以下优先级冻结：

```text
1. @dayloom/core2 public application contract
   → World truth
   → Session truth
   → capabilities / legality
   → CoreResult
   → CoreEvent

2. 当前恢复后的 @dayloom/tui 用户可观察交互
   → Hub / Session 两页模型
   → status / help
   → HubSelect
   → Textarea
   → shortcuts
   → streaming message
   → loading
   → input history
   → scroll / focus / resize

3. packages/tui/DESIGN.md
   doc/guide/TUI.md
   packages/tui/test/*
   → 交互细节与 PTY acceptance

4. @dayloom/core
   → historical behavior reference only
```

旧 Core 的以下内容**不是规范来源**：

```text
RuntimeSnapshot
RuntimeEvent
RuntimeCommand
CommandAvailability
MessageStore
WorldPhase transient states
SessionStatus legacy states
createDayloomRuntime()
SessionFactory
```

TUI 不要求 Core2 模拟这些 shape。

---

## 2. 最终 ownership theorem

```text
Core2
  owns application legality
  owns World / Session lifecycle
  owns Promptpile Conversation
  owns React execution
  owns publication
  owns terminal business result

TUI driver
  owns projection
  owns product action vocabulary
  owns presentation transcript
  owns local status/help mode
  owns selection
  owns pending visual feedback
  owns recent result presentation

ViewModel / Components
  own focus / input / history / scroll / layout
```

禁止：

```text
TUI 自己实现 World state machine
TUI 自己推断 publication 是否成功
TUI queue Core2 mutation
TUI kill Core2 child
TUI 重建 Core 模拟 Session cancel
Core2 import TUI type
Fake DayloomRuntime compatibility facade
RuntimeBackend / OldCoreBackend / Core2Backend
packages/tui2
```

正确依赖方向唯一为：

```text
@dayloom/core2
      ↓
TUI-owned projection driver
      ↓
ViewModel
      ↓
existing BindTTY components
```

---

## 3. Package 决策

继续直接修改：

```text
packages/tui
```

依赖变为：

```text
@dayloom/tui
├── @dayloom/core2
├── bindtty
└── @bindtty/*
```

删除：

```text
@dayloom/tui → @dayloom/core
```

`@dayloom/tui` Node baseline 跟随 Core2：

```json
{
  "engines": { "node": ">=20" }
}
```

components 默认不重写。`Header / MessageList / LoadingBar / HubSelect / TextInputArea / Footer` 保持现有结构。

---

## 4. 必须完整保留的产品能力

完整 Hub business capability：

```text
init
 daily
 revise
 play
 settle
 abandon-day
```

完整 Session capability：

```text
自然语言多轮输入
AI Final streaming
显式 /submit
显式 /exit / /cancel
partial output 保留
failure feedback
输入历史
滚动
焦点
resize
```

完整主生命周期：

```text
empty World
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

任何一个以上入口因 Core2 migration 消失，都视为适配失败。

---

## 5. Core2 → TUI product action mapping

TUI 继续使用用户已经熟悉的产品词汇；Core2 保持 consumer-neutral API。

| TUI action | Core2 call | 页面形式 |
|---|---|---|
| `init` | `startSession('init')` | 进入 Session |
| `daily` | `startSession('planning')` | 进入 Session |
| `revise` | `startSession('revise')` | 进入 Session |
| `play` | `startSession('play')` | 进入 Session |
| `settle` | `settle()` | Hub 短流程 |
| `abandon-day` | `abandonDay()` | Hub 短流程 |
| 普通文本 | `send(text)` | Session |
| `/submit` | `submit()` | Session terminal |
| `/exit` / `/cancel` | `cancel()` | active ready Session terminal |

`daily` 是 TUI product vocabulary；`planning` 是 Core2 Session semantic。Core2 不增加 `daily()` compatibility API。

---

## 6. Hub action legality

**唯一 legality source 是 `CoreState.capabilities`。**

映射：

```text
capabilities.startSessions contains 'init'
→ init

contains 'planning'
→ daily

contains 'revise'
→ revise

contains 'play'
→ play

capabilities.settle
→ settle

capabilities.abandonDay
→ abandon-day
```

TUI 不得仅通过 `world.phase` 自己决定 action 是否可执行。

稳定展示顺序：

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

local actions 始终由 TUI 拥有：

```text
status
help
quit
```

快捷键保持：

```text
i → init
d → daily
r → revise
p → play
t → settle
s → status
? → help
q → quit
```

`abandon-day` 继续无单字符快捷键。

---

## 7. Recommended action / selection invariant

推荐 action 不承担 legality，只承担默认 selection。

优先级冻结：

```text
init 可用   → init
daily 可用  → daily
play 可用   → play
settle 可用 → settle
否则        → status
```

因此 idle 同时可用 `daily + revise` 时，推荐 `daily`。

selection invariant：

```text
selectedHubActionId 仍存在于 hubActions
→ 保留

否则
→ recommended action
→ 若无 recommended，则 actions[0]
```

业务 mutation 期间不得因为 Core2 暂时把 capabilities 全部关闭而让 HubSelect 闪烁、跳到 Status。

因此 driver 允许拥有一个纯 presentation 的：

```text
pendingHubRequest
```

当 pending 非空时：

```text
保留 mutation 开始前的 Hub action list + selection
禁止再次执行 Hub business action
继续接收 latestCoreState
待 operation settle 后再按 final CoreState 重算 Hub actions
```

这不是 legality cache；它只用于避免 UI topology 在一次用户请求中闪烁。

---

## 8. TUI presentation state

TUI 不再暴露 legacy `RuntimeSnapshot` / `CommandAvailability[]`。

冻结本地类型：

```ts
export type HubMode = 'status' | 'help';

export type TuiWorldView =
  | {
      status: 'uninitialized';
      worldRoot: string;
    }
  | {
      status: 'invalid';
      worldRoot: string;
      error: string;
    }
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
  | 'ready'
  | 'running'
  | 'submitting'
  | 'failed';

export interface TuiSessionPresentation {
  id: string;
  kind: 'init' | 'planning' | 'play' | 'revise';
  status: TuiSessionPresentationStatus;
  error: { code: string; message: string } | null;
}

export type TuiPage =
  | {
      kind: 'hub';
      mode: HubMode;
      busy: TuiBusyState | null;
    }
  | {
      kind: 'session';
      sessionId: string;
      sessionKind: 'init' | 'planning' | 'play' | 'revise';
    };

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
  status?: 'streaming' | 'complete' | 'error';
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
  hubActions: TuiHubAction[];
  selectedHubActionId: string | null;
  recent: TuiRecentResult | null;
  messages: TuiMessage[];
}
```

这些类型是 presentation contract，不是 Core2 type alias。

---

## 9. Driver 内部允许拥有的 authority

唯一允许：

```text
core
latestCoreState
resolvedWorldRoot
hubMode
selectedHubActionId
pendingHubRequest
recent
presentedSession
当前 presentedSession transcript
当前 send 的 streamingAssistantMessageId
local message id counter
disposed / disposePromise
```

禁止额外维护：

```text
world phase authority
command availability authority
session business state machine
publication result authority
operation queue
backend abstraction
```

`presentedSession` 是 UI 页面/transcript ownership，不是第二个 Core Session。

---

## 10. World projection

```text
CoreState.world.status == uninitialized
→ TuiWorldView.uninitialized

invalid
→ TuiWorldView.invalid

published
→ TuiWorldView.published
```

`worldRoot` 始终来自：

```ts
path.resolve(options.worldRoot)
```

不得从 Core2 推断。

invalid World：

```text
Hub 正常启动
显示 error
只展示 local actions
recommended = status
不允许任何 business action
```

Malformed World 不作为 TUI startup fatal error；Core2 已将其表达为 application state。

---

## 11. Page ownership

TUI 保持只有：

```text
Hub
Session
```

不增加：

```text
InitPage
PlanningPage
PlayPage
RevisePage
ErrorPage
```

正常 active Session：

```text
CoreState.session != null
→ presentedSession active
→ Session page
```

成功 submit / cancel：

```text
Core operation result settle
→ clear presentedSession
→ hubMode = status
→ Hub
```

关键差异：Core2 send/submit failure 会立即 terminalize Core Session。为了保留当前 TUI 的“partial output / failure 可查看、用户明确退出后回 Hub”体验，TUI **保留 presentation-only failed Session page**：

```text
Core Session 已 terminal
CoreState.session == null
        │
        └→ presentedSession.status = failed
           transcript 保留
           normal input disabled
           只允许 /exit / /cancel dismiss
```

此时：

```text
presentedSession ≠ active Core Session
```

`/exit` / `/cancel` 只关闭本地 failed presentation，不调用 `core.cancel()`，也不把 recent 从 failed 改成 cancelled。

这避免伪造业务 Session，同时保持用户能够阅读 partial output 和错误后再主动返回 Hub。

---

## 12. Session opening message

Core2 `startSession()` 只建立业务 Conversation，不负责 presentation greeting。

TUI 在新 Session 首次出现时追加**本地 system message**，不写入 Promptpile Conversation：

```text
init
→ 你想从什么样的世界开始？

planning
→ 今天想怎么展开？可以先说你希望发生什么。

play
→ 行动会话已开始。你想先做什么？

revise
→ 你想修订哪些 World 设定？
```

这些消息：

```text
TUI-owned
presentation only
不发送给 core.send()
不参与 semantic summary
不参与 submit
```

因此保留现有 Session 进入后的引导体验，同时不污染 agent authority。

---

## 13. CoreEvent bridge

Core2 public events 只有：

```text
state.changed
output.delta
```

TUI 不要求恢复 legacy message/loading events。

### 13.1 state.changed

处理规则：

```text
latestCoreState = event.state

若出现新的 Core session id
→ 创建 presentedSession
→ 创建新 transcript
→ append opening system message

若同一 session id
→ status 投影 ready/running/submitting

若 Core session 变 null
→ 不立即自行判断 success/failure
→ 对应 public CoreResult settle 后由发起请求的 driver method 决定
```

这是为了避免 submit/send terminalization 的中间 state 让页面在 Promise settle 前闪回 Hub。

### 13.2 output.delta

只接受：

```text
sessionId == 当前 presentedSession.id
且当前存在一个 send request
```

第一段 delta：

```text
创建 assistant message
status = streaming
```

后续 delta：

```text
append 到同一条 assistant message
```

`send()` success：

```text
streaming → complete
```

`send()` failure：

```text
已收到 partial delta
→ 保留文本
→ streaming → error

再追加 error message
→ presentedSession.status = failed
```

已经显示的 delta 永远不回滚。

每个 chunk 单独创建一条 message 属于实现错误。

mismatched / stale delta 只做 diagnostic，忽略展示。

---

## 14. User message ownership

Core2 不发 user-message event。

普通输入流程冻结：

```text
trim text
→ 非空
→ sessionControls.input == true
→ TUI append user complete message
→ core.send(trimmed)
```

如果 CoreResult failure：

```text
保留 user message
保留 partial assistant
追加 error message
进入 failed presentation
```

TUI transcript 默认继续保留现有资源上限：

```text
最多 500 messages / Session
最多 250_000 text chars / Session
```

实现可用一个小型 TUI-local transcript helper；禁止继续依赖 `@dayloom/core` 的 `MessageStore`。

---

## 15. Session controls

正常 active Session controls 必须直接投影 Core2 capabilities：

```text
input  = capabilities.send
submit = capabilities.submit
cancel = capabilities.cancel
```

failed presentation：

```text
input   = false
submit  = false
cancel  = false
dismiss = true
```

active presentation：

```text
dismiss = false
```

ViewModel：

```text
inputEnabled
= sessionControls.input

inputControlEnabled
= input || submit || cancel || dismiss
```

因此：

```text
ready       → Textarea enabled
running     → Textarea visible but disabled
submitting  → Textarea visible but disabled
failed view → Textarea enabled only for local dismiss commands
```

---

## 16. Running cancel 的明确 contract

当前恢复 TUI 在 streaming/loading 时允许输入高优先级 `/exit`；当前 Core2 public API **不支持 running/submitting interrupt cancel**：`cancel` 只在 ready 时有 capability。

本适配冻结以下行为：

```text
running / submitting
→ Textarea disabled
→ 不接受 /exit / /cancel
→ 不 queue cancel
→ 不 kill child
→ 不 dispose + recreate Core
```

全局 `Ctrl+C` 仍然退出整个 TUI；shutdown 调用 `core.dispose()`，Core2 自己负责 kill active child 和收尾。

这是唯一显式的 interaction 收敛。它不是生命周期功能缩水，而是尊重 Core2 当前 application contract。

若未来要求“streaming 中 `/exit` 立即返回 Hub”，必须先把 interrupt-style Session cancel 作为 **consumer-neutral Core2 semantic** 单独设计并冻结；不得在 TUI 中模拟。

---

## 17. Slash command contract

普通文本不以 `/` 开头：

```text
→ core.send(trimmed)
```

active ready Session：

```text
/submit
→ core.submit()

/exit
/cancel
→ core.cancel()

/status
→ local system message：当前正在 Session 中，请先输入 /exit 回到 Hub 再查看状态。

/help
→ local system message：当前正在 Session 中，请先输入 /exit 回到 Hub 再查看帮助。

/next
→ local warn：tui 不提供 /next，请回到 Hub 选择具体流程。

/revise
→ local warn：请先回到 Hub，再选择修订流程。

unknown /...
→ local warn：未知指令：<token>
```

failed presentation：

```text
/exit
/cancel
→ dismiss failed presentation
→ Hub(status)
→ recent 保持 failed

其它输入
→ local warn：会话已结束，请输入 /exit 返回 Hub。
```

slash token 不区分大小写；参数仍不解析。

未知 slash 永远不传入 `core.send()`。

---

## 18. Result / recent projection

CoreResult 是业务结果 source。

```text
startSession success
→ recent 不变

startSession failure
→ Hub
→ recent failed / 操作失败

send failure
→ failed Session presentation
→ recent failed / 会话失败

submit success
→ Hub(status)
→ recent completed / 会话已提交

submit failure
→ failed Session presentation
→ recent failed / 会话提交失败

cancel success
→ Hub(status)
→ recent cancelled / 会话已取消

settle success
→ Hub(status)
→ recent completed / 结算完成

abandonDay success
→ Hub(status)
→ recent completed / 已放弃当前日
```

若 `cancel()` 因 private workspace cleanup 返回 `INTERNAL_ERROR`，但 final `CoreState.session == null`：

```text
用户退出意图已经成立
→ 清 presentation
→ 回 Hub
→ recent failed
→ detail = Core error message
```

不得为了 cleanup diagnostic 把 UI 留在伪 active Session。

`WORLD_CONFLICT` 返回时 Core2 已 one-shot refresh World；TUI 必须使用 final `core.getState()` 重新投影 Hub，不得保留 stale World。

---

## 19. Loading / pending presentation

TUI loading 分两种。

### 19.1 Hub request

TUI-owned：

```text
init        → 正在启动初始化会话...
daily       → 正在启动计划会话...
revise      → 正在启动修订会话...
play        → 正在启动行动会话...
settle      → 正在结算当日...
abandon-day → 正在放弃当日...
```

pending Hub 时：

```text
HubSelect hidden
LoadingBar visible
不允许第二个 Hub business request
```

### 19.2 Session request

完全由 presentation status 派生：

```text
ready       → null
running     → AI 正在回复...
submitting  → 正在提交会话...
failed      → null
```

禁止额外维护第二个 Session loading state。

---

## 20. Hub status / help

`status` / `help` 继续是 TUI-local mode，不调用 Core2。

Hub status 至少展示：

```text
World root
World status
published 时：title / revision / phase / day / lastSettledDay
invalid 时：error
recent result
当前可用 business actions
```

Help 保持：

```text
Hub Enter / Up / Down
所有当前可见 shortcut
Session 普通文本
/submit
/exit / /cancel
/status / /help / /next / /revise
```

不可用 action 的说明可以显示：

```text
当前状态不可用
```

但该文字只是 presentation；禁止用 presentation reason 反向决定 legality。

---

## 21. Theme / terminology

World phase 只使用 Core2 persisted truth：

```text
uninitialized → 未初始化
invalid       → 异常
idle          → 空闲
planned       → 已计划
awaiting-settle → 待结算
```

不重新制造 persisted/transient phase：

```text
initializing
planning
playing
revising
```

Session header 单独显示：

```text
初始化 / 计划 / 行动 / 修订
等待输入 / AI 回复中 / 提交中 / 会话失败
```

这样可观察语义仍清晰，但不会把旧 Core transient phase 重新伪造成 World truth。

TUI action summary 同步新 lifecycle：

```text
init
→ 创建基础设定，完成后可制定第一天计划

daily
→ 和 AI 讨论并提交当前待规划日计划

play
→ 推进当前已计划日的事件和行动

settle
→ 结算当前日并回到空闲状态

revise
→ 维护或修正已有 World canon

abandon-day
→ 放弃当前未结算日并回到空闲状态
```

---

## 22. ViewModel 保留范围

以下现有 interaction mechanics 默认不重写：

```text
input history 最近 100 条
Ctrl+P / Ctrl+N
当前 draft 恢复
Textarea minRows=1 / maxRows=4
page change scroll reset
stick-to-bottom
手动 scroll 后不强制拉回 bottom
viewport / resize
HubSelect / Textarea autofocus
Ctrl+C 全局退出
```

`ViewModel` 不读取 raw CoreState；只消费 `TuiDriverState`。

推荐 projection：

```text
loadingLabel
→ page.busy 或 session.status

inputEnabled
→ sessionControls.input

inputControlEnabled
→ input | submit | cancel | dismiss
```

components 不直接调用 Core2。

---

## 23. Driver public seam

保留 TUI-owned interface：

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
```

它是 presentation seam，不是 backend abstraction。

生产创建：

```ts
export interface CreateRuntimeDriverOptions {
  worldRoot: string;
  llmConfigPath: string;
  diagnostic?: DiagnosticLogger;
}
```

生产路径唯一：

```ts
const core = await createDayloomCore({
  worldRoot: path.resolve(options.worldRoot),
  llmConfigPath: path.resolve(options.llmConfigPath),
});
```

删除生产 API：

```text
runtime?: DayloomRuntime
sessionFactory?: SessionFactory
```

---

## 24. Test seam

测试允许 module-internal / non-package-root seam 注入：

```text
already-created DayloomCore
或窄 coreFactory(options) → DayloomCore
```

禁止把它暴露成 generic production backend interface。

目的只有：

```text
可确定地产生 CoreState
可确定地产生 CoreEvent.output.delta
可确定地返回 CoreResult
验证 TUI interaction
```

TUI 测试不复制 Core2 internal publication / Promptpile runtime。

Core2 自己已经用 headless acceptance 证明完整 lifecycle；TUI 只验证 consumer projection 与真实 package wiring。

---

## 25. CLI / bootstrap

Core2 创建必须有 caller-owned LLM config。

CLI 冻结：

```text
dayloom-tui [worldRoot] --llm-config <path>
```

配置解析：

```text
--llm-config <path>
→ else DAYLOOM_LLM_CONFIG
→ else startup error + usage
```

`worldRoot` 缺省仍为 cwd。

`main.ts`：

```text
parse argv
→ resolve worldRoot
→ resolve llmConfigPath
→ createRuntimeDriver
→ createViewModel
→ mountApp
```

TUI 不解析 provider 配置，不注入 `[promptpile-react]`，不拥有 Promptpile topology。

`CoreInitializationError`：

```text
stderr 输出明确 message
process exitCode = 1
不进入 alternate screen app
```

---

## 26. Dispose / shutdown

保持应用关闭顺序：

```text
request exit
→ dispose mounted BindTTY app
→ ViewModel unsubscribe
→ Driver unsubscribe Core2
→ core.dispose()
→ process exit
```

Driver dispose 必须 idempotent。

开始 dispose 后：

```text
不再 emit TuiDriverState
pending driver method settle 后不再修改 presentation
listeners clear
```

Core2 owns child kill / compression drain / runtimeRoot cleanup；TUI 不重复这些责任。

---

## 27. Diagnostics

保留现有 diagnostic logger，但改成 Core2 terminology。

允许记录：

```text
CoreEvent type
Core world status/revision/phase
Core session id/kind/status
capability booleans
TUI page
pendingHubRequest
selected action
message length
CoreResult code
```

禁止记录完整用户正文、完整 model response、Promptpile semantic summary 或 LLM secret。

删除 `summarizeRuntimeEvent()` 等 legacy Runtime-specific diagnostics。

---

## 28. 文件级实施边界

### 必改

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
packages/tui/src/view-model.ts
packages/tui/src/diagnostics.ts
packages/tui/test/*
packages/tui/README.md
packages/tui/DESIGN.md
doc/guide/TUI.md
doc/packages/TUI.md
```

### 默认不改

```text
packages/tui/src/components/header.tsx
packages/tui/src/components/message-list.tsx
packages/tui/src/components/loading-bar.tsx
packages/tui/src/components/hub-select.tsx
packages/tui/src/components/text-input.tsx
packages/tui/src/components/footer.tsx
packages/tui/src/app.tsx
```

如果 components 为适配 Core2 需要 business-specific branch，优先视为 driver/view-model 设计错误。

---

## 29. 实施顺序

### Step 0 — Guard

新增 architecture guard：

```text
packages/tui/** 禁止 import @dayloom/core
禁止 import @dayloom/core-old
禁止 import @dayloom/core2/src/*
禁止 import @dayloom/core2/dist/*
```

### Step 1 — dependency / CLI

```text
@dayloom/core → @dayloom/core2
Node >=20
--llm-config / DAYLOOM_LLM_CONFIG
```

### Step 2 — local presentation types

先移除：

```text
RuntimeSnapshot
RuntimeMessage
CommandAvailability
WorldCommand
SessionStatus legacy type
```

### Step 3 — Hub projection

只基于 `CoreState.capabilities` 实现 6 个 business actions + 3 个 local actions。

### Step 4 — Core2 driver wiring

建立：

```text
latestCoreState
CoreEvent subscription
pendingHubRequest
CoreResult projection
```

### Step 5 — transcript bridge

实现：

```text
user local message
assistant streaming aggregation
error preservation
opening system message
failed presentation
```

### Step 6 — ViewModel projection

删除 raw Runtime snapshot/commands 读取；保留原 input/history/scroll/focus mechanics。

### Step 7 — docs / theme

同步 Core2 world/session terminology 与完整 lifecycle。

### Step 8 — unit acceptance

全部 driver/view-model test green。

### Step 9 — PTY acceptance

恢复后的真实交互矩阵 green。

### Step 10 — full integration gate

Core2 dedicated CI + TUI CI green 后才能删除 `@dayloom/core` TUI dependency 的迁移保护注释/旧 fixture。

---

## 30. Unit acceptance

必须覆盖：

```text
tui-uninitialized-projects-init
tui-idle-projects-daily-and-revise
tui-planned-projects-play-and-abandon
tui-awaiting-settle-projects-settle-and-abandon
tui-invalid-projects-no-business-action

tui-daily-maps-to-startSession-planning
tui-all-six-business-actions-map-exactly-once

tui-selection-persists-while-action-remains-visible
tui-pending-hub-request-does-not-flicker-action-topology

tui-opening-message-is-local-and-kind-specific
tui-user-text-appears-before-send-result
tui-output-delta-aggregates-into-one-assistant-message
tui-partial-output-survives-send-failure
tui-stale-delta-is-ignored

tui-submit-success-returns-hub-status
tui-cancel-success-returns-hub-status
tui-send-failure-keeps-local-failed-session-view
tui-submit-failure-keeps-local-failed-session-view
tui-failed-session-dismiss-does-not-call-core-cancel
tui-failed-session-dismiss-preserves-failed-recent-result

tui-running-and-submitting-disable-textarea
tui-ready-uses-core-capabilities-for-controls

tui-status-help-next-revise-slash-remain-local
tui-unknown-slash-never-reaches-core-send

tui-world-conflict-result-renders-core-refreshed-world
tui-cancel-cleanup-error-does-not-resurrect-session

tui-dispose-is-idempotent
tui-dispose-does-not-emit-after-shutdown

tui-input-history-preserves-draft
tui-page-transition-resets-scroll
tui-manual-scroll-does-not-force-stick-to-bottom
tui-autofocus-hub-session-hub
```

---

## 31. PTY acceptance

必须在真实 PTY 验证：

### Hub

```text
empty World
→ 显示未初始化
→ Init 推荐
→ ? 打开 Help
→ s 返回 Status
→ resize 正常
→ q 正常退出
```

### Init

```text
Enter Init
→ Session page
→ 自动聚焦 Textarea
→ 显示“你想从什么样的世界开始？”
→ 普通自然语言
→ 一条 assistant message streaming
→ 等待输入
→ /submit
→ Hub idle
```

### Planning

```text
Hub Daily
→ Planning Session
→ 多轮自然语言
→ /submit
→ Hub planned
```

### Play

```text
Hub Play
→ Play Session
→ streaming
→ /submit
→ Hub awaiting-settle
```

### Settle

```text
Hub Settle
→ HubSelect 暂时隐藏
→ LoadingBar 显示
→ 完成后 Hub idle
```

### Revise

```text
Hub Revise
→ Revise Session
→ /submit
→ Hub idle
```

### Abandon

```text
planned → abandon-day → idle
awaiting-settle → abandon-day → idle
```

### Failure

```text
AI partial delta
→ partial text 可见
→ Core Session terminal
→ TUI 仍停留 failed transcript view
→ /exit
→ Hub
→ recent 显示 failure
```

```text
invalid submit payload
→ failed transcript view
→ /cancel 本地 dismiss
→ Hub
→ World unchanged / refreshed truth correct
```

---

## 32. Full lifecycle acceptance

最终必须通过一条从空目录开始的 TUI-visible lifecycle：

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

过程中要求：

```text
每一步 Hub action 与 Core capabilities 一致
每个 Session 只有一个 transcript
每次 streaming 只有一条 assistant message
没有 legacy Runtime type
没有 TUI-owned lifecycle transition
没有隐藏的 backend switch
没有 stable dead end
```

---

## 33. 非目标

本次不做：

```text
修改 Archive Protocol
修改 Core2 lifecycle
修改 Promptpile / React / compression
新增 Web/GUI abstraction
重新设计 TUI 视觉
新增 overlay
新增 generic notification system
新增 command registry
新增 event normalization framework
支持 old core + core2 runtime switch
```

尤其不为了适配恢复：

```text
RuntimeSnapshot
RuntimeEvent
RuntimeCommand
MessageStore
旧 World transient phase
```

---

## 34. Definition of Done

全部满足才算 TUI → Core2 适配完成：

1. `@dayloom/tui` 不再依赖 `@dayloom/core`。
2. 只依赖 `@dayloom/core2` public root API。
3. Hub 完整提供 Init / Daily / Revise / Play / Settle / Abandon Day。
4. business action legality 只来自 `CoreState.capabilities`。
5. `daily` 只在 TUI vocabulary 层映射到 `planning`。
6. `uninitialized / invalid / published` 都有完整 Hub presentation。
7. TUI 不复制 Core2 World state machine。
8. TUI 不复制 Core2 Session state machine。
9. 保留 Hub / Session 两页模型。
10. status/help/quit 继续为纯 local action。
11. action order / shortcuts / recommended selection 保持。
12. Hub mutation pending 不造成 action list/selection 闪烁。
13. 四种 Session 使用同一 Session UI。
14. 每种 Session 有固定本地 opening guidance。
15. opening guidance 不进入 Promptpile Conversation。
16. 普通用户输入由 TUI 本地展示并仅调用一次 `core.send()`。
17. `output.delta` 聚合到单条 assistant message。
18. partial output 在失败时保留。
19. send/submit failure 不伪造 active Core Session。
20. failure 后保留 presentation-only transcript view。
21. failed view `/exit` / `/cancel` 只 dismiss，不调用 Core2 cancel。
22. failed recent result 不被伪装成 cancelled。
23. ready controls 直接投影 Core2 capabilities。
24. running/submitting 不模拟 interrupt cancel。
25. `/submit` 只调用 `core.submit()`。
26. active ready `/exit` / `/cancel` 只调用 `core.cancel()`。
27. unknown / Hub slash 不进入 `core.send()`。
28. settle/abandon 在 Hub 使用短流程 loading。
29. CoreResult failure 有明确 recent/error presentation。
30. `WORLD_CONFLICT` 后展示 Core2 已 refresh 的 World truth。
31. input history / draft / resize / scroll / stick-to-bottom 行为保持。
32. Hub / Session autofocus 行为保持。
33. Ctrl+C 继续走完整 shutdown/dispose。
34. production driver 不暴露 backend abstraction。
35. test injection 仅为 internal seam。
36. CLI 显式获得 caller LLM config。
37. TUI 不拥有 Promptpile/React config topology。
38. diagnostics 不记录 secret 或完整 conversation content。
39. architecture guard 阻止 legacy/deep imports。
40. unit interaction matrix 全绿。
41. PTY interaction matrix 全绿。
42. TUI-visible full lifecycle 从 empty 到 day2 planned 全绿。
43. Core2 dedicated CI 继续 green。
44. migration 不修改 Core2 application semantics。
45. implementation 中没有新增 queue / manager / backend framework。

---

## 35. 最终架构 theorem

```text
                         User
                           │
                 existing TUI interaction
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    @dayloom/tui                              │
│                                                              │
│  Hub / Session                                               │
│  status / help / shortcuts                                   │
│  transcript / streaming projection                           │
│  selection / loading / recent                                │
│  input / history / scroll / focus                            │
│                                                              │
│            no business lifecycle authority                   │
└──────────────────────────┬───────────────────────────────────┘
                           │
                 application semantics
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    @dayloom/core2                            │
│                                                              │
│  uninitialized / invalid / published                         │
│  init / planning / play / revise Sessions                    │
│  settle / abandonDay                                         │
│  send / submit / cancel                                      │
│  capabilities / CoreResult / CoreEvent                       │
│                                                              │
│              single application authority                    │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
                    Published Archive V2
```

最终原则：

```text
完整产品能力不能通过删 TUI 来迁就 Core2。
Core2 没有的语义也不能由 TUI 偷偷伪造。

已有 application fact → 直接投影。
已有 presentation need → 留在 TUI。
失败后的 transcript → 可以保留为 presentation。
失败后的 Core Session → 不得伪造为 active。
Hub operation loading → presentation only。
World / Session legality → 永远只有 Core2 一个 authority。
```

这就是本次 TUI → Core2 适配的实施边界。