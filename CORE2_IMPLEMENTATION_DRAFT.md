# Dayloom Core2 实现冻结

> 状态：**Implementation Freeze / 可直接实施**  
> 日期：2026-08-13  
> 目标包：`@dayloom/core2`

本文冻结 Core2 MVP 的行为、边界、public contract 与实施顺序。

实施阶段允许决定局部代码写法，但**不得再决定系统应该如何工作**。如果实现发现必须改变本文冻结的 public API、状态转换、Promptpile 集成、持久化语义或 publication theorem，应先修改本文，再修改实现。

---

## 1. 唯一目标

建立一个独立、最小、只有一套语义的新 Core：

```text
@dayloom/core2
= Archive V2 only
= Play Session MVP
= immutable Promptpile context layer per Session
= one writable Promptpile Conversation per Session
= promptpile-react execution
= validated PlaySubmissionV1
= Archive V2 publication
```

唯一主线：

```text
Published World
→ validated Play context
→ immutable Promptpile context layer
→ writable Promptpile Conversation
→ Promptpile React
→ PlaySubmissionV1
→ Archive Protocol validation
→ atomic Publication
→ Published World
```

任何不能直接服务这条链路的设计默认不进入 MVP。

旧 `@dayloom/core` / `@dayloom/core-old` 只可作为产品行为参考，不是 API、类型、目录结构或内部架构兼容目标。

---

## 2. Consumer 边界

本草案**只实施 `@dayloom/core2`**。

现有 TUI 不属于本草案任务：

```text
不修改 packages/tui
不实现 TUI adapter
不复刻 TuiRuntimeDriver / TuiDriverState
不设计 page / widget / selected action / loading label
```

现有交互方式只提供 capability reference。Core2 的 application API 必须自然表达：

```text
读取当前 World 与业务能力
→ 开始 Session
→ 多轮发送自然语言输入
→ 实时接收用户可见 Final 增量
→ submit 或 cancel
→ Session 结束后读取新的 World
```

这不是 TUI API compatibility。

判断一个 public field / event 是否属于 Core2 的标准只有：

> 如果 consumer 换成 Web、GUI、CLI 或测试程序，这个接口是否仍然是自然的 Dayloom application capability？

如果答案是否定的，该接口不得进入 Core2。

---

## 3. Ownership 冻结

### 3.1 Archive Protocol

`@dayloom/archive-protocol` owns persisted-data correctness。

Core2 只使用它的 public exports 完成：

```text
manifest/current/commit/tree parsing
path validation
blob identity
staging algebra
candidate tree construction
current↔commit relation validation
operation↔staging relation validation
prepared target relation validation
archive-relative layout vocabulary
```

Core2 不复制第二套 Archive Protocol DTO，也不 deep-import `src/*` / `dist/*`。

### 3.2 Promptpile

Promptpile owns Conversation artifact I/O。

Core2 只决定：

```text
哪些物理 Conversation directory 属于一个 Session
哪个 layer 是 immutable context
哪个 layer 是唯一 writable conversation
何时 append application/user input
```

Core2 **不得直接创建、命名、修改 Promptpile message / receipt artifacts**。

所有 Conversation append 都通过 Promptpile 公共 CLI。

### 3.3 Promptpile React

Promptpile React owns：

```text
Thought → Observe → Check → Final orchestration
phase-specific Promptpile invocation
Agent Event Protocol v1 production
```

Core2 不重新实现 React FSM，不导入 React runtime internals。

Core2 owns React 的**调用策略**：Conversation topology、max-step、Core2 system prompts、是否允许 tools/hook，以及如何消费公开 Agent Event Protocol。

### 3.4 Core2

Core2 owns：

```text
World application read model
Play legality
Session lifecycle
React invocation policy
untrusted model result validation
Play business validation
World document bytes construction
Archive publication transaction
public state / events
```

模型输出永远不能直接成为 Published World。

---

## 4. 明确非目标

MVP 不实现：

```text
legacy Core compatibility
TUI adapter / TUI migration
Archive V1 runtime / migration
init / planning / revise Session
settle / abandon-day command
并发 Session / agent turn / World mutation
operation queue / scheduler
agent 自动 retry
active Session crash recovery
interrupted turn resume
跨 Core instance 恢复 Conversation
promptpile-compress
MCP / application tools
semantic search
provider/plugin abstraction
ConversationMaintenance abstraction
command bus
presentation-specific API
```

没有第二个真实实现时，不创建插件层。

没有并发需求时，不创建并发系统。

