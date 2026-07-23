# Archive Format

> **类型**：reference  
> **状态**：implemented  
> **最后核对**：2026-07  
> **代码入口**：`packages/core/src/archive/`、`packages/core/src/schemas/archive.ts`

## 1. 设计目标

存档层需要同时满足：

- 多文件业务操作失败时不污染当前有效状态；
- Runtime 可以通过单一入口读取一致快照；
- cancel、进程崩溃和 AI 失败不要求逐文件回滚；
- 历史业务产物可追踪；
- 未发布 workspace 和 orphan 不参与业务读取；
- 并发发布可以检测基准版本冲突；
- 文件格式具有明确 schema version；
- 未来可以实现校验、诊断和垃圾回收工具。

## 2. 核心模型

存档由四类内容组成：

1. **Manifest**：world 的稳定身份和存档格式版本；
2. **Current Pointer**：唯一可变的已发布入口；
3. **Immutable Objects**：commit、canon revision 和 day revision；
4. **Operation Workspace**：尚未发布的业务操作工作区。

```text
current.json
    |
    v
commits/<commit-id>.json
    |                  |
    v                  v
canon/<revision>/   days/<day>/revisions/<revision>/
```

读取正式业务数据时，必须从 `current.json` 开始沿引用访问。禁止通过“寻找最新文件”或扫描目录推断当前状态。

## 3. 目录结构

```text
world/
├── manifest.json
├── current.json
├── commits/
│   └── <commit-id>.json
├── canon/
│   └── <canon-revision>/
│       ├── manifest.json
│       ├── premise.md
│       ├── rules.md
│       ├── style.md
│       └── user-role.md
├── days/
│   └── day_0001/
│       └── revisions/
│           └── <day-revision>/
│               ├── meta.json
│               ├── plan.json
│               ├── play.json
│               ├── transcript.jsonl
│               ├── settlement.json
│               ├── abandoned.json
│               └── events/
│                   └── event_0001.json
├── operations/
│   └── <operation-id>/
│       ├── operation.json
│       └── workspace/
├── .locks/
│   └── publish.lock
└── logs/
    └── operations.jsonl
```

并非每个 day revision 都包含上面列出的所有文件。文件是否必需由 day status 决定。

## 4. 标识与命名

| 类型 | 格式 | 示例 |
|------|------|------|
| world id | 非空稳定字符串 | `world-lithdoo` |
| day id | `day_` 加至少四位十进制序号 | `day_0001` |
| commit id | `commit_` 加唯一 id | `commit_01J...` |
| canon revision | `canon_` 加唯一 id | `canon_01J...` |
| day revision | `dayrev_` 加唯一 id | `dayrev_01J...` |
| operation id | `op_` 加唯一 id | `op_01J...` |
| event id | day 内稳定唯一 | `event_0001` |

所有 id 一经写入不得复用。路径中的 id 必须先经过格式校验，不允许包含路径分隔符、`.` 或 `..`。

所有时间使用 UTC ISO-8601 字符串。所有 JSON 文件使用 UTF-8、两个空格缩进并以换行结束。

## 5. Manifest

`manifest.json` 在 world 初始化 transaction 中写入。只有 `current.json` 成功发布后它才成为正式身份；如果 current 不存在，遗留 manifest 只是未发布初始化产物，读取时忽略，下一次 init 可以在 publish lock 内校验后替换。current 存在后，manifest 只允许通过明确的 schema upgrade operation 修改。

```ts
export interface ArchiveManifest {
  /** 存档格式版本。 */
  schemaVersion: 1;

  /** world 稳定 id。 */
  worldId: string;

  /** world 标题。 */
  title: string;

  /** 创建时间。 */
  createdAt: string;
}
```

示例：

```json
{
  "schemaVersion": 1,
  "worldId": "world-lithdoo",
  "title": "Lithdoo",
  "createdAt": "2026-07-22T12:00:00.000Z"
}
```

## 6. Current Pointer

`current.json` 是正常运行时唯一需要原子替换的正式入口文件。

