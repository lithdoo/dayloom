# Dayloom 文档原生 World、持久 AI Session 与 ReAct 重构设计

> 状态：破坏性重构设计草案  
> 日期：2026-08-07  
> 目标版本：Dayloom Archive V2  
> 适用范围：正式的 `@dayloom/core` 与 `@dayloom/tui`  
> 不适用范围：已废弃的 `@dayloom/cli`、`@dayloom/core-old` 与 `@dayloom/tui-old`

## 1. 一句话目标

> Dayloom 负责安全地版本化一个主要由 AI 维护的文档世界；Promptpile 负责让 AI 持续理解、检索和修改这个世界。

本次重构不是在现有 `SessionSubmission` 和 Archive V1 上增加压缩，而是重新划分内容、会话、工具与提交的权威边界：

- World 内容采用文档原生模型，不再为 AI 生成的大量语义内容预设细粒度 TypeScript schema；
- Dayloom 只结构化必须由程序严格保证的控制数据；
- AI 在 ReAct 回合中通过 Dayloom 提供的 staging tools 修改会话工作区；
- 用户执行 `/submit` 后，Dayloom 才把 staged documents 发布成不可变 World commit；
- Promptpile Conversation Directory 持久保存对话、工具和压缩归档，不再每轮重建临时会话；
- 四种正式 AI Session 全部使用多步 ReAct；
- Dayloom 以受管 CLI 子进程形式嵌入 `promptpile-react`。

## 2. 为什么需要破坏性重构

### 2.1 当前正式实现

当前 `@dayloom/core` 有四种 AI Session：

- `init`；
- `planning`，由 `daily` 启动；
- `play`；
- `revise`。

它们共用 `NaturalLanguageSession`。当前实现具有以下特征：

- 进程内维护完整 `messages` 数组；
- 每次模型调用把全部消息复制到新的 Promptpile 临时目录；
- 单次调用结束后删除该目录；
- `/submit` 时再次要求模型生成强类型 JSON；
- `play` 还会从内存对话位置推导 `PlayEvent`；
- 进程重启发现 active Session 时倾向于回滚并标记 interrupted，而不是恢复会话。

当前 Archive V1 已经具备有价值的事务基础：不可变 commit、`current.json` 原子发布指针、operation workspace、锁、校验、检查与 GC。但是内容模型被固定为：

- `CanonDocuments`；
- `PlanBeat` / `ResolvedPlanBeat`；
- `PlayEvent`；
- `InitSubmission` / `PlanningSubmission` / `PlaySubmission` / `ReviseSubmission`；
- canon revision 与 day revision 的固定目录和文件集合。

### 2.2 当前模型的问题

这些结构把“程序必须保证的一致性”和“AI 产生的世界语义”混在了一起：

1. AI 是绝大多数内容的主要阅读者和修改者，程序并不需要理解每一个人物、场景、计划节点和叙事事件。
2. 每增加一种世界内容，都需要扩展 schema、validator、reader、transaction、submission 和 projector。
3. AI 已经在对话中完成修改意图，提交时再生成一份完整结构化 JSON，会产生二次理解、漂移和失败点。
4. 从 Final 文本或完整对话反推 patch，无法可靠地区分“讨论中的建议”和“已经确认的修改”。
5. 内存 `messages` 使 Promptpile 文件协议退化成一次性 provider wrapper，无法获得持久归档、检索、恢复和重放能力。
6. 压缩后，AI 必须根据搜索结果继续调用其它历史工具；未来文件读取和互联网搜索也具有相同的条件链，单次模型调用不够用。

因此，不能把新功能继续建立在四套强类型 submission 上。

## 3. 设计目标

### 3.1 必须实现

1. World 的主要内容以 Markdown、JSON、YAML 或其它受控媒体类型保存。
2. 内容路径可以扩展，而不要求同步修改 Dayloom 领域 schema。
3. 保留不可变历史、原子发布、冲突检测、崩溃恢复和审计能力。
4. Promptpile Conversation Directory 是 AI 上下文和会话 artifacts 的权威来源。
5. 不设置固定的用户会话轮数上限，允许一个 Session 跨越模型上下文窗口长期进行。
6. 四种 Session 都能在一个用户回合内连续调用多个工具。
7. AI 不能直接写正式 World，也不能通过通用 shell 绕过 Dayloom。
8. AI 的修改在对话过程中进入 staging overlay，用户可在提交前查看和继续修正。
9. `/submit` 从已验证的 staging manifest 确定性地产生 commit，不再重新理解全部对话。
10. 进程中断后，conversation、staging 和运行状态仍可诊断，并可恢复或安全取消。
11. Dayloom 与 `promptpile-react` 保持进程边界，只通过公开 CLI 和版本化文件 artifacts 集成。

### 3.2 明确不做

- 不承诺无限模型 token、无限工具步骤、无限费用或无限磁盘空间；
- 不把 Promptpile Conversation Archive 当作 World 版本库；
- 不让聊天正文自动成为 World 事实；
- 不让模型直接更新 `current.json`、commit、tree、blob、lock 或 operation metadata；
- 不为所有 World 文档建立统一语义 schema；
- 不在第一版实现任意文本 diff 的模糊应用；
- 不在同一 ReAct 回合的 Thought、Observe、Check 和 Final 之间压缩；
- 不继续扩展 `core-old` 或旧 Dayloom CLI；
- 不静默兼容或原地改写 Archive V1。

## 4. 权威边界

重构后有三个互不替代的存储域。

