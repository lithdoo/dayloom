# Dayloom TUI → Core2 适配草案

> Status: Adaptation Draft  
> Date: 2026-08-13  
> Target package: `@dayloom/tui`  
> Backend target: `@dayloom/core2`

---

## 1. 目标

本次工作不是创建第二套 TUI，也不是为 Core2 增加 TUI compatibility API。

目标是：

```text
保留现有 packages/tui
        ↓
保留现有主要交互逻辑 / layout / components
        ↓
删除对 @dayloom/core runtime shape 的依赖
        ↓
让 TUI 直接消费 @dayloom/core2 application API
```

最终产品交互保持：

```text
Hub
→ 显示当前 World 状态与可用操作
→ 选择 Play
→ 进入 Session
→ 用户输入自然语言
→ AI Final 实时流式显示
→ 多轮继续
→ /submit 或 /exit / /cancel
→ Session 结束
→ 回到 Hub
→ 显示新的 World 状态
```

本次适配只要求**交互语义一致**。

不要求：

```text
旧 RuntimeSnapshot shape 一致
旧 RuntimeEvent 一致
旧 RuntimeCommand 一致
旧 MessageStore 一致
旧 command availability 数据结构一致
旧错误码一致
旧内部 driver 实现一致
```

核心原则：

```text
Core2 提供 application facts。
TUI 将 application facts 投影成 presentation state。
Core2 不知道 TUI 的存在。
```

---

## 2. 为什么直接修改现有 `packages/tui`

不创建：

```text
packages/tui2
```

原因：当前需要保留的 presentation 资产仍然是同一套：

```text
BindTTY app / components
Hub 页面
Session 页面
键盘导航
输入历史
滚动逻辑
theme
status/help 展示
诊断日志
slash command UX
```

真正变化的是：

```text
@dayloom/core
        ↓
@dayloom/core2
```

因此这是 backend replacement，不是新的 presentation implementation。

仓库已有 `packages/tui-old` 作为旧 presentation/reference；不再制造第三套 TUI。

---

## 3. Ownership / dependency boundary

目标依赖：

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

禁止为了适配新增：

```text
@dayloom/core2 → @dayloom/tui
@dayloom/core2 → TuiRuntimeDriver
@dayloom/core2 → TuiDriverState
@dayloom/core2 → TuiMessage
```

也不创建一个旧 Runtime compatibility facade：

```text
Core2
→ Fake DayloomRuntime
→ Fake RuntimeSnapshot
→ Fake RuntimeEvent
→ existing driver
```

正确方向：

```text
Core2 CoreState / CoreEvent / CoreResult
                ↓
       TUI-owned projection
                ↓
          TuiDriverState
                ↓
          existing ViewModel
                ↓
          existing components
```

---

## 4. 本次非目标

本次适配不负责：

```text
新增 Core2 Session kind
为 Core2 实现 init / daily / revise / settle
恢复旧 Core 全部 command 集合
修改 Archive Protocol
修改 Promptpile / React runtime
实现 Compress
修改 TUI 视觉设计
重做键盘系统
重做 input/history/scroll
设计 generic backend provider
同时支持 old core + core2 runtime switch
```

特别禁止：

```text
RuntimeBackend interface
OldCoreBackend
Core2Backend
```

当前产品方向已经选择 Core2；不存在需要维持双 backend 的真实需求。

---

## 5. 当前耦合面

现有 TUI 对旧 Core 的耦合主要集中在四处。

### 5.1 `runtime-driver/create-runtime-driver.ts`

当前直接使用：

```text
MessageStore
createArchiveV2Repository
createArchiveV2SessionWorldReadModel
createDayloomRuntime
createNaturalLanguageSessionFactory
createPromptpileConversationClient
DayloomRuntime
RuntimeCommand
RuntimeEvent
RuntimeMessage
RuntimeSnapshot
SessionFactory
```

适配后这些全部从 TUI 删除。

Driver 直接创建：

```ts
createDayloomCore({
  worldRoot,
  llmConfigPath,
})
```