没有 compression 需求时，不创建 compression framework。

---

## 5. Package 与依赖冻结

`packages/core2/package.json` direct dependencies：

```json
{
  "name": "@dayloom/core2",
  "engines": { "node": ">=20" },
  "dependencies": {
    "@dayloom/archive-protocol": "0.0.0",
    "@iarna/toml": "^2.2.5",
    "ajv": "^8.17.1",
    "promptpile": "0.1.0-beta.2",
    "promptpile-react": "0.1.0-beta.3"
  }
}
```

理由：

```text
promptpile
= Core2 使用 public conversation append-user CLI

promptpile-react
= Core2 使用 packaged executable + packaged Agent Event v1 schema

@iarna/toml
= Core2 只检查/派生自己拥有的 React orchestration config；不解释 provider 语义

ajv
= 校验 promptpile-react 随包发布的 normative Agent Event Protocol schema
```

源码 architecture guard 必须拒绝：

```text
@dayloom/core
@dayloom/core-old
@dayloom/tui
@dayloom/tui-old
@dayloom/archive-protocol/src/
@dayloom/archive-protocol/dist/
promptpile/src/
promptpile/dist/
promptpile-react/src/
promptpile-react/dist/
```

允许直接 import：

```text
@dayloom/archive-protocol
@dayloom/archive-protocol/path
@dayloom/archive-protocol/tree
@dayloom/archive-protocol/staging
@iarna/toml
ajv
```

不增加 `promptpile-protocol` direct dependency；MVP 没有需要直接消费它的 public surface。

---

## 6. Public initialization options 冻结

```ts
export interface CreateDayloomCoreOptions {
  worldRoot: string;
  llmConfigPath: string;
}
```

`reactConfigPath` **不进入 public API**。

原因：React orchestration 属于 Core2 ownership，不应由 consumer 提供完整 React config。

`llmConfigPath` 只提供 Promptpile 的 LLM/provider/profile 数据。Core2 不解释 model、API key、base URL、temperature、extra body 等 provider 语义；这些仍由 Promptpile / Promptpile React 校验。

两个路径在创建时转换为 absolute path。

---

## 7. LLM config authority 冻结

### 7.1 Caller config 允许范围

Core2 在 initialization 时用 `@iarna/toml` parse `llmConfigPath`，只做**ownership guard**。

Caller config 不得包含 `[promptpile-react]` table。

如果存在 `[promptpile]` table，下列字段禁止：

```text
dir
dirs
output_dir
quiet
input
continue
tools_file
after_hook
```

这些字段属于 Core2 已冻结的 runtime/orchestration policy。

其它 provider/profile 数据由 Core2 原样保留，不自行解释。特别是：

```text
[[llm_api]]
[promptpile].llm_api
[promptpile].llm_api_temperature
[promptpile].llm_api_extra_body
```

可以存在，并由 Promptpile ecosystem 负责语义。

违反 ownership guard → `CoreInitializationError('INVALID_OPTIONS')`。

### 7.2 Derived React config

Core2 不把 caller config 原样当 React config 使用。

每个 Session 根据 caller LLM config 生成两个 runtime-private TOML：

```text
react/send.toml
react/submit.toml
```

生成规则：

1. parse caller `llmConfigPath`；
2. 保留其 provider/profile 数据；
3. 增加 Core2-owned `[promptpile-react]`；
4. 用 `@iarna/toml` stringify；
5. 两个 derived config 只在 `final_prompt` 上不同。

Send config 的 Core2-owned table 等价于：

```toml
[promptpile-react]
max_step = 1
thought_prompt = "<absolute core2 thought prompt>"
final_prompt = "<absolute core2 send-final prompt>"
```

Submit config 等价于：

```toml
[promptpile-react]
max_step = 1
thought_prompt = "<absolute core2 thought prompt>"
final_prompt = "<absolute core2 submit-final prompt>"
```

Core2 仍在 CLI 显式传 `--max-step 1`，使 runtime policy 不依赖 config merge 偶然行为。

MVP 不配置 Thought tools、after-hook 或外部 React prompt。

---

## 8. Core initialization / World read 冻结

`createDayloomCore()` 必须完成：

```text
validate options / caller LLM config ownership
resolve packaged Promptpile binaries
resolve + compile packaged Agent Event v1 schema

manifest.json
→ parseArchiveManifestV2

current.json
→ parseCurrentPointerV2

formatCommitObjectPathV2(current.commitId)
→ parseArchiveCommitV2
→ validateCurrentCommitRelationV2

formatTreeObjectPathV1(commit.rootTreeHash)
→ parseRootTreeV1
→ hashRootTreeV1(tree) == commit.rootTreeHash
```