| 存储域 | 权威内容 | 不负责 |
| --- | --- | --- |
| Promptpile Conversation | user/assistant/system messages、tool calls/results、ReAct artifacts、压缩摘要、历史 archive | 正式 World 内容与发布状态 |
| Dayloom Session Workspace | session/run 状态、conversation 映射、staging overlay、工具审计、恢复游标 | 已发布 World 的最终事实 |
| Dayloom World Archive | immutable document tree、blob、commit、最小控制状态、current pointer | 模型思考过程和 live conversation |

内存对象只允许作为这些文件的缓存或 read model，必须能够从文件重建。不得再把完整内存 `messages`、内存 Draft 或 TUI MessageStore 当作权威数据源。

## 5. 总体架构

```text
@dayloom/tui
    │ RuntimeCommand / RuntimeInput / RuntimeEvent
    ▼
@dayloom/core Runtime
    ├── SessionManager
    ├── DocumentWorldRepository
    ├── SessionWorkspaceRepository
    ├── WorldToolGateway
    └── ReactConversationAgent (Dayloom port)
            │
            ▼
       PromptpileReactCliAdapter
            │ public CLI + exit code + versioned artifacts
            ▼
       promptpile-react -d <conversation> -c -q --max-step <N>
            ├── Promptpile CLI / Conversation Protocol
            ├── promptpile-mcp
            ├── promptpile-compress
            ├── promptpile-compress-grep-search
            └── Dayloom-scoped MCP tools
                    ├── conversation history tools
                    ├── World read/search tools
                    ├── staging mutation tools
                    └── optional file/web tools
```

四种 Session 共享同一执行、存储和提交主干。它们只在以下策略上不同：

- system prompt 与工作目标；
- 默认上下文入口；
- 可见工具集合；
- 可读和可写虚拟路径；
- 提交前置条件；
- 提交后的 World phase 转移。

Session kind 是工作流和权限 profile，不再对应四套内容 schema。

## 6. Archive V2：文档树加最小控制平面

### 6.1 物理布局

建议布局：

```text
<world-root>/
├── manifest.json
├── current.json
├── commits/
│   └── <commit-id>.json
├── objects/
│   ├── trees/sha256/<prefix>/<hash>.json
│   └── blobs/sha256/<prefix>/<hash>
├── operations/
│   └── <operation-id>/
│       ├── operation.json
│       └── workspace/
│           ├── session.json
│           ├── runs.jsonl
│           ├── conversation-index.json
│           ├── conversation/
│           └── staging/
│               ├── index.json
│               └── files/
├── .locks/
└── logs/
    └── operations.jsonl
```

用户和 AI 操作的是虚拟文档路径；物理对象目录不是工具可写路径。

### 6.2 最小结构化数据

Dayloom 继续严格校验以下数据：

- archive schema version、world id、title 和创建时间；
- current revision 与 commit id；
- commit id、parent、operation id、root tree hash 和时间；
- World phase、current day、last settled day；
- active session 的 id、kind、operation id 和 base commit；
- tree entry 的规范路径、blob hash、media type 和字节数；
- operation/session/run 状态；
- lock、预算、权限 policy 和 staging manifest；
- hash、引用存在性、单写者和发布原子性。

示意类型：

```ts
interface ArchiveCommitV2 {
  schemaVersion: 2;
  id: string;
  revision: number;
  parentCommitId: string | null;
  operationId: string;
  createdAt: string;
  rootTreeHash: string;
  control: {
    phase: WorldPhase;
    day: string | null;
    lastSettledDay: string | null;
    activeSession: {
      sessionId: string;
      kind: SessionKind;
      operationId: string;
      baseCommitId: string;
    } | null;
  };
}

interface DocumentTreeEntry {
  path: string;
  blobHash: string;
  mediaType: string;
  bytes: number;
}
```

具体 tree 编码可以采用单个排序表或分层 tree objects，但 hash 必须由规范编码确定，不能依赖平台路径分隔符或 JSON key 顺序。

### 6.3 非结构化内容

以下只是推荐的虚拟路径约定，不是 Archive schema：

```text
world.md
rules.md
style.md
characters/*.md
locations/*.md
timeline/*.md
memory/*.md
days/<day>/plan.md
days/<day>/play.md
days/<day>/summary.md
custom/**
```

Dayloom 可以为 TUI、prompt profile 和默认工具查询提供约定，但未知合法路径必须能够被保存、版本化和读取。是否要求某些文档存在，应属于 Session policy 或提交规则，而不是通用 archive reader 的领域 schema。

### 6.4 不变量

1. `current.json` 是正式 Archive 中唯一需要原子替换的发布指针。
2. 已发布 commit、tree 和 blob 永不原地修改。
3. commit 引用的每个 tree/blob 必须存在且 hash 匹配。
4. staging 内容不是 World 事实，对正式 reader 不可见。
5. 发布必须验证 current commit 仍等于 Session 的预期 base/control commit。
6. 相同内容共享 blob，不因为 AI 多次完整重写而重复占用空间。
7. 路径统一为规范化相对 POSIX 路径，拒绝绝对路径、`..`、设备路径、空段和保留控制路径。
8. 同一 World 同时最多有一个可写 active Session；只读检查可以并发。
9. 任何模型输出都不能直接成为 commit 或 current pointer。

### 6.5 Session 控制 commit

对于已经初始化的 World，Session 生命周期继续进入可审计 commit 历史，但不为此复制内容：