### 5.2 `types.ts`

当前 `TuiDriverState` / `TuiPage` / message / session type 直接复用旧 Core 类型。

适配后 presentation types 必须 TUI-local。

### 5.3 `hub/actions.ts`

当前根据：

```text
WorldCommand[]
CommandAvailability[]
old WorldPhase
```

投影 Hub action。

适配后仅根据 Core2：

```text
CoreState.world
CoreState.capabilities
```

投影。

### 5.4 `view-model.ts`

当前读取：

```text
snapshot.world
snapshot.session.status
commands
RuntimeMessage
```

适配后读取 TUI-local driver state，不直接依赖 Core2，也不继续保留 legacy snapshot shape。

---

## 6. TUI-local state 目标

不要为了“少改 view-model”保留一个假的 `RuntimeSnapshot`。

建议把 driver state 收敛成真正 presentation-oriented 的本地类型：

```ts
export type TuiSessionStatus =
  | 'ready'
  | 'running'
  | 'submitting';

export interface TuiWorldState {
  worldRoot: string;
  worldId: string;
  title: string;
  revision: number;
  commitId: string;
  phase: 'idle' | 'planned' | 'awaiting-settle';
  day: string | null;
  lastSettledDay: string | null;
}

export interface TuiSessionState {
  id: string;
  kind: 'play';
  status: TuiSessionStatus;
}

export interface TuiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  status?: 'streaming' | 'complete' | 'error';
}

export interface TuiDriverState {
  page: TuiPage;
  world: TuiWorldState;
  session: TuiSessionState | null;
  hubActions: TuiHubAction[];
  selectedHubActionId: string | null;
  recent: TuiRecentResult | null;
  loading: TuiBusyState | null;
  messages: TuiMessage[];
}
```

这些是 presentation state，不是 Core2 API 的镜像。

映射：

```text
CoreState.world   → TuiWorldState
CoreState.session → TuiSessionState
Core capabilities → TuiHubAction / input availability
CoreEvent         → message projection / state refresh
```

---

## 7. `TuiRuntimeDriver` 保留

现有 driver interface 可以继续作为 TUI 内部 seam：

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

但它必须明确是：

```text
TUI internal presentation driver
```

而不是：

```text
Core2 adapter contract
```

Core2 永远不实现或 import 此 interface。

---

## 8. Driver 创建契约

Core2 需要：

```ts
createDayloomCore({
  worldRoot,
  llmConfigPath,
})
```

因此：

```ts
export interface CreateRuntimeDriverOptions {
  worldRoot: string;
  llmConfigPath: string;
  diagnostic?: DiagnosticLogger;
}
```

删除旧测试注入：

```text
runtime?: DayloomRuntime
sessionFactory?: SessionFactory
```

如果测试需要 seam，只允许在 TUI module-private/internal test entry 中注入一个已经创建好的 `DayloomCore`；不要把 backend abstraction 暴露成生产 API。

---

## 9. TUI CLI / LLM config

旧 TUI 由旧 Core 自己从环境变量拼 LLM 配置；Core2 明确要求 caller 提供 `llmConfigPath`。

这属于 application bootstrap / executable configuration，不属于 Core2 domain。

本次建议增加：

```text
dayloom-tui [worldRoot] --llm-config <path>
```

解析后：

```ts
createRuntimeDriver({
  worldRoot,
  llmConfigPath,
  diagnostic,
})
```

允许一个简单环境变量 fallback：

```text
DAYLOOM_LLM_CONFIG
```

解析规则：

```text
--llm-config
→ else DAYLOOM_LLM_CONFIG
→ else startup error with clear usage
```

不在 TUI 内重新生成 provider TOML。

不把旧的：

```text
DAYLOOM_LLM_API_NAME
DAYLOOM_LLM_MODEL
DAYLOOM_LLM_BASE_URL
...
```

重新复制进新的 TUI runtime。

配置内容 authority 仍由 Core2 的 caller-config guard 负责。

---

## 10. Hub projection