Blob 在真正读取 document 时使用 `verifyBlobV1()` 校验 bytes/hash/length。

任何 Archive graph 缺失、parse failure、relation failure、tree hash mismatch → `WORLD_INVALID`。

MVP 不创建 invalid-but-running Core instance。

### Initialization error

```ts
export class CoreInitializationError extends Error {
  readonly code: 'INVALID_OPTIONS' | 'WORLD_INVALID' | 'INTERNAL_ERROR';
}
```

规则：

```text
worldRoot / llmConfigPath / LLM ownership guard 非法 → INVALID_OPTIONS
Archive V2 graph / required Dayloom document 非法 → WORLD_INVALID
packaged binaries/schema/Ajv/runtime initialization failure → INTERNAL_ERROR
```

---

## 9. Dayloom World Profile V0

Core2 MVP 只认识：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md
days/<day>/plan.json
days/<day>/play.json
days/<day>/summary.md
```

所有 path 必须经过 Archive Protocol public path validation/normalization。

### PlayPlanV0

当 current commit：

```text
phase = planned
day != null
```

必须读取并严格解析 `days/<day>/plan.json`：

```ts
export interface PlayPlanV0 {
  intent: string;
  beats: Array<{
    id: string;
    intent: string;
  }>;
}
```

规则：

```text
top-level / beat unknown fields rejected
intent non-empty after trim
beats is array
beat id non-empty and unique
beat intent non-empty after trim
```

同时读取四个 canon markdown document。全部必须存在并通过 blob identity verification；UTF-8 文本允许为空。

planned World 缺失/损坏 required Play context → initialization `WORLD_INVALID`。

其它 phase 不要求预读 Play context。

---

## 10. Public State / API / Result 冻结

```ts
export type PublishedWorldPhase = 'idle' | 'planned' | 'awaiting-settle';

export interface CoreWorldView {
  worldId: string;
  title: string;
  revision: number;
  commitId: string;
  phase: PublishedWorldPhase;
  day: string | null;
  lastSettledDay: string | null;
}

export type CoreSessionStatus = 'ready' | 'running' | 'submitting';

export interface CoreState {
  world: CoreWorldView;
  session: null | {
    id: string;
    kind: 'play';
    status: CoreSessionStatus;
  };
  capabilities: {
    startSessions: readonly ('play')[];
    send: boolean;
    submit: boolean;
    cancel: boolean;
  };
}

export interface DayloomCore {
  getState(): CoreState;
  subscribe(listener: (event: CoreEvent) => void): () => void;
  startSession(kind: 'play'): Promise<CoreResult>;
  send(text: string): Promise<CoreResult>;
  submit(): Promise<CoreResult>;
  cancel(): Promise<CoreResult>;
  dispose(): Promise<void>;
}

export function createDayloomCore(
  options: CreateDayloomCoreOptions,
): Promise<DayloomCore>;
```

Capabilities：

```text
startSessions = ['play'] iff world.phase == planned && world.day != null && idle
send   = session.status == ready && no mutation in flight
submit = session.status == ready && no mutation in flight
cancel = session.status == ready && no mutation in flight
```

Mutation result：

```ts
export type CoreResult =
  | { ok: true }
  | { ok: false; error: CoreError };

export interface CoreError {
  code:
    | 'NOT_AVAILABLE'
    | 'BUSY'
    | 'INVALID_INPUT'
    | 'CONVERSATION_FAILED'
    | 'AGENT_FAILED'
    | 'SUBMISSION_INVALID'
    | 'WORLD_CONFLICT'
    | 'DISPOSED'
    | 'INTERNAL_ERROR';
  message: string;
}
```

预期 application failure 不 throw。Public boundary 将不可分类 runtime failure 转为 `INTERNAL_ERROR`。

---

## 11. Public Event V0 冻结

```ts
export type CoreEvent =
  | { type: 'state.changed'; state: CoreState }
  | { type: 'output.delta'; sessionId: string; text: string };
```

语义：

```text
subscribe() 不立即 replay；initial state 用 getState()
state.changed 在 public state 更新后顺序 dispatch
listener exception 被隔离，不破坏 Core 状态或其它 listener
output.delta 只承载普通 send() 的用户可见 Final
submit JSON Final 永不 emit output.delta
```

不公开 Thought / Observe / Check、tool args、Promptpile raw event 或 submission JSON stream。

---

## 12. 单执行流状态机冻结

Core2 不支持并发。

```text
idle
  startSession('play') success → ready