1. start-session 发布一个 control-only commit，`rootTreeHash` 与稳定 base commit 相同，并记录 `activeSession.baseCommitId`；
2. 对话和 staging 发生在该 active Session 对应的 operation workspace；
3. `/submit` 以 active control commit 为 parent、以 stable base tree 为修改基线，发布新 document tree 并清除 `activeSession`；
4. `/cancel` 发布一个 tree 不变、清除 `activeSession` 的稳定 control commit；
5. recovery commit 只记录明确的恢复决定，不伪造内容变化。

`init` 没有 base commit，是唯一的 bootstrap 特例：Session identity、conversation 和 staging 先存在于持久 operation workspace；成功 `/submit` 后一次性创建 manifest、初始 tree、首个 commit 和 `current.json`。这只是发布基线的不同，不是内存 Session 特例。

## 7. 四种 Session 的新定位

### 7.1 `init`

- 从空 document tree 创建世界；
- 引导用户形成初始世界文档；
- 使用持久 operation workspace，删除 `MemorySessionWorkspace` 特例；
- 默认允许创建较广的内容路径，但仍不能写控制元数据；
- `/submit` 创建 Archive V2 manifest、初始 tree 和首个稳定 commit。

### 7.2 `planning`

- 围绕某一天或下一阶段进行规划；
- 默认写入对应 `days/<day>/` 文档，也可以由 policy 允许更新相关记忆或设定；
- 不再生成 `PlanBeat[]`；计划的粒度和格式由文档表达；
- 提交后由控制平面进入 planned 类 phase。

### 7.3 `play`

- 进行持续的角色扮演、叙事和世界推进；
- 可以在一个用户回合中查询世界、搜索旧对话、读取文件并多次更新 staging；
- 世界变化、人物状态、时间线和当天叙事直接写入对应文档；
- 不再从 user/assistant 消息位置合成 `PlayEvent[]`；
- raw conversation 留在 Promptpile，是否另存一份可阅读的 `days/<day>/play.md` 由 AI 通过 staging tool 显式完成。

### 7.4 `revise`

- 对既有世界文档进行跨文件修订；
- 默认具有最广的 World 内容写权限；
- 允许通过检索历史、读取引用文件和可选 web research 多步调查；
- 不再生成完整 `CanonDocuments` 替换对象。

这些默认路径权限必须可配置，并由 Dayloom 在工具层强制执行，不能只写在 prompt 中。

## 8. 持久 Promptpile Conversation

### 8.1 权威来源

每个 Session 拥有一个稳定 Conversation Directory，至少覆盖：

- user、assistant 和 system artifacts；
- 由 `-c` 写入的 Thought/Final assistant artifacts；
- tool calls 与 results；
- recent live turns；
- compression summary；
- Archive Protocol 保存的原始历史；
- Archive Protocol 的 manifest 与生命周期状态。

Observe 报告当前只在 `promptpile-react` 进程内传给 Check，Check 使用临时目录和 decision tool；它们不属于 Conversation Protocol 的持久消息。Dayloom 不应要求 Promptpile 为了自身诊断改变这一语义。

Conversation Directory 随 operation workspace 持久保存。连续用户回合复用同一目录，不再复制完整 `messages`，也不在模型调用后删除。

### 8.2 Dayloom Journal

Dayloom 不需要复制一份完整对话作为第二权威来源，但必须维护最小 journal/index：

- Dayloom operationId、sessionId、runId、messageId；
- Promptpile turn/artifact identity；
- run 开始、子进程退出、取消和失败状态；
- staging tool call 对应的 change id；
- conversation append、compression、staging 和 publication cursor；
- 用于恢复和审计的错误 envelope。

TUI 历史应从持久 conversation 读取并分页。内存 MessageStore 只是窗口缓存，它的 500 条/字符限制不能删除或定义正式历史。

### 8.3 Conversation 与 World 的关系

- 对话中提到某个事实，不代表 World 已修改；
- tool result 是证据，不是正式事实；
- 只有成功的 staging mutation 才形成候选修改；
- 只有 `/submit` 发布后，候选修改才成为 World 事实；
- World 文档不依赖 Promptpile 压缩摘要重建；
- Promptpile archive 不参与 World commit GC 的可达性计算。

## 9. 所有 Session 统一使用 ReAct

压缩历史的典型恢复链是：

```text
list_archives
    → search_archive
        → read_archived_turn
            → 根据结果再次 search/read
                → 更新文档
                    → 检查 staged diff
                        → Final
```

文件和网络研究也需要依据上一步结果决定下一步动作。因此四种 Session 都必须运行多步 ReAct，而不是只让 `revise` 使用工具。

每个用户回合仍有安全边界。第一版可以在不修改 Promptpile 的情况下强制执行：

- `promptpile-react --max-step`；
- Dayloom 外层进程 wall timeout 与取消；
- Dayloom tool server 的最大业务 call 数和 staging quota；
- `promptpile-mcp` 的单工具 timeout、并发、failure policy 与安全重试；
- 工具结果字节上限和工具白名单；
- LLM profile/请求本身可表达的单次 token 上限。

跨多个 phase 的精确 token/费用累计只有在上游或 provider 暴露可靠 usage 后才能实现，不应在第一版伪装成已经具备的能力。

“取消会话次数限制”只表示不再设置固定的用户回合数，不表示 `maxStep = Infinity`。

## 10. 工具体系

### 10.1 历史检索工具

由 `promptpile-compress-grep-search` 提供：

- `list_archives`；
- `search_archive`；
- `read_archived_turn`。

它们只读取 Promptpile conversation archive，不直接修改 World。

### 10.2 World 读取工具

第一版至少需要：

- `list_world_documents`；
- `read_world_document`；
- `search_world_documents`；
- `get_world_status`。

读取采用 overlay 语义：同一路径优先返回 staged version；已 staged delete 的路径视为不存在；否则读取 base commit。