```ts
export interface CurrentPointer {
  /** 指针格式版本。 */
  schemaVersion: 1;

  /** 单调递增的发布序号。 */
  revision: number;

  /** 当前已发布 commit。 */
  commitId: string;

  /** 指针发布时间。 */
  updatedAt: string;
}
```

示例：

```json
{
  "schemaVersion": 1,
  "revision": 12,
  "commitId": "commit_01J7Q2A4P8",
  "updatedAt": "2026-07-22T12:30:00.000Z"
}
```

规则：

- `revision` 每次成功发布严格加一；
- `commitId` 指向的 commit 必须在替换 pointer 前完整存在并通过校验；
- pointer 不直接重复保存 phase/day，避免两个事实来源；
- 更新使用同目录临时文件、flush/fsync 和原子 rename；
- 读取时 pointer 与 commit 任一损坏都进入 `invalid`，不得猜测替代 commit。

## 7. Commit

Commit 是不可变的完整业务引用快照。

```ts
export interface ArchiveCommit {
  /** commit schema。 */
  schemaVersion: 1;

  /** commit 唯一 id。 */
  id: string;

  /** 与发布后的 CurrentPointer.revision 相同。 */
  revision: number;

  /** 前一个已发布 commit；初始化 commit 为 null。 */
  parentCommitId: string | null;

  /** 产生该 commit 的 operation。 */
  operationId: string;

  /** commit 创建时间。 */
  createdAt: string;

  /** 当前 world 业务状态。 */
  world: CommitWorldState;

  /** 当前有效 canon revision；初始化前为 null。 */
  canonRevision: string | null;

  /** 每个已知 day 当前有效 revision。 */
  dayHeads: Record<string, DayHead>;

  /** 仅会话 phase 存在，用于崩溃恢复。 */
  activeSession: ActiveSessionReference | null;
}
```

```ts
export interface CommitWorldState {
  /** 当前业务阶段。 */
  phase: WorldPhase;

  /** 当前 day；没有 current day 时为 null。 */
  day: string | null;

  /** 最近已结算 day。 */
  lastSettledDay: string | null;
}

export interface DayHead {
  /** 当前有效 day revision。 */
  revision: string;

  /** 当前 day 业务状态。 */
  status: 'planned' | 'awaiting-settle' | 'settled' | 'abandoned';
}

export interface ActiveSessionReference {
  /** 当前 Session operation。 */
  operationId: string;

  /** Session kind。 */
  kind: SessionKind;

  /** 进入 Session 前的稳定 commit。 */
  baseCommitId: string;
}
```

不变量：

- commit 文件创建后不得原地修改；
- commit revision 必须等于发布它的 pointer revision；
- 正式 commit phase 只能是 `idle`、`planning`、`planned`、`playing`、`awaiting-settle` 或 `revising`；`uninitialized`、`initializing`、`invalid` 都不是可写入的 archive phase；
- stable phase 的 `activeSession` 必须为 `null`；
- 已发布的 `planning`、`playing`、`revising` commit 必须具有匹配的 `activeSession`；
- `initializing` 只存在于首次发布前的进程内快照，不写成正式 commit；
- `dayHeads` 是 day 有效性的事实来源；
- `planned`、`playing`、`awaiting-settle` 的 `world.day` 必须存在对应 `dayHeads`；下一天的 `idle` 以及从该边界进入的 `planning/revising` 允许 day 尚无 revision；
- `parentCommitId` 只用于历史追踪，业务读取不得自行回退 parent。

## 8. Canon Revision

Canon revision 是不可变目录。

`canon/<revision>/manifest.json`：

```ts
export interface CanonRevisionManifest {
  /** canon revision id。 */
  id: string;

  /** 基于哪个 canon revision；初始化为 null。 */
  parentRevision: string | null;

  /** 产生该 revision 的 operation。 */
  operationId: string;

  /** 创建时间。 */
  createdAt: string;

  /** 本 revision 包含的规范化相对文件列表。 */
  files: string[];
}
```

revise 必须创建新 canon revision，不能原地覆盖已发布 canon。未修改文档可以复制、硬链接或由实现层使用内容寻址优化，但公开语义是一个完整不可变快照。