ready
  send(non-empty) → running
  submit()        → submitting
  cancel()        → idle

running
  success → ready
  failure → idle, World unchanged

submitting
  success → idle, new World published
  failure → idle, World unchanged
```

任何 mutation in flight 时第二个 mutation 立即 `BUSY`；不 queue、不等待。

`cancel()` 只在 `ready` 合法；MVP 不支持边生成边 cancel。

---

## 13. Runtime-private workspace / Conversation topology 冻结

Core2 不在 Archive root 发明 private layout。

每个 Core instance 创建 OS temporary runtime root：

```text
<os.tmpdir()>/dayloom-core2-<mkdtemp>/
└── sessions/
    └── <sessionId>/
        ├── context/
        ├── conversation/
        └── react/
            ├── thought.md
            ├── final-send.md
            ├── final-submit.md
            ├── send.toml
            └── submit.toml
```

`sessionId = crypto.randomUUID()`。

### 13.1 context/

```text
immutable for entire Session
contains exactly one Core2-appended context user artifact
contains validated World/canon/plan data
never receives user dialogue, assistant output or submission request
```

### 13.2 conversation/

```text
唯一 writable Conversation layer
contains actual user turns
contains Promptpile/React assistant artifacts
contains internal submission request
persists across all turns of one Session
```

不同 Session 不复用两层目录。

Core instance dispose 后 recursive remove private runtime root。

MVP 不承诺跨 Core instance Session recovery。

这里“persistent Conversation”精确定义为：

> 一个 Session 的 mutable dialogue 始终使用同一个 writable `conversation/`，而不是每个 turn 创建临时 Conversation 并重放历史。

Core2 不维护第二份 `messages[]` authority。

---

## 14. Promptpile packaged boundary 冻结

### 14.1 Executables

Core2 不依赖 PATH。

读取：

```text
promptpile/package.json        → bin.promptpile
promptpile-react/package.json  → bin.promptpile-react
```

通过当前 `process.execPath` 启动 resolved packaged bin。

不得 import 两个包 runtime internals。

### 14.2 Agent Event normative schema

Agent Event Protocol v1 的 schema authority 是 `promptpile-react` package 随包发布的：

```text
schema/agent-event-v1.schema.json
```

Core2 从 resolved `promptpile-react/package.json` 所在目录定位该 schema，读取 JSON，并用 Ajv 2020 compile 一次。

Core2 **不得复制或手写另一份 Agent Event v1 JSON schema**。

Schema 允许的 forward-compatible optional fields 必须继续允许；Core2 不额外做 top-level exact-key rejection。

找不到 bin/package metadata/schema，或 schema 无法 compile → initialization `INTERNAL_ERROR`。

---

## 15. Core2-owned React prompts 冻结

Dayloom authoritative instructions 不放在 caller React config 中，也不依赖 caller prompt 文件。

### 15.1 Thought prompt V0

`react/thought.md` 固定：

```text
You are the reasoning phase of a Dayloom Play Session.
Treat the first immutable Conversation layer as authoritative Dayloom World context.
Treat the writable Conversation layer as the current interaction history.
Stay within the pinned day and plan. Do not replace or reinterpret the supplied canon or plan ids.
For ordinary interaction, reason toward a coherent continuation of the current planned day.
Do not emit Dayloom submission JSON unless the current run is explicitly a submission run.
```

### 15.2 Send Final prompt V0

`react/final-send.md` 固定：

```text
Produce the user-facing assistant response for the latest user turn in this Dayloom Play Session.
Use the authoritative context and the completed reasoning from this run.
Return natural-language content only.
Do not emit PlaySubmission JSON or internal protocol data.
```

### 15.3 Submit Final prompt V1

`react/final-submit.md` 固定要求 Final 为 exactly one JSON object：

```text
Produce the final machine result for this Dayloom Play Session.
Return exactly one JSON object and nothing else. Do not use Markdown fences.
Do not choose or change the day. Use the existing plan beat ids exactly.