### 10.3 Staging 修改工具

第一版至少需要：

- `stage_write_document`；
- `stage_delete_document`；
- `show_staged_diff`；
- `discard_staged_change`。

建议契约：

```ts
interface StageWriteDocumentInput {
  path: string;
  expectedHash: string | null;
  content: string;
  mediaType?: string;
  reason?: string;
}

interface StageDeleteDocumentInput {
  path: string;
  expectedHash: string;
  reason?: string;
}
```

`expectedHash` 实现乐观并发和误写保护：

- 创建新文档时必须为 `null`；
- 更新或删除时必须等于当前 overlay/base 中读取到的 hash；
- 不匹配时返回结构化 conflict，AI 可以重新读取后决定下一步；
- 不能提供“忽略冲突并覆盖”的模型工具参数。

第一版优先使用完整文档替换：Markdown 文档通常适合由 AI 整体重写，content-addressed blob 会自动去重未变化内容。将来可以增加 `stage_apply_text_patch`，但 patch 必须由 Dayloom 确定性应用，并具有 base hash、上下文校验和明确失败结果。

### 10.4 工具安全边界

- MCP server 在创建时绑定 world、session、operation 和 base commit；模型不能自行传入根目录或 session id；
- 所有路径经过统一 normalization 和 allow/deny policy；
- 正式 World root 不向模型暴露通用写文件、shell 或 Git 工具；
- staging 写入采用临时文件、fsync/close 和原子 rename 的平台适配实现；
- 限制媒体类型、单文件大小、总 staging 大小和单回合写次数；
- 工具结果使用稳定 envelope，正文可截断但必须标记 truncated；
- 工具日志默认隐藏敏感参数和大段正文；
- 修改工具串行执行；只读工具是否并行由明确 policy 决定；
- web 工具具有独立的网络、域名、内容大小、引用和提示注入防护策略。

## 11. AI 修改内容的正确流程

AI 不直接写正式内容文件，也不只在 Final 中输出一段等待 Dayloom 猜测的 patch。正确流程是：

```text
用户提出修改
    → AI 读取/搜索 base + staging overlay
    → AI 调用 stage_write_document 或 stage_delete_document
    → Dayloom 校验并更新 session staging
    → AI 可继续读取、修改其它文档或 show_staged_diff
    → AI Final 向用户解释本轮结果
    → 用户继续对话修正，或执行 /submit
```

成功的 staging tool call 本身就是结构化修改记录。Final 只负责自然语言交互，不承载隐藏 JSON、patch block 或 submission payload。

这同时解决两个问题：

1. AI 可以在一次 ReAct 回合中根据工具结果连续修改多个文件；
2. Dayloom 不需要在每轮结束后再调用一个 `SessionProjector` 猜测对话的真实意图。

## 12. Staging 与通用提交

### 12.1 Staging manifest

每个 Session 维护一个可恢复的 staging manifest：

```ts
type StagedDocumentChange =
  | {
      kind: 'write';
      path: string;
      baseHash: string | null;
      stagedHash: string;
      mediaType: string;
      bytes: number;
      updatedByRunId: string;
    }
  | {
      kind: 'delete';
      path: string;
      baseHash: string;
      updatedByRunId: string;
    };

interface WorldChangeSubmission {
  sessionId: string;
  kind: SessionKind;
  operationId: string;
  baseCommitId: string | null;
  changes: readonly StagedDocumentChange[];
}
```

`WorldChangeSubmission` 由 Dayloom 从冻结的 staging manifest 构建，不由模型生成。四种旧 `SessionSubmission` 都被它取代。

### 12.2 `/submit` 时序

```text
1. 禁止新用户回合和新的 staging mutation
2. 等待或取消当前 ReAct run
3. 冻结并读取 staging manifest
4. 校验 session、operation、kind、权限和提交前置条件
5. 校验 current commit 与 base/control commit
6. 重新校验所有 baseHash、stagedHash、大小和媒体类型
7. 把新内容写入 immutable blob store
8. 在 base tree 上确定性应用 write/delete，生成新 tree
9. 写入新 immutable commit
10. 获取 publish lock，再次检查 current pointer
11. 原子替换 current.json
12. 标记 operation/session submitted，发出 World/Session events
```

任何一步失败都不能让部分修改对正式 World 可见。发布失败时保留 staging，用户可以检查、解决 conflict 后重试。

### 12.3 用户控制

- 用户可以随时查看 staged file list 和 diff；
- 用户的后续纠正让 AI 更新同一 staging overlay；
- `/cancel` 不发布 staged changes，并按 retention policy 保留或清理 workspace；
- 默认不允许 AI 自己执行 `/submit`；提交是显式用户边界；
- 无 staged changes 时是否允许只提交 phase 变化，由各 Session policy 明确规定，默认拒绝无意义提交。

## 13. 单个用户回合的完整时序

```text
1. Runtime 接收输入，分配 operationId/messageId/runId
2. 原子记录 Dayloom run-start journal
3. Dayloom spawn `promptpile conversation append-user -d <dir> --quiet`
   并把完整用户输入写入 stdin
4. 记录 append 前后的 Conversation Protocol artifact identity
5. 在没有其它 writer 时运行 promptpile-compress lifecycle
6. 快照本轮开始前的 conversation 顶层 artifacts
7. 启动 `promptpile-react -d <dir> -c -q --max-step <N> ...`
   7.1 Thought：promptpile 单次 completion，可产生 calls artifact
   7.2 Thought after-hook 调用 promptpile-mcp exec-calls，写 result artifact
   7.3 Observe：读取 conversation，生成进程内观察文本
   7.4 Check：根据 Observe 和 decision tool 决定是否继续
   7.5 重复 Thought/Tool/Observe/Check
   7.6 Final：禁用业务工具，并通过 `-c` 追加最终 assistant artifact
8. 等待 CLI 退出，不解析其普通 stdout 为机器协议
9. 根据退出码及前后 artifact 差集校验 calls/results 和 Final
10. 原子记录 run-end journal 与 artifact 映射
11. 读取 Final artifact，发出 assistant message，Session 回到 waiting-input
```