## 9. Day Revision

Day revision 也是不可变目录。`meta.json` 是该 revision 的索引：

```ts
export interface DayRevisionMeta {
  /** day id。 */
  day: string;

  /** day revision id。 */
  revision: string;

  /** 前一个 day revision；首次计划为 null。 */
  parentRevision: string | null;

  /** 产生该 revision 的 operation。 */
  operationId: string;

  /** revision 状态。 */
  status: 'planned' | 'awaiting-settle' | 'settled' | 'abandoned';

  /** 创建时间。 */
  createdAt: string;

  /** 当前 revision 中存在的业务文件。 */
  files: string[];
}
```

### 9.1 Planned Revision

必须包含：

- `meta.json`；
- `plan.json`。

`plan.json` 至少包含 day、intent 和稳定 beat id。beat 的执行状态属于后续 play revision，不反写 planned revision。

### 9.2 Awaiting-Settle Revision

必须包含：

- `meta.json`；
- `plan.json`，包含 beat 最终状态；
- `play.json`，包含行动摘要和完成 event 引用；
- `events/*.json`；
- `transcript.jsonl`。

### 9.3 Settled Revision

在 awaiting-settle revision 基础上增加 `settlement.json`，并将 meta status 设为 `settled`。

### 9.4 Abandoned Revision

基于被放弃 day 的最后有效 revision 创建，增加 `abandoned.json`，meta status 为 `abandoned`。当前 commit 的 `dayHeads` 保留该 revision，从而明确记录 day 已被放弃；`world.day` 回到前一天或 null。

### 9.5 Day 业务文件

```ts
export interface PlanDocument {
  /** day id。 */
  day: string;

  /** 用户当日意图。 */
  intent: string;

  /** 计划节点。 */
  beats: Array<{
    id: string;
    intent: string;
    status: 'pending' | 'completed' | 'skipped';
    eventId: string | null;
  }>;
}

export interface PlayDocument {
  /** day id。 */
  day: string;

  /** 行动结果摘要。 */
  summary: string;

  /** 按发生顺序排列的 event id。 */
  eventIds: string[];
}

export interface PlayEventDocument {
  /** event id。 */
  id: string;

  /** 对应 beat；不对应固定 beat 时为 null。 */
  beatId: string | null;

  /** 用户行动。 */
  userInput: string;

  /** assistant 结果。 */
  assistantOutput: string;

  /** 当前规范只发布完成事件。 */
  status: 'completed';
}

export interface TranscriptEntry {
  /** transcript 内单调递增序号。 */
  sequence: number;

  /** 消息角色。 */
  role: 'user' | 'assistant' | 'system';

  /** 消息正文。 */
  text: string;

  /** 对应 Runtime message id；没有时为 null。 */
  messageId: string | null;
}

export interface SettlementDocument {
  /** 被结算 day。 */
  day: string;

  /** 当日结算摘要。 */
  summary: string;

  /** 结算时间。 */
  settledAt: string;
}

export interface AbandonedDocument {
  /** 被放弃 day。 */
  day: string;

  /** 放弃时间。 */
  abandonedAt: string;

  /** 放弃前有效 day revision。 */
  previousRevision: string;
}
```

`transcript.jsonl` 每行是一个完整 `TranscriptEntry`。读取时 sequence 必须从 1 严格递增；日志尾部截断属于被引用 day revision 损坏，不能静默忽略。

所有数组保存业务顺序。序列化实现不得依赖对象属性顺序表达业务语义。

## 10. Operation Workspace

每个会改变正式存档的命令都对应一个 operation。