Schema:
{
  "version": 1,
  "summary": "non-empty string",
  "beats": [
    {
      "id": "existing plan beat id",
      "status": "pending | completed | skipped",
      "eventId": "event id or null"
    }
  ],
  "events": [
    {
      "id": "unique event id",
      "beatId": "existing plan beat id or null",
      "userInput": "non-empty string",
      "assistantOutput": "non-empty string"
    }
  ]
}
```

这些文件是 Core2 private runtime prompt，不是 Promptpile Conversation artifact。

---

## 16. Conversation append contract 冻结

Core2 不使用 `promptpile-react --input`。

所有 application/user-role append 都调用：

```text
promptpile conversation append-user
  -d <targetDirectory>
  --quiet
```

完整 UTF-8 content 写 child stdin 后关闭 stdin。

成功条件：`exit code == 0`。

spawn / non-zero → `CONVERSATION_FAILED`。

Core2 不支持并发，因此 MVP 不使用 Promptpile fingerprint / expected-next-index OCC 参数。

---

## 17. Play Session start / immutable context 冻结

`startSession('play')`：

```text
validate capability
→ pin revision / commitId / rootTreeHash / day
→ create sessionId
→ create context/ + conversation/ + react/
→ write Core2-owned prompt files
→ derive send.toml + submit.toml from caller LLM config
→ append exactly one context message to context/ via Promptpile CLI
→ activate Session.ready
```

任何一步失败：

```text
no active Session
World unchanged
return NOT_AVAILABLE / CONVERSATION_FAILED / INTERNAL_ERROR
```

### Pinned base

```ts
interface PinnedWorldBase {
  revision: number;
  commitId: string;
  rootTreeHash: string;
  day: string;
}
```

### Immutable context message V0

该 message 只承载 validated data，不承担 system-instruction authority：

```text
[DAYLOOM_PLAY_CONTEXT_V0]

[WORLD]
world_id: <worldId>
day: <day>

[CANON_PREMISE]
<canon/premise.md>

[CANON_RULES]
<canon/rules.md>

[CANON_STYLE]
<canon/style.md>

[CANON_USER_ROLE]
<canon/user-role.md>

[PLAN_JSON]
<validated plan serialized with JSON.stringify(plan, null, 2)>
```

Core2 生成文本，但通过 Promptpile CLI append；不直接制造 artifact。

---

## 18. React invocation 冻结

所有 React run 都显式固定 Conversation topology，不允许 config 决定目录。

### Send run

```text
promptpile-react
  --config <session/react/send.toml>
  -d <session/context>
  --output-dir <session/conversation>
  --continue
  --max-step 1
  --quiet
  --output-format stream-json