Dayloom 不使用 `promptpile-react -i`：`-i` 面向终端交互，宿主应使用已经存在的 `promptpile conversation append-user` domain command。Dayloom 必须显式传入有限的 `--max-step`；Promptpile React 未传该参数时的“一轮后退出”语义不适合作为产品默认值。

staging mutation 在第 7 步的工具执行期间已经持久化，不需要第 10 步之后再做任何 Draft projection。如果 Final 子进程 soft-fail，`promptpile-react` 可能没有额外的错误结果供宿主解析；Dayloom 通过“预期 Final artifact 不存在”将本轮标记为 incomplete，同时保留已经成功写入的 staging changes。

## 14. 压缩与长期会话

### 14.1 压缩位置

压缩只在 user artifact 追加完成、整个 ReAct run 开始前执行一次：

```text
append user
    → compression lifecycle
        → complete ReAct run
            → append/confirm Final
```

同一 ReAct run 内不在 phase 之间压缩，因为这会改变 Check 所见上下文、打断 calls/results 配对，并使 step 重放不可预测。单回合过长时使用 `maxStep`、tool result cap、token budget 或超时停止。

### 14.2 检索

默认压缩产物应保留 archive pointer，模型通过 grep-search MCP 按需恢复历史。不能把完整历史重新无条件注入每次 prompt，否则压缩失去意义。

### 14.3 长期扩展

`promptpile-compress` 当前如果反复恢复并扫描完整历史，随着 archive 增长仍可能产生线性成本；semantic summary 也最终受模型输入窗口限制。因此“没有固定轮数上限”需要分阶段实现：

1. 第一版：持久 conversation、archive-pointer summary、grep retrieval；
2. 后续：增量摘要、分层摘要、archive 分片和索引；
3. 配套：磁盘 quota、retention、压缩报告和可观测性。

这是一种可持续的长期会话设计，不等同于宣称物理资源无限。

## 15. 按 Promptpile 原有路线进行 CLI 嵌入

### 15.1 必须遵守的上游边界

Promptpile 已接受的架构路线是 CLI-first：

```text
Orchestrator
    → spawn promptpile public CLI
    → 通过 Conversation Protocol / Tool Artifacts 交换状态
    → 读取输出 artifacts
    → 决定下一阶段
```

本节以 Promptpile 仓库中的既有决策和正式契约为准：

- [`ADR 0002 · 上层编排采用 CLI-first 边界`](../promptpile/doc/decisions/0002-cli-first-boundary.md)；
- [`生态总览`](../promptpile/doc/00-overview/ecosystem-overview.md)；
- [`CLI Contract v1`](../promptpile/doc/15-contracts/cli-contract-v1.md)；
- [`Conversation Protocol v1`](../promptpile/doc/15-contracts/conversation-protocol-v1.md)；
- [`Tool Artifacts v1`](../promptpile/doc/15-contracts/tool-artifacts-v1.md)；
- [`Archive Protocol v1`](../promptpile/doc/15-contracts/archive-protocol-v1.md)。

`promptpile-react` 自身就是该路线上的 orchestrator：它通过公开 `promptpile` CLI 实现 Thought、Observe、Check 和 Final，不 import `promptpile/dist/*` 私有实现。Dayloom 应作为更外层宿主复用这条边界，而不是把 `promptpile-react` 改造成 NDJSON RPC server、library runtime 或通用 agent daemon。

第一版 Dayloom 集成以“Promptpile 零侵入修改”为约束：

- 不新增 `run-turn --protocol ndjson-v1`；
- 不要求 phase event stream、capability negotiation 或 terminal event；
- 不改变 Conversation Protocol、Tool Artifacts 或 Archive Protocol；
- 不要求 `promptpile-react` 导出公共 library API；
- 不依赖任何 `promptpile*/dist/*` 私有文件；
- 不解析未文档化的 debug 日志或普通自然语言 stdout。

### 15.2 现有 CLI 的组合方式

每个用户业务回合由 Dayloom 执行：

```text
promptpile conversation append-user -d <conversation> --quiet
promptpile-compress compress -d <conversation> [已确定的 lifecycle 参数]
promptpile-react \
  --config <session-config> \
  -d <conversation> \
  -c -q \
  --tools-file <exported-tools.toml> \
  --after-hook-path <exec-calls-hook> \
  --max-step <finite-N>
```

具体参数仍由各 package 的公开 CLI contract 决定：

- user message 通过 `append-user` 的 stdin 写入；
- `-c` 让 Thought 和 Final 按 Conversation Protocol 追加 assistant artifacts；
- `-q` 禁止把各 phase 混合 stdout 当成 UI 输出；
- `--tools-file` 只用于 Thought；
- `--after-hook-path` 在 Thought 成功后执行 calls；
- Observe 使用纯文本输出并只在 React 进程内传给 Check；
- Check 使用临时 decision tool；
- Final 禁用业务工具；
- `--max-step` 必须显式设置为有限正整数。