```ts
export interface ArchiveOperation {
  /** operation schema。 */
  schemaVersion: 1;

  /** operation id。 */
  id: string;

  /** 业务操作类型。 */
  type:
    | 'init'
    | 'start-session'
    | 'submit-session'
    | 'cancel-session'
    | 'settle-day'
    | 'abandon-day'
    | 'recover-session';

  /** 此 operation 的 target commit 发布状态。 */
  status: 'preparing' | 'prepared' | 'published' | 'failed';

  /** Session operation 的最终结果；非 Session operation 为 null。 */
  sessionOutcome: 'active' | 'submitted' | 'cancelled' | 'interrupted' | null;

  /** operation 开始时的 pointer revision；未初始化时为 0。 */
  baseRevision: number;

  /** operation 开始时的 commit。 */
  baseCommitId: string | null;

  /** 准备发布的 commit。 */
  targetCommitId: string | null;

  /** 创建时间。 */
  createdAt: string;

  /** 最后更新时间。 */
  updatedAt: string;

  /** 失败时的稳定可序列化信息。 */
  error: RuntimeError | null;
}
```

workspace 可以包含待发布 canon/day/commit 文件。正式读取绝不能访问 workspace。

Operation status 是诊断信息，不是发布事实来源。即使 operation 标记为 `published`，也必须以 `current.json` 是否指向 target commit 为准。

`start-session` operation 在边界 commit 发布后是 `status = published`、`sessionOutcome = active`。后续 submit、cancel 或恢复只更新 `sessionOutcome`，不能覆盖边界 commit 已发布的事实。

## 11. 发布协议

`ArchiveRepository.publish()` 必须执行：

1. 获取 archive 独占 publish lock；
2. 在锁内读取 current pointer；
3. 校验 pointer revision/commit 与 operation 的 base 一致；
4. 校验 workspace 中全部 schema、id、路径和交叉引用；
5. 将 operation 更新为 `prepared`；
6. 将新的 canon/day revision 移入正式不可变路径；
7. 写入不可变 target commit；
8. 写入 `current.json.tmp-<operation-id>`；
9. flush 临时文件，原子 rename 为 `current.json`；
10. 必要时 fsync world 目录；
11. 将 operation 标记为 `published`；
12. 释放 publish lock；
13. 追加非权威 operation log。

第 9 步是业务发布点。

在发布点之前失败：

- current 状态不变；
- 新对象均视为 orphan；
- operation 标记为 `failed`；
- 不需要回滚已写入但未引用的不可变文件。

发布点之后、operation 状态更新之前崩溃：

- 新 commit 已经有效；
- 启动恢复根据 current pointer 将 operation 修正为 `published`；
- 不得因为 operation 仍是 `prepared` 而回退有效 commit。

## 12. 并发与冲突

Runtime mutation lock 解决单进程重入，ArchiveRepository 还必须解决多实例或外部进程冲突。

- operation 保存 `baseRevision` 和 `baseCommitId`；
- 最终发布必须持有 archive 独占 publish lock；
- 获取锁后重新读取并校验 current pointer；
- 基准不一致返回 `ARCHIVE_CONFLICT`；
- 冲突 operation 不得覆盖较新的 pointer；
- publish lock 与 base revision 校验缺一不可：锁负责排除最终写入竞态，revision 负责拒绝过期 transaction；
- lock 文件必须记录 owner token、pid 和创建时间；过期锁只能在确认 owner 不存活后回收；
- 释放锁时必须校验 owner token，不能删除其它实例重新取得的锁；
- 当前规范不自动合并两个 operation。

## 13. Session 与存档

### 13.1 开始 Session

planning、play 和 revise Session 开始时发布一个会话边界 commit：

- phase 改为对应 Session phase；
- `activeSession` 记录 operation、kind 和 base commit；
- 正式业务对象引用保持不变；
- Session 的 transcript 和临时产物写入 operation workspace。

Session start 与边界 commit 必须作为 Runtime 的同一可见发布边界。

init Session 是唯一例外。此时 world 尚无 manifest/current：

- Runtime 内存 phase 为 `initializing`；
- Session operation 和临时产物只存在于 `operations/<id>/workspace`；
- cancel 或进程退出后仍读取为 `uninitialized`；
- submit 成功时一次性发布 manifest、首个 canon revision、初始化 commit 和 current pointer；
- 不允许为了持久化 `initializing` 而提前创建不完整的 manifest/current。

### 13.2 Submit Session

submit：