```

### Submit run

相同，只把 config 换成：

```text
--config <session/react/submit.toml>
```

规则：

```text
不传 --input
不传 --tools-file
不传 --after-hook-path
context/ 只读输入层
conversation/ 唯一 writable/output layer
```

Promptpile/React 负责把 writable output layer 作为最后一个 Conversation input layer。

---

## 19. Agent Event Protocol consumption 冻结

每一行 stdout：

```text
UTF-8 line
→ JSON.parse
→ packaged Agent Event v1 schema validation
→ Core2 stream invariants
```

Core2 只验证跨 event 的 transport/terminal invariants，不重新验证 React phase FSM。

必须满足：

```text
first event.type == session.started
first event.sequence == 0
all events share one non-empty session_id
next sequence == previous sequence + 1
exactly one terminal event
terminal event is final protocol event
terminal is session.completed for success
terminal.final.status == completed
process exit code == 0
```

普通 send 中：

```text
concat(final.delta.content) == session.completed.final.content
```

Submit 中同样验证完整 Final content，但 deltas 只进入 private buffer。

以下任一情况 → `AGENT_FAILED`：

```text
spawn failure
malformed JSONL
schema-invalid event
sequence gap / duplicate / reorder
session_id changes
missing/duplicate terminal
session.failed
final skipped
Final delta/content mismatch
non-zero exit
event after terminal
```

Core2 不检查 Thought/Observe/Check 的内部 phase 顺序；那属于 Promptpile React ownership。

---

## 20. send() contract 冻结

`send(text)`：

```text
validate ready
→ text.trim() non-empty
→ state = running; emit state.changed
→ promptpile append-user(text) to writable conversation/
→ run React with send.toml
→ final.delta → public output.delta
→ success: state = ready; emit state.changed; return ok
```

如果 user append 已成功而 React 随后失败：

```text
no rollback
no retry
Session terminal
World unchanged
state → idle
return AGENT_FAILED
```

---

## 21. submit() contract 冻结

`submit()` 只在 `ready` 合法。

先向 writable `conversation/` append 一条内部 marker：

```text
[DAYLOOM_PLAY_SUBMIT_V1]
Finalize this Session now using the Core2 submission Final contract.
```

真正的 JSON schema / authority 来自 Core2-owned `final-submit.md` system prompt，不依赖这条 user-role marker。

流程：

```text
state = submitting; emit state.changed
→ append submission marker
→ run React with submit.toml
→ buffer Final internally; no public output.delta
→ parse PlaySubmissionV1
→ validate against pinned PlayPlanV0
→ build deterministic World document bytes
→ Archive Protocol candidate validation
→ publication
→ reload Published World
→ session = null; emit state.changed
→ return ok
```

任何 submission failure 终止 Session；MVP 不在同一失败 Session 中 retry submit。

---

## 22. PlaySubmissionV1 / business validation 冻结

```ts
export interface PlaySubmissionV1 {
  version: 1;
  summary: string;
  beats: Array<{
    id: string;
    status: 'pending' | 'completed' | 'skipped';
    eventId: string | null;
  }>;
  events: Array<{
    id: string;
    beatId: string | null;
    userInput: string;
    assistantOutput: string;
  }>;
}
```

Strict JSON parser：

```text
top-level object only
version === 1
all required fields present
unknown fields rejected at every object level
summary.trim() non-empty
beats/events arrays required
all ids trim non-empty
event userInput / assistantOutput trim non-empty
status exact enum
nullable refs only string|null
```

Business validation：

```text
submission beats count == pinned plan beats count
submission beat ids exactly match plan ids in order
submission event ids unique
non-null beat.eventId references existing event
non-null event.beatId references existing plan beat
beat.eventId → event.beatId must equal same beat id
```

失败 → `SUBMISSION_INVALID`。

Model 无权提交 day、beat intent 或 Archive Protocol object。

---

## 23. Persisted Play documents 冻结

Validated submission 只产生：

```text
days/<pinnedDay>/play.json
days/<pinnedDay>/summary.md
```

### play.json

Core2 从 validated plan + submission 重建：

```ts
interface PersistedPlayV1 {
  version: 1;
  beats: Array<{
    id: string;
    intent: string;
    status: 'pending' | 'completed' | 'skipped';
    eventId: string | null;
  }>;
  events: Array<{
    id: string;
    beatId: string | null;
    userInput: string;
    assistantOutput: string;
  }>;
}
```

`intent` 只复制 pinned plan，不信任 model。

Bytes：

```ts
new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n')
```

### summary.md

```ts
new TextEncoder().encode(submission.summary.trimEnd() + '\n')
```

Pinned tree 已存在同 day `play.json` 或 `summary.md` → `SUBMISSION_INVALID`；MVP 不覆盖 published history。

---

## 24. Archive staging / publication 冻结

两个 PUT：

```text
hashBlobV1(bytes)
bytes.byteLength
play.json  mediaType = application/json
summary.md mediaType = text/markdown
fileId = crypto.randomUUID()
```

构造并 parse `StagingManifestV1`：

```text
baseRevision = pinned revision
baseCommitId = pinned commitId
baseRootTreeHash = pinned rootTreeHash
changes = protocol canonical path order
```

Candidate 必须使用：

```text
buildCandidateTreeV1({ baseTree, staging })
hashRootTreeV1(candidateTree)
```

Core2 不手写 tree merge。

### Publication critical section

```text
atomic acquire .locks/publish.lock
→ reread + validate current/currentCommit/currentTree
→ require pinned revision/commit/tree still identical
→ build/parse prepared ArchiveOperationV2
→ build/parse target ArchiveCommitV2
→ validateOperationStagingRelationV2
→ validateCommitParentRelationV2
→ validatePreparedTargetRelationV2
→ materialize immutable blobs/tree/commit/prepared operation
→ final atomic replacement of current.json
→ visible target verification
→ optional operation status published diagnostic update
→ release ownership
```

不能取得 lock 或 pinned base 改变 → `WORLD_CONFLICT`；不等待、不 merge、不 rebase、不 retry。

Target control：

```text
phase = awaiting-settle
day = pinned day
lastSettledDay = parent.lastSettledDay
```

`current.json` replacement 是**最后 visibility step**。

Replacement 之前失败：不得有新 Published World。

Replacement 之后如果仅 diagnostic/operation-status update 失败：不得假装 publication 回滚；以 visible current 为 public truth。

---

## 25. Failure / dispose 冻结

### startSession failure

```text
World unchanged
no active Session
partial private Session workspace may be removed
return NOT_AVAILABLE / CONVERSATION_FAILED / INTERNAL_ERROR
```

### send failure

```text
Session terminal
World unchanged
state → idle
return CONVERSATION_FAILED / AGENT_FAILED
```

### cancel

只在 `ready`：

```text
remove active Session
World unchanged
state → idle
return ok
```

### submit pre-visibility failure

```text
Session terminal
no new current visible
state → idle
return corresponding error
```

### dispose

```text
idempotent
mark disposed immediately
terminate active child if any
clear subscribers
remove private runtime root recursively
never modify Published World
```

Dispose 后 mutation → `DISPOSED`。

---

## 26. Future compression compatibility invariant

`promptpile-compress` **不进入 MVP dependency**。

但当前 Conversation topology 必须保证以后接入 compression 不需要重构 Session/React 边界：

```text
context/      = immutable input layer, never compressed
conversation/ = only writable lifecycle directory
```

未来如果接入，只允许对 writable directory 使用 Promptpile Compress 的 lifecycle boundary：

```text
runCompressionBeforeCompletion({
  compression: { directory: conversationDir, ... },
  completion: () => runPromptpileReact(...)
})
```

其意义仅是：compression 完成并释放其 directory lifecycle lock 后再开始 completion。

MVP **不创建** `ConversationMaintenance`、compression plugin 或 generic lifecycle abstraction。

---

## 27. 最小源码结构冻结

```text
packages/core2/
├── package.json
├── scripts/
│   └── check-architecture.mjs
├── src/
│   ├── index.ts
│   ├── core.ts
│   ├── state.ts
│   ├── events.ts
│   ├── errors.ts
│   ├── world/
│   │   ├── read.ts
│   │   └── publish.ts
│   ├── session/
│   │   └── play.ts
│   └── promptpile/
│       ├── binaries.ts
│       ├── config.ts
│       ├── conversation.ts
│       └── react-runner.ts
└── test/
```

不得预先创建：

```text
provider/
adapters/
commands/
plugins/
maintenance/
scheduler/
compat/
tui/
recovery/
```

---

## 28. 实施顺序冻结

### Step 0 — package + guards

```text
package.json
public index shell
forbidden-import architecture guard
```

### Step 1 — World read

```text
Archive graph validation
blob/document reader
PlayPlanV0 + canon validation
CoreWorldView / capabilities
```

### Step 2 — Promptpile packaged boundaries

```text
binary resolution
Agent Event packaged schema resolution + Ajv compile
caller LLM config ownership guard
private runtime root
```

### Step 3 — Session topology

```text
context/ + conversation/ + react/
Core2-owned prompts
derived send/submit React config
Promptpile append-user wrapper
startSession('play')
```

### Step 4 — Normal React turn

```text
explicit layered invocation
Agent Event schema + stream invariant validation
send()
public output.delta
```

### Step 5 — Submission

```text
submission marker
submit Final config
PlaySubmissionV1 parser
business validation
deterministic play/summary bytes
```

### Step 6 — Publication

```text
staging/candidate
exclusive ownership
pinned-base recheck
immutable target graph
atomic current replacement
failure semantics
```

### Step 7 — API hardening

```text
BUSY
dispose
listener isolation
full acceptance suite
```

完成 Step 7 即完成 Core2 MVP。

**不存在 TUI adapter Step。**

---

## 29. Acceptance tests 冻结

至少必须有：

```text
core2-rejects-caller-promptpile-react-table
core2-rejects-caller-conversation-or-tool-or-hook-config
core2-preserves-llm-profile-data-in-derived-config
core2-derived-config-owns-max-step-and-prompt-paths
core2-resolves-packaged-promptpile-binaries
core2-resolves-and-compiles-packaged-agent-event-schema
core2-does-not-copy-agent-event-schema