压缩可以通过 `promptpile-compress` CLI 完成；如果 Dayloom 选择其正式公开 API，也只能依赖 package export，不得穿透到私有实现。压缩结束并释放 lifecycle lock 后才能启动 React。

### 15.3 通过 artifacts 确定结果

Dayloom 在启动 React 前记录 conversation 根层符合协议的文件集合和最大 idx，进程退出后重新扫描：

1. 非零退出：本轮失败，保存 stderr tail 作为诊断；
2. 零退出：校验新增 Conversation Protocol artifacts；
3. 对新增 calls 使用 `promptpile-mcp check` 判断 `pending | partial | complete | invalid`；
4. 要求 Session 配置包含非空 Final prompt；
5. 按 React 的固定阶段顺序，将本轮最后新增的 assistant artifact 识别为 Final；
6. 如果应有 Final 但不存在，则标记 `incomplete`，不能把最后一个 Thought 当成用户回复；
7. Final 正文从文件读取，stdout/stderr 都不是业务结果来源。

这里读取“最后新增 artifact”不是扫描未知私有布局：Conversation Protocol 定义 idx 和 sidecar 顺序，React 文档定义 Final 最后执行。Dayloom 还必须保留前后快照，不能仅在一个可能被其它 writer 修改的目录中盲取全局最新文件。

当前 `promptpile-react` 只用退出码区分 `error` 与成功路径，`final` 和 `max_step` 都可能以 0 退出，而且 Final 使用 soft invoke。Dayloom 第一版接受这个上游语义：对产品必须保证的是“是否得到完整 Final”和“tool artifacts 是否完整”，不伪造更细的 stop reason。

### 15.4 进程模型与取消

每个用户回合启动一个受管 `promptpile-react` 子进程；该进程内部可以多次 spawn `promptpile`，完成整个 ReAct 循环后退出。下一回合启动新进程，但复用 Conversation Directory。

取消由 Dayloom 进程管理器负责，不要求 Promptpile 增加 stdin control protocol：

1. 停止接受本 Session 的新输入和提交；
2. 终止 Dayloom 启动的 React 进程树；
3. 关闭或取消本回合拥有的 MCP gateway/request；
4. 等待句柄退出；
5. 校验已经原子落盘的 conversation、calls/results 和 staging artifacts；
6. 将未配对工具调用交给恢复流程，绝不自动重放。

Windows 使用 Job Object 或受管进程树，POSIX 使用 process group 或等价机制。`promptpile-mcp` 已支持 SIGINT/SIGTERM、HTTP 断开和 timeout 取消；Dayloom 应正确组合这些现有行为。

### 15.5 并发和 run identity

- Dayloom 保证同一 Conversation Directory 只有一个 writer；Promptpile Protocol 本身不协调多个 next-index writer；
- compression、append-user、React 和 conversation GC 在同一 Session 内严格串行；
- Dayloom 的 `runId` 保存在自己的 journal 和 conversation-index，不要求写入 Promptpile artifact schema；
- journal 记录本轮前后 artifact 集合，从而把新增 idx 映射到 runId；
- calls 缺少 result 不能等价为可安全重试；
- 不同 Session 使用不同 Conversation Directory、operation workspace 和 MCP 配置。

### 15.6 Dayloom adapter

```ts
interface ReactConversationAgent {
  runTurn(
    request: ReactTurnRequest,
    emit: (event: DayloomAgentEvent) => void,
    signal: AbortSignal,
  ): Promise<DayloomReactTurnResult>;
}
```

这是 Dayloom 自己的 port。`PromptpileReactCliAdapter` 在内部：

- 调用现有 public CLIs；
- 维护 artifact 前后快照；
- 把“进程运行中、读取 Final、校验失败”等本地状态映射为粗粒度 Runtime events；
- 管理 stderr cap、wall timeout 和进程树；
- 从 versioned artifacts 构建 `DayloomReactTurnResult`。

该接口不向 `promptpile-react` 反向提出同构 API 要求。

### 15.7 可选的上游增强

第一版不以修改 Promptpile 为前置条件。将来如果 Final 逐 token 流式显示具有足够价值，可以向 `promptpile-react` 提议“仅把 Final phase 转发到 Promptpile 已有的 `--output-pile-file` / `--output-pile-fd` / JSON 格式”这一通用增强。

该增强仍应遵循 file/CLI-first 路线，不新增 Dayloom 专用 RPC 协议；在上游接受和发布前，Dayloom 只显示统一 Agent loading，并在进程结束后一次性展示 Final。

## 16. `promptpile-mcp` 与执行器要求

`promptpile-react` 负责编排 Thought → Observe → Check → Final，不应被当作 tool executor。Thought 产生的 calls 由 `promptpile-mcp` 或兼容 executor 执行并写回 results。

Dayloom 应复用现有执行链：

- 启动或连接 `promptpile-mcp launch` gateway；
- 将 `promptpile-compress-grep-search mcp` 和 Dayloom-scoped World tool server 配置为 MCP servers；
- 通过 `promptpile-mcp export-tools` 生成 Thought 使用的扁平 `.tools.toml`；
- 使用显式 after-hook 调用 `promptpile-mcp exec-calls`；
- 通过 `.calls.jsonl` / `.result.jsonl` 和 `promptpile-mcp check` 获取完整性状态；
- 使用 result 中已经存在的 `execution` 元数据读取成功、attempts、duration 和 error；
- 通过 gateway/Dayloom tool server 配置落实并发、timeout、failure policy 和安全重试。

工具正文和敏感参数不默认进入普通日志。Observe/Check/Final 阶段沿用 `promptpile-react` 当前的工具隔离；Dayloom 不修改这些 phase 的语义。