1. Session 返回业务产物；
2. Runtime 校验 Session kind、status 和当前 commit；
3. operation 将产物写成新的 canon/day revision；
4. 创建目标稳定 phase commit；
5. 原子更新 current pointer；
6. 清除 active Session。

### 13.3 Cancel Session

cancel 不发布 Session 业务产物，但仍建议创建一个新的稳定 commit：

- 业务引用复制自 `activeSession.baseCommitId`；
- phase 回到来源稳定态；
- `activeSession = null`；
- current revision 继续单调递增；
- start-session operation 的 `sessionOutcome` 标记为 `cancelled`，workspace 之后可清理。

不能直接把 current pointer 写回旧 revision，否则会破坏 revision 单调性和并发检测。

## 14. Settle 与 Abandon-Day

### 14.1 Settle

settle 创建：

- 当前 day 的新 settled revision；
- 指向该 revision 的新 day head；
- phase 为 `idle` 的新 commit；
- 下一 day id；
- `lastSettledDay` 更新为刚结算 day。

### 14.2 Abandon-Day

abandon-day 创建：

- 被放弃 day 的新 abandoned revision；
- 更新后的 day head；
- phase 为 `idle` 的新 commit；
- `world.day` 指向前一天，放弃 `day_0001` 时为 null。

不物理删除被放弃 day。其历史和 abandoned 状态仍可通过 commit/day head 审计。

## 15. 启动与恢复

启动读取顺序：

1. 检查 current pointer；不存在时返回 `uninitialized`，忽略未发布 manifest、operation 和其它 orphan；
2. current 存在时要求 manifest 存在并校验其 schema；
3. 校验 current pointer；
4. 读取并校验 current commit；
5. 校验 commit 引用的 canon/day revisions；
6. 检查 commit phase 与 activeSession 是否一致；
7. 输出 WorldSnapshot，或进入 `invalid`。

如果 current commit 是 `planning`、`playing` 或 `revising`，因为进程内 Session 不可恢复：

1. 读取 `activeSession.baseCommitId`；
2. 校验 base commit 是匹配的来源稳定态；
3. 创建 `recover-session` operation；
4. 复制 base commit 的业务引用；
5. 发布新的稳定 commit，revision 递增；
6. 将原 start-session operation 的 `sessionOutcome` 标记为 `interrupted`；
7. 不发布其 workspace 产物。

如果 base commit 缺失或引用不一致，则进入 `invalid`，不得猜测恢复目标。

## 16. Invalid 分类

至少区分：

| Code | 含义 |
|------|------|
| `ARCHIVE_MANIFEST_INVALID` | current 存在时 manifest 缺失、格式或版本错误 |
| `ARCHIVE_POINTER_INVALID` | current pointer 损坏 |
| `ARCHIVE_COMMIT_MISSING` | current 指向不存在的 commit |
| `ARCHIVE_COMMIT_INVALID` | commit schema 或不变量失败 |
| `ARCHIVE_REFERENCE_MISSING` | canon/day 引用不存在 |
| `ARCHIVE_REFERENCE_INVALID` | 被引用对象 schema 或 id 不一致 |
| `ARCHIVE_SESSION_RECOVERY_FAILED` | Session phase 无法回到 base commit |
| `ARCHIVE_CONFLICT` | 发布基准已变化 |

读取失败必须保留结构化诊断详情，包括文件类别、引用 id 和安全的相对路径。

## 17. 日志与事实来源

`logs/operations.jsonl` 只用于审计和诊断：

- 追加写；
- 每条包含 operation id、type、status、base/target revision 和时间；
- 日志损坏不改变有效业务状态；
- Runtime 不通过重放日志恢复 current state；
- 日志写入失败不能推翻已经完成的 pointer 发布，但必须进入内部诊断。

## 18. 清理与 GC

可安全清理：

- 已 failed，或 sessionOutcome 为 submitted/cancelled/interrupted 且超过保留期的 operation workspace；
- 未被任何 commit 引用的 canon/day revision；
- 没有被 current 或保留历史链引用的 orphan commit；
- 遗留的 `*.tmp-*` 文件。