core2-init-validates-current-graph
core2-init-rejects-invalid-current-graph
core2-init-rejects-malformed-planned-context
core2-play-only-available-from-planned-world-with-day

core2-start-play-does-not-publish-world
core2-start-play-creates-immutable-context-and-writable-conversation
core2-context-is-appended-via-promptpile-cli
core2-never-writes-promptpile-message-files-directly
core2-user-turns-never-append-to-context-layer
core2-two-turns-share-one-writable-conversation

core2-react-explicitly-uses-context-plus-output-conversation
core2-react-max-step-is-one
core2-react-does-not-enable-application-tools-or-hooks
core2-rejects-malformed-agent-event
core2-rejects-agent-event-schema-violation
core2-allows-schema-forward-compatible-optional-fields
core2-rejects-sequence-gap-or-session-id-change
core2-rejects-final-delta-content-mismatch
core2-send-streams-only-final-deltas
core2-submit-does-not-expose-json-output

core2-parses-valid-play-submission-v1
core2-rejects-unknown-submission-fields
core2-validates-submission-against-pinned-plan
core2-does-not-trust-model-day-or-beat-intent
core2-play-json-has-frozen-bytes
core2-summary-has-single-trailing-lf
core2-rejects-play-history-overwrite

core2-builds-candidate-with-archive-protocol-api
core2-conflicting-pinned-base-fails-closed
core2-does-not-wait-for-publish-lock
core2-validates-prepared-target-relations
core2-current-replacement-is-final-visibility-step
core2-submit-publishes-awaiting-settle-exactly-once
core2-previsibility-failure-leaves-current-unchanged
core2-postvisibility-diagnostic-failure-does-not-report-false-rollback

