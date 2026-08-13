# Dayloom Core2 实现冻结

> 状态：**Implementation Freeze / 可直接实施**  
> 日期：2026-08-13  
> 目标包：`@dayloom/core2`

本文冻结 Core2 MVP 的行为、边界、public contract 与实施顺序。

实施阶段允许决定局部代码写法，但**不得再决定系统应该如何工作**。如果实现发现必须改变本文冻结的 public API、状态转换、持久化语义或 Promptpile 集成方式，应先修改本文，再修改实现。

---

## 1. 唯一目标

建立一个独立、最小、只有一套语义的新 Core：

```text
@dayloom/core2
= Archive V2 only
= Play Session MVP
= one disk Conversation per Session
= promptpile-react execution
= validated submission
= Archive V2 publication
```

完成链路只有：

```text
Published World
→ Play Session
→ Promptpile Conversation
→ Promptpile React turns
→ PlaySubmissionV1
→ Archive Protocol validation
→ Publication
→ Published World
```

任何不能直接服务这条链路的设计默认不进入 MVP。

旧 `@dayloom/core` / `@dayloom/core-old` 只可作为产品行为参考，不是 API、类型、目录结构或内部架构兼容目标。

---

## 2. Consumer 边界

本草案**只实施 `@dayloom/core2`**。

现有 TUI 不属于本草案的任务：

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

Core2 必须只使用它的 public exports 来完成：

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

### 3.2 Promptpile ecosystem

Promptpile owns Conversation artifact I/O。

Promptpile React owns agent orchestration。

Core2 只拥有：

```text
Conversation 与 Session 的关联
Conversation directory 的位置与生命周期
何时 append Core2/user 输入
何时运行 React
如何消费公开 Agent Event Protocol
```

Core2 **不得直接创建、命名、修改 Promptpile message / receipt artifacts**。

所有 Conversation append 必须通过 Promptpile 公共 CLI。

Core2 不重新实现 Thought → Observe → Check → Final FSM。

### 3.3 Core2

Core2 owns：

```text
World application read model
Play legality
Session lifecycle
Promptpile / Promptpile React process invocation
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
MCP tools
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

`packages/core2/package.json` 必须满足：

```json
{
  "name": "@dayloom/core2",
  "engines": { "node": ">=20" },
  "dependencies": {
    "@dayloom/archive-protocol": "0.0.0",
    "promptpile": "0.1.0-beta.2",
    "promptpile-react": "0.1.0-beta.3"
  }
}
```

`promptpile` 是 direct dependency，因为 Core2 需要稳定使用其公开 `conversation append-user` CLI；不得依赖 `promptpile-react` 的 transitive dependency 偶然存在。

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

允许：

```text
@dayloom/archive-protocol
@dayloom/archive-protocol/path
@dayloom/archive-protocol/tree
@dayloom/archive-protocol/staging
```

Promptpile 与 Promptpile React 都只通过 packaged executable/public protocol 使用。

---

## 6. Core initialization 冻结

### 6.1 Public options

```ts
export interface CreateDayloomCoreOptions {
  worldRoot: string;
  reactConfigPath: string;
}
```

`worldRoot` 和 `reactConfigPath` 在创建时都转换为 absolute path。

Core2 不解析或复制 Promptpile React 的 provider 配置语义；`reactConfigPath` 原样传给 `promptpile-react --config`。

Core2 的 Dayloom semantic instructions 来自本文定义的 Conversation bootstrap / submission request，不依赖 consumer 自定义 React prompt 文件。

### 6.2 初始化 World read

`createDayloomCore()` 必须依次读取并验证：

```text
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

初始化只要求 current graph 的结构正确；blob 在真正读取 document 时使用 `verifyBlobV1()` 校验 bytes/hash/length。

任何缺失、parse failure、relation failure、tree hash mismatch 均使 `createDayloomCore()` reject。

MVP **不创建“invalid-but-running Core instance”**。因此 public `CoreState` 没有 `world.status = invalid` 分支。

### 6.3 Initialization error

创建失败 reject：

```ts
export class CoreInitializationError extends Error {
  readonly code: 'INVALID_OPTIONS' | 'WORLD_INVALID' | 'INTERNAL_ERROR';
}
```

规则：

```text
worldRoot / reactConfigPath 参数或路径明显非法 → INVALID_OPTIONS
Archive V2 graph / required Dayloom document 非法 → WORLD_INVALID
其它不可分类 I/O / process 初始化错误 → INTERNAL_ERROR
```

---