## 17. 恢复与清理

### 17.1 启动恢复

Runtime 发现 active Session 时不再自动回滚和清理。应执行：

1. 校验 current commit、active session 和 operation identity；
2. 校验 Conversation Protocol 与 archive lifecycle；
3. 校验 staging manifest、staged file hash 和 base tree；
4. 对比 run journal、进程退出记录、artifact 前后快照和 calls/results；
5. 将未配对的非幂等 tool call 标记为需要决策，不自动重放；
6. 恢复到 `waiting-input`、`failed-recoverable` 或 `needs-attention`；
7. 由用户选择继续、重试安全阶段、提交现有 staging 或取消。

`init` 必须使用相同恢复模型，不能保留纯内存 workspace 特例。

### 17.2 清理策略

- completed、cancelled、failed 和 abandoned operation 使用不同 retention；
- conversation archive、staging 和诊断只有在不再需要恢复且 retention 到期后才能 GC；
- World objects 依据 commit/tree 可达性单独 GC；
- Promptpile conversation GC 与 World object GC 不混用；
- 清理必须持有对应 lock，不能与 ReAct/compression/publish 并发修改同一目录；
- 删除 material data 前应生成可审计记录。

## 18. TUI 目标

正式 `@dayloom/tui` 继续作为主要交互界面，旧 `@dayloom/cli` 保持 deprecated。TUI 应从简单聊天窗口演进为 Agent + Document workspace：

- 保留 `init`、`daily/planning`、`play`、`revise` 的用户入口；
- 第一版在 React 进程运行时显示统一 Agent loading，结束后从 Final artifact 一次性展示回复；
- 不解析混合 stdout 或 debug stderr 来伪造 phase/tool 事件；工具详情可从 calls/results 和 Dayloom MCP server 的受控状态查看；
- 显示 staged file list、write/delete 状态、base hash 和 diff；
- `/submit` 前提供清晰预览；
- 显示 conflict、进程超时、artifact incomplete、压缩、取消和恢复状态；
- conversation 历史分页读取，不依赖内存全量加载；
- 进程重启后可以重新进入 active Session；
- 明确区分“AI 已回复”“已有 staged changes”“已经发布到 World”三种状态。

## 19. 对现有代码的替换范围

### 19.1 删除或停止扩展

- `CanonDocuments`；
- `PlanBeat`、`ResolvedPlanBeat`、`PlayEvent`；
- 四种 `SessionSubmission`；
- `generated-payload` 提交解析；
- 从 `messages` 推导 play events 的逻辑；
- `SessionProjector` / per-kind Draft 设想；
- canon/day 固定 revision reader、writer 和 validator；
- 每轮临时 Promptpile directory；
- `MemorySessionWorkspace` 的 init 特例；
- active Session 启动时只依赖进程内对象的恢复方式。

### 19.2 保留并泛化

- Runtime command/event 边界；
- SessionManager 的单 active session 和取消协调职责；
- operation workspace；
- immutable commit 与 atomic current pointer；
- publish lock、inspection、recovery、GC 和结构化错误；
- `WorldSnapshot` 的轻量控制 read model；
- TUI 的流式消息生命周期。

### 19.3 新增核心端口

建议新增或重构为：

- `DocumentWorldRepository`；
- `DocumentTreeReader`；
- `SessionWorkspaceRepository`；
- `StagingRepository`；
- `WorldToolGateway`；
- `ConversationStore` / Promptpile Conversation adapter；
- `ReactConversationAgent`；
- `PromptpileReactCliAdapter`；
- `ArchiveV1Migrator`。

## 20. Archive V1 与旧世界迁移

这是 Archive V2 的显式破坏性升级：

- Runtime 不在 reader 中静默猜测 V1/V2 并混合写入；
- 检测到 V1 时返回明确的 migration-required 状态；
- 提供独立迁移命令或工具，支持 dry-run、验证、目标目录和备份；
- V1 canon 文件映射为普通文档；
- V1 day plan/play/events/transcript/settlement 映射为 `days/<day>/` 下的可读文档；
- 无法无损映射的结构写入 migration report，不静默丢弃；
- 迁移生成全新的 V2 objects 和 commits，不原地覆盖 V1；
- `core-old` 示例世界只作为迁移 fixture，不再决定新 schema；
- 旧 Dayloom CLI 不迁移到新运行时，也不承接新功能。

迁移完成后必须校验所有 blob/tree hash、commit 可达性、current pointer、文档数量和关键内容抽样。

## 21. 分阶段实施计划

### Phase 0：冻结契约

- 将本文档拆成必要 ADR：权威边界、Archive V2、staging tools、Promptpile CLI/artifact 集成；
- 确定虚拟路径规则、媒体类型和大小上限；
- 确定四种 Session 的默认 tool/path policy 与 phase transition；
- 定义 fixture、错误码、崩溃点和验收测试；
- 冻结 Archive V1 新功能开发。

### Phase 1：Archive V2 基础

- 实现 blob/tree/commit/current repository；
- 实现规范 hash、原子发布、inspection 和 GC；
- 实现通用 document read/list/search；
- 实现 V1 只读检测和迁移器；
- 用 repository contract tests 覆盖 Windows 与 POSIX 行为。

### Phase 2：持久 Session Workspace 与 staging

- 为四种 Session，包括 init，建立持久 workspace；
- 实现 staging index、overlay reader 和完整文档 write/delete；
- 实现 expectedHash conflict；
- 实现通用 `WorldChangeSubmission` 和 `/submit` transaction；
- TUI 增加 staged files/diff 基础视图。