Core2 MVP 当前只有 `play` Session capability。

Hub action 分两类。

### 10.1 Local actions

继续存在：

```text
status
help
quit
```

它们完全由 TUI 拥有。

### 10.2 Core application action

当前只有：

```text
play
```

规则：

```text
if coreState.capabilities.startSessions includes 'play'
→ show Play action
else
→ do not show Play action
```

点击 Play：

```text
core.startSession('play')
```

禁止为了维持旧菜单而伪造：

```text
init
daily
revise
settle
abandon-day
```

只有 Core2 真正提供对应 application capability 后，TUI 才显示。

因此：

```text
交互模式保持一致
≠ 当前业务 capability 数量必须与旧 Core 一致
```

---

## 11. Page projection

页面只由 Core2 Session 是否存在决定：

```text
core.state.session == null
→ Hub

core.state.session != null
→ Session page
```

当：

```text
Session → null
```

且此前位于 Session page：

```text
page → Hub(status)
```

这适用于：

```text
submit success
cancel success
send terminal failure
submit failure
```

TUI 不需要理解 Promptpile/React failure lifecycle。

---

## 12. Message ownership

Core2 不提供 MessageStore，这是正确边界。

TUI 自己维护当前 Session 的 presentation transcript。

最小模型：

```text
user message
assistant streaming message
local system/error message
```

不创建通用 message framework。

建议继续只在 driver 内维护一个数组或小型 helper。

### 12.1 User input

当用户提交普通文本：

```text
trim / reject empty in TUI
→ append local user message
→ core.send(text)
```

用户消息是 presentation projection，不是 Promptpile artifact authority。

Core2/Promptpile Conversation 仍是 AI interaction history authority。

### 12.2 Assistant streaming

Core2 event：

```ts
{ type: 'output.delta', sessionId, text }
```

Driver：

```text
first delta
→ create one assistant message(status=streaming)

next delta
→ append text to same assistant message

send success
→ mark complete

send failure
→ mark error or append local error message
```

Driver 不需要：

```text
assistant-message-start
assistant-message-end
assistant-message-delta legacy event vocabulary
```

### 12.3 Submit

Core2 不公开 submission JSON `output.delta`。

因此 TUI 不需要过滤机器 JSON。

`submit()` success：

```text
recent = 会话已提交
Session disappears
page → Hub
```

### 12.4 Cancel

```text
core.cancel()
→ recent = 会话已取消
→ page → Hub
```

---

## 13. Loading / input semantics

不要复制旧 Session status vocabulary：

```text
created
waiting-input
streaming
loading
completed
cancelled
failed
```

直接基于 Core2：

```text
ready
running
submitting
```

建议 projection：

```text
ready
→ inputEnabled = true
→ loadingLabel = null

running
→ inputEnabled = false
→ loadingLabel = 'AI 正在回复...'

submitting
→ inputEnabled = false
→ loadingLabel = '正在提交会话...'
```

Core2 mutation in flight 时 capabilities 已关闭，因此 TUI 也可将 Core capabilities 作为 legality source。

`/exit` / `/cancel` 当前 Core2 只允许在 `ready`，因此 running/submitting 时不要假装 cancel 可用。

UI hint 必须与真实 capability 一致。

---

## 14. Slash commands

Session 中保留：

```text
/submit
/exit
/cancel
/status
/help
/next
/revise
```

行为：

```text
/submit
→ if core capability.submit then core.submit()
→ else local warning/error

/exit / /cancel
→ if core capability.cancel then core.cancel()
→ else local warning/error

/status / /help
→ 保持现有提示：先退出 Session 回 Hub

/next
→ local warning，TUI 不提供该命令

/revise
→ local warning；只有未来 Core2 真正提供 revise capability 后再考虑 Hub action
```

不把 slash command string 传给 Core2。

---

## 15. Hub content / status / help

`hub/content.ts` 不再接收 legacy：

```text
RuntimeSnapshot
CommandAvailability[]
```

改为只接收 TUI-local：

```text
TuiWorldState
TuiHubAction[]
TuiRecentResult
```