core2-rejects-second-mutation-with-busy
core2-cancel-ready-session-leaves-world-unchanged
core2-rejects-cancel-while-running
core2-dispose-is-idempotent-and-does-not-publish
core2-architecture-guard-rejects-legacy-core-tui-and-deep-imports
```

Acceptance tests 只验证 `@dayloom/core2` public contract 与 infrastructure boundaries，不加入任何 TUI component/driver/adapter compatibility test。

---

## 30. Definition of Done

Core2 MVP 同时满足以下条件才完成：

1. `packages/core2` 不依赖 legacy Core 或 presentation package；
2. 只读取/发布 Archive V2；
3. Archive Protocol public APIs 是 persistence correctness 的唯一来源；
4. caller 只提供 LLM/provider config，不能控制 React Conversation topology、prompt、tools、hook 或 max-step；
5. React orchestration config 与 Dayloom system prompts 由 Core2 runtime 生成；
6. Agent Event validation 使用 `promptpile-react` 随包 normative schema，不复制协议 schema；
7. Core2 不重新实现 React FSM；
8. Planned World 的 canon + plan context 在 initialization 得到验证；
9. start Play 不发布 World；
10. 每个 Session 有 immutable context layer + 唯一 writable Conversation；
11. Context/user/submission append 全部通过 Promptpile public CLI；
12. Core2 从不直接制造 Promptpile message / receipt artifact；
13. 普通 Final delta 可公开，submission JSON Final 不公开为 presentation output；
14. Core2 不支持并发，第二个 mutation 立即 `BUSY`；
15. agent failure 不 retry、不 resume；
16. `PlaySubmissionV1` strict parse + pinned-plan validation 后才能形成 mutation；
17. model 无权选择 day、beat intent 或 protocol object；
18. persisted play/summary bytes 由 Core2 从 validated values 重建；
19. candidate tree 使用 `buildCandidateTreeV1()`，不手写 merge；
20. publication 在 exclusive ownership 下重新验证 pinned base；
21. target operation/staging/commit/tree relations 通过 Archive Protocol validators；
22. `current.json` atomic replacement 是最后 visibility step；
23. replacement 前失败不产生新 Published World；
24. replacement 后不得假装 publication 被回滚；
25. submit 成功后 phase 为 `awaiting-settle` 且 day 保持 pinned day；
26. current Conversation topology 可让未来 compression 只包裹 writable `conversation/`，无需重构 Core2；
27. MVP 不包含 TUI adapter、Compress、MCP、migration、plugin、scheduler 或 recovery framework；
28. 本文 Acceptance tests 全部通过。

---

## 31. 最终原则

```text
Archive Protocol owns persisted-data correctness.
Promptpile owns Conversation artifacts.
Promptpile React owns agent orchestration and Agent Event Protocol.
Core2 owns Dayloom business legality, React invocation policy, Session lifecycle and World publication.
Consumers own presentation.
```

实施原则：

```text
只实现当前闭环需要的 abstraction。
不为旧 Core 保留兼容形状。
不为现有 TUI 设计专用接口。
不让 caller config 穿透 Core2 ownership。
不复制 Promptpile / React 已经拥有的协议。
不为不存在的第二实现设计插件层。
不为不存在的并发需求设计并发系统。
不为尚未接入的 Compress 设计 framework。
```

最终闭环：

```text
World
→ validated immutable context
→ writable Conversation
→ Core2-controlled React invocation
→ packaged Agent Event schema
→ user Final | validated Submission
→ Archive Protocol candidate
→ atomic Publication
→ World
```