## 7. Dayloom World Profile V0

Core2 MVP 只认识以下 application document paths：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md
days/<day>/plan.json
days/<day>/play.json
days/<day>/summary.md
```

所有 path 必须经过 `@dayloom/archive-protocol` public path normalization/validation。

### 7.1 PlayPlanV0

当 current commit 为：

```text
phase = planned
day != null
```

Core2 必须读取并严格解析：

```text
days/<day>/plan.json
```

其 application schema 冻结为：

```ts
export interface PlayPlanV0 {
  intent: string;
  beats: Array<{
    id: string;
    intent: string;
  }>;
}
```

严格规则：

```text
top-level / beat unknown fields rejected
intent non-empty after trim
beats must be array
beat id non-empty and unique
beat intent non-empty after trim
```

同时读取四个 canon markdown document。四个 document 都必须存在，且按 UTF-8 解码；空文本允许，因为内容策略不是 Archive Protocol correctness。

读取任一 document 时必须验证 tree entry 对应 blob 的 bytes/hash。

planned World 的 required Play context 缺失或 malformed 时，Core initialization 以 `WORLD_INVALID` 失败。

其它 phase 不要求预读 Play context。

---

## 8. Public World / State V0 冻结

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
```

`revision` 是 Archive V2 revision number，不是 string。

Capability 规则冻结为：

```text
startSessions = ['play'] iff:
  world.phase == planned
  && world.day != null
  && no active Session
  && no mutation in flight

send   = session.status == ready && no mutation in flight
submit = session.status == ready && no mutation in flight
cancel = session.status == ready && no mutation in flight
```

Capability 是 application legality projection，不包含 label、selection、page、loading text 等 presentation 信息。

---

## 9. Public API / Result V0 冻结

```ts
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

Application mutation 统一返回：

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

预期 application failure 不 throw。

只有 programmer/runtime invariant breach 可以在内部 throw；public boundary 必须转为 `INTERNAL_ERROR`。

`dispose()` idempotent。

任何 mutation 在 disposed 后返回 `DISPOSED`。

---

## 10. Public Event V0 冻结

只有一套 public event vocabulary：

```ts
export type CoreEvent =
  | { type: 'state.changed'; state: CoreState }
  | { type: 'output.delta'; sessionId: string; text: string };
```

冻结语义：

```text
subscribe() 不立即回放 state；初始状态用 getState()
state.changed 在 public state 已完成 mutation 后同步顺序 dispatch
同一 Core instance 不并发 dispatch listener
listener exception 不得破坏 Core 状态；应隔离并继续通知其它 listener
```

`output.delta` 只用于普通 `send()` 的用户可见 Final。

**submit() 的 JSON Final 是内部机器结果，绝不 emit `output.delta`。**

不暴露 Thought / Observe / Check、tool args、Promptpile raw event 或 submission JSON streaming。

---

## 11. 单执行流状态机冻结

Core2 不支持并发。

Public Session 状态只有：

```text
idle        = session == null
ready       = Play Session 可接受 send / submit / cancel
running     = 普通 React turn 正在执行
submitting  = submission append / React / validation / publication 正在执行
```

转换：

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

实现必须有一个 private mutation-in-flight guard。

任何 operation 尚未结束时收到第二个 mutation，第二个调用立即返回 `BUSY`；不 queue、不等待前一个 operation。

`cancel()` 只在 `ready` 合法；MVP 不支持边生成边 cancel。

---

## 12. Runtime-private workspace 冻结

Core2 **不得在 Archive root 中发明 `.core2/` 等 Archive Protocol 未定义布局**。

每个 Core instance 创建一个 OS temporary runtime root：

```text
<os.tmpdir()>/dayloom-core2-<mkdtemp>/
└── sessions/
    └── <sessionId>/
        └── conversation/