Status 至少显示：

```text
world title / id
revision
day
phase
lastSettledDay
current available actions
recent result
```

Help 只列出当前实际可用的 action 与本地导航说明。

不向用户展示不存在的 Core2 commands。

---

## 16. Theme / labels

`theme.ts` 当前若依赖旧 Core union type，应改成本地 string union：

```text
PublishedWorldPhase
TuiSessionStatus
'play'
```

视觉 label 保持当前风格：

```text
planned        → 已规划
awaiting-settle → 待结算
play           → 游玩
ready          → 等待输入
running        → AI 正在回复
submitting     → 正在提交
```

不要求 Core2 提供中文 label。

---

## 17. Diagnostics

Diagnostics 继续属于 TUI。

建议记录 Core2 facts，而不是 legacy RuntimeEvent：

```text
driver-created
core-event
hub-action
hub-action-result
session-input-submit
session-input-result
local-message-added
driver-dispose-begin/end
```

核心字段：

```text
world revision / phase
session id / kind / status
CoreResult ok/error.code
CoreEvent type
page
```

不重新构造 legacy RuntimeEvent diagnostics shape。

---

## 18. `view-model.ts` 适配原则

尽量保留：

```text
signals
page switching
input history
scroll state
selection logic
textarea reset
mount/dispose behavior
```

只替换数据读取：

```text
snapshot.world      → state.world
snapshot.session    → state.session
commands            → hubActions / capabilities projection result
RuntimeMessage      → TuiMessage
```

例如：

```text
loadingLabel
```

直接根据：

```text
state.loading
state.session?.status
```

而不是继续模拟旧 status。

---

## 19. Components 原则

`app.tsx` 与 `components/*` 默认不改结构。

只允许因 type/property rename 产生的机械调整。

如果为了 Core2 适配需要大规模修改 component tree，应先停止并检查 driver/view-model 是否泄漏了 backend semantics。

目标是：

```text
backend replacement
≈ driver + state projection change
```

而不是：

```text
backend replacement
→ rewrite presentation
```

---

## 20. Package change

`packages/tui/package.json`：

```diff
- "@dayloom/core": "*"
+ "@dayloom/core2": "*"
```

TUI source 最终不得 import：

```text
@dayloom/core
@dayloom/core-old
```

建议增加简单 architecture test/guard：

```text
packages/tui/src/**
→ reject @dayloom/core / @dayloom/core-old imports
```

无需设计跨 package architecture framework。

---

## 21. 实施顺序

### Step 0 — dependency / argv

```text
switch package dependency to @dayloom/core2
add --llm-config / DAYLOOM_LLM_CONFIG resolution
wire main.ts → createRuntimeDriver
```

### Step 1 — local presentation types

```text
remove @dayloom/core imports from types.ts
introduce TuiWorldState / TuiSessionState / TuiMessage
remove RuntimeSnapshot / CommandAvailability / WorldCommand aliases
```

### Step 2 — Hub projection

```text
rewrite hub/actions.ts from Core2 capabilities
keep local status/help/quit
show Play only when Core2 exposes play capability
```

### Step 3 — runtime driver

```text
createDayloomCore
subscribe CoreEvent
CoreState → TuiDriverState
startSession/send/submit/cancel mapping
local transcript projection
recent/loading/page behavior
```

### Step 4 — view-model

```text
replace snapshot/commands reads with local driver state
map ready/running/submitting to existing loading/input UX
keep navigation/history/scroll behavior
```

### Step 5 — content/theme/diagnostics

```text
remove remaining legacy Core types
update status/help content
update labels
update diagnostics projection
```

### Step 6 — tests

```text
interaction-equivalent Play lifecycle
streaming temporal behavior
slash commands
Hub projection
dispose
architecture import guard
```

完成 Step 6 后，现有 `packages/tui` 即完成 Core2 backend 切换。

---

## 22. Acceptance tests

至少覆盖：