GC 必须先构建引用图，再删除对象。默认保留从 current 沿 `parentCommitId` 可达的完整历史。

默认只报告 candidates。只有 `delete: true` 才执行删除；删除前必须持有 publish lock，不能和 transaction 发布并发。终态 operation 的元数据继续保留用于诊断，只在超过 `operationRetentionMs`（默认七天）后清理其 workspace。`preparing/prepared` operation workspace 不由 GC 猜测删除。

GC 不是正常读取和写入的前置条件。即使从不运行 GC，orphan 也不能影响业务正确性。

## 19. Archive API 方向

```ts
export interface ArchiveRepository {
  /** 读取并校验当前已发布存档。 */
  readCurrent(): Promise<ArchiveReadResult>;

  /** 按不可变 id 读取一个 commit。 */
  readCommit(commitId: string): Promise<ArchiveCommit>;

  /** 读取完整 canon revision。 */
  readCanonRevision(revision: string): Promise<CanonRevisionData>;

  /** 读取完整 day revision。 */
  readDayRevision(day: string, revision: string): Promise<DayRevisionData>;

  /** 基于当前 pointer 创建隔离 operation；Runtime 可传入关联用 operation id。 */
  beginOperation(type: ArchiveOperationType, operationId?: string): Promise<ArchiveTransaction>;

  /** 诊断存档引用和未完成 operation，不修改业务状态。 */
  inspect(): Promise<ArchiveInspection>;

  /** 恢复中断 Session；其它 invalid 修复不由此方法猜测处理。 */
  recoverInterruptedSession(): Promise<ArchivePublishResult>;

  /** 按引用图清理 orphan。 */
  collectGarbage(options?: GarbageCollectionOptions): Promise<GarbageCollectionResult>;
}

export interface GarbageCollectionOptions {
  /** true 才执行删除；默认 dry-run。 */
  delete?: boolean;

  /** published/failed operation workspace 的保留时间；默认七天。 */
  operationRetentionMs?: number;
}

export interface ArchiveTransaction {
  /** transaction 对应的 operation id。 */
  readonly operationId: string;

  /** transaction 创建时的不可变基准。 */
  readonly base: CurrentPointer | null;

  /** 当前 operation 的隔离 Session workspace。 */
  readonly workspace: SessionWorkspace;

  /** 仅在初始化 operation 中写入 world manifest。 */
  stageManifest(value: ManifestDraft): Promise<void>;

  /** 在 workspace 中写入 canon revision。 */
  stageCanon(value: CanonDraft): Promise<string>;

  /** 在 workspace 中写入 day revision。 */
  stageDay(value: DayDraft): Promise<string>;

  /** 设置准备发布的 commit。 */
  stageCommit(value: CommitDraft): Promise<string>;

  /** 校验并原子发布 staged 内容。 */
  publish(): Promise<ArchivePublishResult>;

  /** 放弃 transaction，不改变 current pointer。 */
  abort(error?: RuntimeError): Promise<void>;
}
```

具体 Draft 类型应由各 operation 的业务 schema 定义，不能使用无约束的文件路径写入接口。

Session 不直接依赖上述 Repository。`createArchiveSessionWorldReadModel()` 把 commit、canon 和当前 day 投影为结构化的 `SessionWorldContext`；自然语言 Session 只依赖 `SessionWorldReadModel` 端口，因此既不知道 archive 路径，也没有正式存档写权限。

## 20. 验收

- 任何正式读取都从 current pointer 开始；
- pointer 永远不引用未完整写入的 commit；
- 任何 commit 引用都可被 schema 校验；
- 发布前失败不会改变当前业务快照；
- 发布后崩溃可以依据 pointer 判定成功；
- cancel 和 Session 恢复不会让 revision 倒退；
- 并发基准变化返回 `ARCHIVE_CONFLICT`；
- orphan 文件存在时读取结果不变；
- abandon-day 和 settle 产生新的不可变 day revision；
- GC 只删除引用图不可达对象；
- 所有损坏情况要么给出确定 snapshot，要么进入带诊断信息的 `invalid`。