```

`sessionId = crypto.randomUUID()`。

这个目录不是 Archive Protocol 数据，也不是 public API。

语义：

```text
一个 Session 的 bootstrap / user turns / submission run 共用同一个 conversation/
不同 Session 不复用 Conversation
process restart 不恢复 Session
Core instance dispose 后 recursive remove 整个 private runtime root
```

因此 MVP 中“persistent Conversation”的精确定义是：

> Conversation 是跨多个 turn 持续存在的同一个磁盘目录，而不是每个 turn 创建临时目录并重放历史；它不承诺跨 Core instance 恢复。

Core2 不维护第二份 `messages[]` authority。

---

## 13. Promptpile executable resolution 冻结

Core2 不依赖 PATH 中恰好存在可执行文件。

分别读取 direct dependency package metadata：

```text
promptpile/package.json        → bin.promptpile
promptpile-react/package.json  → bin.promptpile-react
```

解析 packaged bin absolute path，然后通过当前 `process.execPath` 启动：

```text
node <resolved-promptpile-bin> ...
node <resolved-promptpile-react-bin> ...
```

找不到 package metadata / bin 时，相关 operation 返回 `INTERNAL_ERROR`；初始化可以提前验证并以 `INTERNAL_ERROR` reject。

不得 import 两个包的 runtime internals。

---

## 14. Conversation append contract 冻结

Core2 不使用 `promptpile-react --input`。

原因是 Core2 需要 machine-only stdout，而 user append 本身已经有 Promptpile 的独立公开 CLI。

所有写入 Conversation 的 user-role artifact 都统一调用：

```text
promptpile conversation append-user
  -d <conversationDir>
  --quiet
```

stdin 为完整 UTF-8 message，随后关闭 stdin。

成功条件：

```text
exit code == 0
```

非零退出、spawn failure → `CONVERSATION_FAILED`。

由于 Core2 明确不支持并发，不在 MVP 使用 Promptpile fingerprint / expected-next-index OCC 参数。

---

## 15. Play Session start 与 bootstrap 冻结

`startSession('play')`：

```text
validate current capability
→ pin current revision / commitId / rootTreeHash / day
→ create sessionId
→ create conversation directory
→ append exactly one Core2 bootstrap message via promptpile CLI
→ bootstrap append success
→ activate Session.ready
```

任何一步失败：

```text
no active Session
World unchanged
return corresponding error
```

Bootstrap 不 emit `output.delta`。

### 15.1 Pinned base

Active Play Session private state 至少保存：

```ts
interface PinnedWorldBase {
  revision: number;
  commitId: string;
  rootTreeHash: string;
  day: string;
}
```

### 15.2 Bootstrap message V0

Bootstrap 是 Core2 内部 user-role message，固定结构：

```text
[DAYLOOM_PLAY_SESSION_V0]
You are running a Dayloom Play Session.
Continue the current planned day through natural-language interaction with the user.
Do not invent a different day. Treat the supplied canon and plan as authoritative context.
Normal Final answers must be user-facing natural language.
A later internal submission request will explicitly ask for machine JSON; do not emit that JSON before requested.

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

Core2 负责生成这段文本，但仍通过 Promptpile CLI append；不直接创建 Promptpile artifact。

---

## 16. 普通 send() contract 冻结

`send(text)`：

```text
validate ready
→ text.trim() must be non-empty
→ state = running; emit state.changed
→ promptpile append-user(text)
→ run promptpile-react
→ stream user-visible Final deltas
→ success: state = ready; emit state.changed; return ok
```

React invocation 固定为：

```text
promptpile-react
  --config <absolute reactConfigPath>
  --output-dir <conversationDir>
  --continue
  --output-format stream-json
```

不传 `--input`。

stdout 必须逐行解析 Agent Event Protocol v1 JSONL；stderr 只作为 diagnostics。

成功必须同时满足：

```text
收到一个合法 session.completed terminal event
terminal.final.status == completed
process exit code == 0
没有 malformed / out-of-order protocol event
```

`final.delta` 按 protocol sequence 顺序 emit 为 `output.delta`。

`session.completed.final.content` 是完整 Final authority；实现必须验证它与已收到 `final.delta` 拼接文本一致，否则视为 `AGENT_FAILED`。

以下任一情况 → `AGENT_FAILED`：

```text
spawn failure
malformed JSONL
schema-invalid event
sequence 非严格递增
session.failed
缺失 terminal event
多个 terminal event
final skipped
Final delta/content mismatch
non-zero exit
terminal 之后出现额外 protocol event
```

如果 user append 已成功而 React 随后失败，Core2 不 rollback、不 retry；Session terminal failure，回到 idle，World unchanged。

---

## 17. submit() contract 冻结

`submit()` 只在 `ready` 合法。

流程：

```text
state = submitting; emit state.changed
→ append Core2 submission request to same Conversation
→ run same promptpile-react invocation
→ buffer Final internally; do not emit output.delta
→ parse PlaySubmissionV1
→ validate against pinned PlayPlanV0
→ construct World document bytes
→ protocol candidate validation
→ publication
→ reload published World
→ session = null; emit state.changed
→ return ok
```