```text
tui-no-longer-depends-on-dayloom-core

tui-argv-requires-or-resolves-llm-config
tui-driver-creates-core2-with-world-and-llm-config

tui-hub-shows-play-iff-core2-capability-allows-play
tui-hub-keeps-status-help-quit-local
tui-does-not-show-unsupported-legacy-world-commands

tui-start-play-enters-session-page
tui-user-text-is-projected-locally-and-sent-to-core2
tui-output-delta-updates-one-streaming-assistant-message-before-send-resolves
tui-send-success-completes-assistant-message
tui-send-failure-shows-error-and-returns-to-hub-when-core2-session-terminates

tui-submit-does-not-display-submission-json
tui-submit-success-returns-to-hub-with-completed-recent-result
tui-cancel-success-returns-to-hub-with-cancelled-recent-result

tui-input-enabled-only-when-core2-session-ready
tui-running-shows-ai-loading-state
tui-submitting-shows-submit-loading-state

tui-submit-slash-command-calls-core2-submit
tui-exit-and-cancel-slash-command-call-core2-cancel-only-when-legal
tui-status-help-next-revise-remain-local-presentation-behavior

tui-view-model-keeps-input-history-and-scroll-behavior
tui-dispose-unsubscribes-and-disposes-core2

tui-source-rejects-legacy-core-imports
```

测试重点是**用户可观察交互语义**，不是模拟旧 Core event payload。

---

## 23. 适配完成标准

同时满足：

1. `packages/tui` 直接依赖 `@dayloom/core2`，不依赖 `@dayloom/core`；
2. 不创建 `packages/tui2`；
3. 不创建 old/core2 双 backend abstraction；
4. Core2 不增加任何 TUI-specific API；
5. TUI presentation types 不再继承 legacy Runtime types；
6. Hub action 从 Core2 capabilities 投影；
7. 不伪造 Core2 尚未支持的 legacy command；
8. Play Session 保持 Hub → Session → multi-turn → submit/cancel → Hub 的交互；
9. `output.delta` 在 UI 中实时显示；
10. submit 的机器 JSON 永不展示；
11. transcript/message lifecycle 完全由 TUI presentation 层拥有；
12. Promptpile Conversation 仍由 Core2/Promptpile 拥有，TUI 不读取其 artifact；
13. loading/input hint 与 Core2 当前真实 legality 一致；
14. components/layout/input history/scroll 行为尽可能保持不变；
15. CLI 显式解决 `llmConfigPath`，不重新复制 provider config policy；
16. TUI tests 验证 interaction semantics，不验证 legacy Runtime compatibility；
17. TUI source 不再 import legacy Core。

---

## 24. 边界判断规则

适配过程中，如果想给 Core2 增加字段，先问：

```text
如果 consumer 是 Web / GUI / test harness，
这个字段仍然是自然的 Dayloom application fact 吗？
```

如果答案是否定的，例如：

```text
page
selectedAction
shortcut
loadingLabel
messageId
hubMode
inputHint
recentResult
```

它必须留在 TUI。

如果缺失的是：

```text
当前 World 状态
Session 是否存在
Session 当前业务状态
某 operation 是否合法
operation result
user-visible Final delta
```

才属于 Core2 application boundary 的潜在问题。

本次适配默认认为当前 Core2 Freeze 已足够，不主动修改 Core2。

---

## 25. 最终结构

```text
                    @dayloom/core2
                           │
                 CoreState / CoreEvent
                           │
                           ▼
                TuiRuntimeDriver
                  │          │
          state projection   command mapping
                  │          │
                  └────┬─────┘
                       ▼
                 TuiDriverState
                       │
                       ▼
                  ViewModel
                       │
                       ▼
            existing BindTTY components
```

最终原则：

```text
Core2 owns application semantics.
TUI owns presentation semantics.

TUI adapts to Core2.
Core2 does not adapt to TUI.
```

本次工作的成功标准不是“让 Core2 看起来像旧 Runtime”，而是：

```text
在不复刻旧 Runtime API 的情况下，
现有 TUI 仍然自然完成同一套用户交互。
```