### Phase 3：基于现有 Promptpile contracts 的 Dayloom adapter

- 固定并测试兼容的 Promptpile package/CLI 版本；
- 用 `conversation append-user`、`promptpile-react -c -q` 和有限 `--max-step` 完成回合；
- 实现 conversation artifact 前后快照、Final 识别和 incomplete 检测；
- 实现 Dayloom 自己的 wall timeout、进程树取消、run journal 和单写者协调；
- 不修改 `promptpile-react`，不新增 NDJSON/RPC 协议；
- 实现 Dayloom `PromptpileReactCliAdapter` 的 fake-CLI contract tests。

### Phase 4：MCP 工具与四种 Session

- 接入 history、World read/search 和 staging tools；
- 让 `init/planning/play/revise` 全部通过统一 ReAct agent；
- 删除内存完整 `messages` 和 generated submission 路径；
- 接入粗粒度 Runtime loading、Final artifact 和错误事件；
- 验证单回合多次、条件式工具调用。

### Phase 5：压缩与检索

- 在 ReAct 外层通过 `promptpile-compress` 的公开 CLI 或 API 接入 lifecycle；
- 接入 `promptpile-compress-grep-search` MCP；
- 验证压缩后的多步 search/read/research/write；
- 增加 archive 报告、quota 和恢复测试；
- 移除固定用户 Session 轮数限制。

### Phase 6：恢复、迁移与产品化

- 实现 active Session 恢复 UI 和策略；
- 完成 V1/core-old migration fixtures；
- 实现 conversation 分页和 retention/GC；
- 评估增量/分层摘要与 archive 索引；
- 删除已无引用的 V1 domain schemas 和 transaction code。

每个 Phase 都应形成可运行的垂直切片，不能先同时删除 V1 reader 和现有 Session，再长期等待新链路完成。

## 22. 验收标准

第一版整体重构完成至少满足：

1. 四种 Session 均使用持久 Promptpile Conversation Directory。
2. 进程内不再以完整 `messages` 作为对话权威来源。
3. 四种 Session 均能完成 `search → read → write → diff → final` 等多步工具链。
4. 压缩后 AI 能通过三个 archive tools 找回指定历史并继续执行后续工具。
5. 不存在固定用户回合数限制；`max-step`、wall timeout、MCP timeout、tool quota 和 staging quota 有效且可诊断。
6. AI 无法直接写 World root、objects、commits 或 current pointer。
7. 所有候选修改都可在 staging 中查看、覆盖、丢弃和恢复。
8. `/submit` 不调用模型，不解析 Final，不扫描完整 conversation，只消费已验证 staging manifest。
9. 四种旧 submission 和 Draft/projector 不再位于正式提交链路。
10. Archive V2 可以保存未知但合法的文档路径，而无需扩展领域 schema。
11. blob/tree/commit 不可变，current pointer 原子发布，冲突不会产生部分可见状态。
12. Dayloom 只依赖 Promptpile 公开 CLI、退出码和 versioned artifacts，不解析普通 stdout/debug log，也不依赖私有模块。
13. 用户取消可停止 Promptpile/ReAct/MCP 整个进程树并保留已完成 artifacts。
14. 进程中断后 conversation、journal 和 staging 可诊断，非幂等工具不会被静默重放。
15. TUI 明确区分对话回复、staged changes 和已发布 World。
16. V1 迁移具有 dry-run、报告、非原地输出和完整性验证。
17. Promptpile conversation archive 与 Dayloom World archive 的 GC、hash 和权威语义完全分离。

## 23. 风险与应对

| 风险 | 应对 |
| --- | --- |
| 文档过于自由，AI 难以定位内容 | 提供路径约定、索引文档、World search 和 mode prompt，不把约定升级成硬领域 schema |
| AI 整体重写导致误删 | expectedHash、diff 预览、大小限制、不可变历史和显式 `/submit` |
| CLI 输出混合多个 React phase | 使用 `-q`，通过 Conversation/Tool artifacts 取结果，不解析 stdout；以 fake CLI 做 adapter contract tests |
| 多步工具失控 | maxStep、外层 wall timeout、MCP/tool quota、白名单、staging quota 和结果上限 |
| crash 后重复副作用 | runId、calls/results 对账、非幂等工具不自动重放 |
| 长期 archive 扫描成本增长 | 分阶段引入增量摘要、分层 archive 和索引 |
| operation workspace 无限增长 | 状态化 retention、quota、可审计 GC |
| 迁移丢失旧语义 | 非原地迁移、migration report、内容计数/hash 校验和人工抽样 |

## 24. 尚待收敛的实现决策

以下问题不改变整体方向，但必须在对应 Phase 开始前形成契约：

- tree object 使用扁平排序表还是分层 Merkle tree；
- 推荐虚拟路径和四种 Session 默认 write policy 的具体范围；
- init 提交所需的最小文档集合；
- play conversation 是否默认物化为 World 文档；
- staging diff 的文本算法与二进制媒体类型策略；
- 第一版不流式 Final 是否可以接受，以及何时值得向上游提议转发现有 output-pile；
- per-Session MCP process 与共享 MCP gateway 的隔离方式；
- completed/cancelled Session conversation 的默认保留期限；
- web 工具的域名、引用和 prompt-injection 防护策略；
- archive-pointer 到增量/分层摘要的升级阈值。

已经确定、不应重新开放的方向包括：文档原生 World、最小控制平面、staging tools、显式用户提交、四种 Session 统一 ReAct、持久 Promptpile Conversation，以及 `promptpile-react` CLI 嵌入。