任何 submission failure 终止 Session，回到 idle；不允许用户在同一个失败 Session 中 retry submit。

### 17.1 Submission request V0

Core2 append 的内部 message 固定要求：

```text
[DAYLOOM_PLAY_SUBMIT_V1]
Return the final result of this Play Session as exactly one JSON object and nothing else.
Do not use Markdown fences.
Do not choose or change the current day.
Use the existing plan beat ids exactly.

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

Submission React invocation 与普通 turn 相同，但 `final.delta` 只写入内部 buffer，不产生 public output event。

---

## 18. PlaySubmissionV1 与 business validation 冻结

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

JSON strict parser：

```text
top-level object only
version === 1
all required fields present
unknown fields rejected at every object level
summary.trim() non-empty
beats/events arrays required
all string ids trim non-empty
event userInput / assistantOutput trim non-empty
status exact enum
nullable refs only string|null
```

Business validation 必须继续证明：

```text
submission beats 数量 == pinned plan beats 数量
submission beat ids 与 plan beat ids 顺序完全相同
submission event ids 全部唯一
每个 non-null beat.eventId 必须引用存在的 event
每个 non-null event.beatId 必须引用存在的 plan beat
如果 beat.eventId 指向 event，则该 event.beatId 必须等于该 beat.id
```

任一失败 → `SUBMISSION_INVALID`。

`day` 不允许由模型提交；目标 day 永远来自 pinned base。

---

## 19. Persisted Play documents 冻结

Validated submission 只产生两个 PUT：

```text
days/<pinnedDay>/play.json
days/<pinnedDay>/summary.md
```

### 19.1 play.json

Core2 从 validated plan + validated submission **重新构造** object：

```ts
interface PersistedPlayV1 {
  version: 1;
  beats: Array<{
    id: string;
    intent: string; // copied from pinned PlayPlanV0, never trusted from model
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

UTF-8 bytes 精确规则：

```ts
new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n')
```

不保存 model 原始 JSON bytes。

### 19.2 summary.md

精确 bytes：

```ts
new TextEncoder().encode(submission.summary.trimEnd() + '\n')
```

### 19.3 overwrite rule

Pinned base tree 中如果已经存在：

```text
days/<day>/play.json
或 days/<day>/summary.md
```

Play submit 必须以 `SUBMISSION_INVALID` fail closed；MVP 不允许 Play 覆盖已发布历史。

---

## 20. Archive staging / candidate 冻结

对两个 persisted document：

```text
hashBlobV1(bytes)
bytes.byteLength
mediaType
fileId = crypto.randomUUID()
```

media type 固定：

```text
play.json   → application/json
summary.md  → text/markdown
```

构造 `StagingManifestV1`：

```text
schemaVersion = 1
baseRevision = pinned revision
baseCommitId = pinned commitId
baseRootTreeHash = pinned rootTreeHash
changes = 两个按 protocol canonical path order 排序的 put
```

必须通过：

```text
parseStagingManifestV1
buildCandidateTreeV1({ baseTree, staging })
```

candidate tree hash 使用：

```text
hashRootTreeV1(candidateTree)
```

Core2 不手写 tree merge 算法。

---

## 21. Publication transaction 冻结

Core2 是 Archive Protocol 的 mutating consumer；I/O transaction 在 `world/publish.ts` 内实现。

### 21.1 Operation identity

每次 submit publication：

```text
operationId = crypto.randomUUID()
commitId    = crypto.randomUUID()
newRevision = pinned revision + 1
```

operation type 固定：

```text
core2.play.submit
```

### 21.2 Exclusive publication ownership

Core2 使用 Archive root：

```text
.locks/publish.lock
```

作为 publication ownership file。

MVP 不等待已有 lock，不排队：无法原子取得 ownership → `WORLD_CONFLICT`。

lock file 仅保护 publication critical section；异常退出后的 stale-lock recovery 不进入 MVP。实现测试必须可以显式清理 fixture lock。

### 21.3 Pinned-base recheck

取得 exclusive ownership 后重新读取：

```text
current.json
current commit
current root tree
```

并重新运行 protocol parse/relation/hash validation。

必须满足：

```text
current.revision == pinned.revision
current.commitId == pinned.commitId
currentCommit.rootTreeHash == pinned.rootTreeHash
```

否则 `WORLD_CONFLICT`；不 rebase、不 merge、不 retry。

### 21.4 Target objects

在 visibility change 之前必须完整准备：

```text
2 blob objects
candidate root tree object
ArchiveCommitV2 target commit
ArchiveOperationV2 prepared operation record
```

target commit control 固定：

```text
phase = awaiting-settle
day = pinned day
lastSettledDay = parent commit control.lastSettledDay
```

Target objects 必须分别通过 public parsers，并满足：

```text
validateOperationStagingRelationV2
validateCommitParentRelationV2
validatePreparedTargetRelationV2
```

root tree 写入使用 `encodeRootTreeCanonicalV1()` bytes。

blob path / tree path / commit path / operation path 必须来自 Archive Protocol public layout formatter/constants。

### 21.5 Immutable object write

Blob/tree/commit 是 immutable objects：

```text
目标不存在 → atomic create/write
目标已存在且 bytes 完全一致 → 可视为 already materialized
目标已存在但 bytes 不一致 → INTERNAL_ERROR / fail closed
```

### 21.6 Final visibility step

只有全部 target object 已写入并验证后，才生成新的 `CurrentPointerV2`。

`current.json` replacement 必须是**最后一个 visibility step**：

```text
write temporary file in same directory
→ fsync/close as implementation requires
→ atomic rename/replace current.json
```

只有该 replacement 成功后 `submit()` 才能返回 `{ ok: true }`。

随后 operation record 可以标为 `published`；如果 post-visibility diagnostic write 失败，不得把已经成功的 World publication 对 caller 谎报为“未发布”。这种异常应记录 diagnostics，但 public result 仍按 visible current 判定。

最后释放 publication ownership。

---

## 22. Failure semantics 冻结

### 22.1 startSession failure

```text
World unchanged
no active Session
临时 Session directory 可清理
return NOT_AVAILABLE / CONVERSATION_FAILED / INTERNAL_ERROR
```

### 22.2 send failure

```text
如果 append 或 React 失败：
Session terminal
active Session removed
World unchanged
state → idle
return CONVERSATION_FAILED 或 AGENT_FAILED
```

### 22.3 cancel

`cancel()` 只在 ready 合法：

```text
remove active Session
World unchanged
state → idle
return ok
```

Conversation 不 rollback；private runtime root 在 dispose 时统一删除。

### 22.4 submit failure before current replacement

包括：

```text
conversation append failure
React failure
submission parse/business failure
protocol candidate failure
lock conflict
pinned-base conflict
I/O failure before current replacement
```

统一：

```text
no new current World visible
Session terminal
state → idle
return corresponding error
```

### 22.5 failure after current replacement

`current.json` 已成功指向 target commit 后，World 已发布。

后续仅 diagnostic/operation-status cleanup 失败时：

```text
不得尝试回滚 current
reload visible current
return ok if visible current is target
```

---

## 23. dispose() 冻结

`dispose()`：

```text
idempotent
mark disposed immediately
if child process exists → terminate child
clear subscribers
remove private OS-temp runtime root recursively
```

`dispose()` 不修改 Published World。

dispose 后任何 mutation 返回 `DISPOSED`。

---

## 24. 最小源码结构冻结

第一版保持：

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

只有真实代码复杂度证明需要时才拆分。

---

## 25. 实施顺序冻结

### Step 0 — package + architecture guard

```text
package.json
public index shell
forbidden-import guard
```

### Step 1 — World read

```text
manifest/current/commit/tree validation
blob/document reader
PlayPlanV0 + canon validation
CoreWorldView / capabilities
```

### Step 2 — Promptpile Conversation

```text
packaged binary resolution
private temp runtime root
append-user wrapper
Play bootstrap
startSession('play')
```

### Step 3 — React turn

```text
stream-json parser
protocol sequence/terminal validation
send()
public output.delta
```

### Step 4 — Submission

```text
submission request
internal React Final buffer
PlaySubmissionV1 strict parser
business validation
persisted play/summary byte construction
```

### Step 5 — Publication

```text
staging manifest
candidate tree
exclusive ownership
pinned-base recheck
immutable target graph
atomic current replacement
failure semantics
```

### Step 6 — API hardening

```text
BUSY guard
dispose
listener isolation
architecture guard tests
full acceptance suite
```

完成 Step 6 即完成 Core2 MVP。

**不存在 TUI adapter Step。**

---

## 26. Acceptance tests 冻结

至少必须存在以下行为测试：

```text
core2-init-validates-current-graph
core2-init-rejects-invalid-current-graph
core2-init-rejects-malformed-planned-context
core2-world-revision-is-number
core2-play-only-available-from-planned-world-with-day
core2-start-play-does-not-publish-world
core2-start-play-appends-one-bootstrap-via-promptpile-cli
core2-never-writes-promptpile-message-files-directly
core2-rejects-second-mutation-with-busy
core2-rejects-empty-send
core2-two-turns-share-one-conversation-directory
core2-send-appends-user-before-react
core2-send-streams-final-deltas-in-sequence
core2-rejects-malformed-agent-event
core2-rejects-out-of-order-agent-event
core2-rejects-final-delta-content-mismatch
core2-agent-failure-terminates-session-without-world-change
core2-submit-appends-internal-request-to-same-conversation
core2-submit-does-not-expose-json-as-output-delta
core2-parses-valid-play-submission-v1
core2-rejects-unknown-submission-fields
core2-validates-submission-beats-against-pinned-plan
core2-does-not-trust-model-beat-intent
core2-play-json-has-frozen-bytes
core2-summary-has-single-trailing-lf
core2-rejects-play-history-overwrite
core2-builds-candidate-with-archive-protocol-staging-api
core2-conflicting-pinned-base-fails-closed
core2-does-not-wait-for-publish-lock
core2-validates-prepared-target-relations
core2-current-replacement-is-final-visibility-step
core2-submit-publishes-awaiting-settle-exactly-once
core2-previsibility-submit-failure-leaves-current-unchanged
core2-postvisibility-diagnostic-failure-does-not-report-false-rollback
core2-cancel-ready-session-leaves-world-unchanged
core2-rejects-cancel-while-running
core2-dispose-is-idempotent-and-does-not-publish
core2-architecture-guard-rejects-legacy-core-tui-and-deep-imports
```

Acceptance tests 只验证 `@dayloom/core2` public contract 与 infrastructure boundary。

不加入任何 TUI component / driver / adapter / snapshot compatibility test。

---

## 27. Definition of Done

Core2 MVP 只有同时满足以下条件才完成：

1. `packages/core2` 不依赖 legacy Core 或任何 presentation package；
2. 只读取/发布 Archive V2；
3. Archive Protocol public APIs 是持久化 correctness 的唯一来源；
4. Play legality 完全由 Core2 application rules 决定；
5. Planned World 的 canon + plan context 在初始化时得到验证；
6. start Play 不发布 World；
7. Session bootstrap、user input、submission request 全部通过 Promptpile public CLI append；
8. Core2 从不直接制造 Promptpile message / receipt artifact；
9. 一个 Session 的所有 turns 共用同一磁盘 Conversation；
10. AI execution 只通过 packaged `promptpile-react` executable + Agent Event Protocol v1；
11. 普通 Final delta 可实时公开，submission JSON Final 永不公开为 presentation output；
12. Core2 不支持并发，第二个 mutation 立即 `BUSY`；
13. agent failure 不 retry、不 resume；
14. `PlaySubmissionV1` strict parse + pinned-plan validation 后才能形成 World mutation；
15. model 无权选择 day、beat intent 或 protocol object；
16. play/summary persisted bytes 由 Core2 从 validated values 重建；
17. candidate tree 使用 `buildCandidateTreeV1()`，不手写 merge；
18. publication 在 exclusive ownership 下重新验证 pinned base；
19. target operation/staging/commit/tree relations 通过 Archive Protocol validators；
20. `current.json` atomic replacement 是最后 visibility step；
21. current replacement 前失败不产生新 Published World；
22. current replacement 后不得假装 publication 被回滚；
23. submit 成功后 phase 为 `awaiting-settle` 且 day 保持 pinned day；
24. cancel / send failure / submit previsibility failure 均不发布 World；
25. MVP 不包含 TUI adapter、Compress、MCP、migration、plugin、scheduler 或 recovery framework；
26. 本文 Acceptance tests 全部通过。

---

## 28. 最终原则

```text
Protocol owns persisted-data correctness.
Promptpile owns Conversation artifacts.
Promptpile React owns agent orchestration.
Core2 owns Dayloom business legality, Session lifecycle and World publication.
Consumers own presentation.
```

实施原则：

```text
只实现当前闭环需要的 abstraction。
不为旧 Core 保留兼容形状。
不为现有 TUI 设计专用接口。
不为不存在的第二实现设计插件层。
不为不存在的并发需求设计并发系统。
不为尚未接入的 Compress 设计 framework。
```

冻结后的唯一 MVP 主线是：

```text
World
→ validated Play context
→ Session bootstrap
→ Conversation
→ React turns
→ validated Submission
→ protocol candidate
→ atomic Publication
→ World
```
