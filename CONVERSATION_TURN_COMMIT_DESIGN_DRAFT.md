# Dayloom Speculative Operation、Markdown Draft 与 Conversation Turn Commit 设计草案

> 状态：FREEZE CANDIDATE
> 日期：2026-08-26
> 范围：`@dayloom/core` 的 Init / Planning / Play / Revise 对话期 `send()`、Markdown Draft 的增量整理，以及它与 Promptpile ReAct work、Session Submission V2 的衔接
> 非目标：不修改 Archive V2、World Profile V1、Candidate schema、World validator、Settle 与 abandon 的业务语义；不建设通用工作流引擎；不把 Draft 建设成可由程序直接编译的领域数据库
> 契约影响：本设计必须形成 Core Runtime V2、Conversation Turn Commit V1 和 Session Submission V2；Session Submission V1 的 YAML Draft Format、Draft-driven assignment 与可变 DraftHandle 明确退役，不得把这些 breaking changes 隐藏为实现细节

## 1. 背景与问题

当前对话 Agent 同时承担：

1. 理解 Session kind 与阶段边界；
2. 执行 `Thought -> Observe -> Check -> Final`；
3. 阅读 Published World 与 Draft；
4. 回答用户；
5. 避免越权推进业务流程；
6. 判断本轮是否产生新的创作状态；
7. 将新状态写回 Draft。

这导致四个相互关联的问题。

### 1.1 Thought 来源漂白

ReAct 的 Thought 写入 operation 私有 work Conversation，后续 Thought 和 Observe 可以再次读取它。这个机制适合多步检索，但模型提议可能在多轮自循环中被逐渐当成已有事实，再由 Observe 包装为 Final handoff。

现有 provenance、Check 早停和 Final discipline 用于约束这条路径，但它们只能降低 Response Generator 内部漂移，不能把一个已经生成的错误 Final 阻止在正式 Conversation 之外。

### 1.2 Response phase drift

例如 Init Session 的职责是协作定义世界、角色、地点、Canon、Arc 与初始状态，但模型在连续对话中可能进入叙事模式，开始模拟事件、推进时间或直接开始 Day 1。

这属于语义 policy，不能只依赖生成 Agent 自我遵循。

### 1.3 Draft synchronization drift

Draft 的原始目的，是在每轮对话后逐步归纳用户意图与相对 Published World 的变化，避免 submit 时再从可能已经压缩的完整 Conversation 一次性总结。当前 Prompt 虽要求每轮同步，但 Draft 写入仍由同一个回答 Agent 自主决定和执行：

```text
用户明确提供新设定
        |
        v
Assistant 正确回答
        |
        v
Draft 未更新
```

Conversation 与 Draft 因而分叉。另一方面，如果为了防止这种分叉而把 Draft 设计成严格 YAML schema、稳定 ID、确认状态和引用闭包，系统又会多出一次 `Conversation -> Draft IR -> Candidate` 的有损转换。Draft 本质上是提交 AI 主动查阅的持久语义交接材料，不是程序直接 commit 的 World patch；程序化领域约束应留在 transient Change Plan、Candidate 和 Published World 边界。

### 1.4 局部回滚机制缺少统一语义

当前系统已经存在多种“可丢弃工作”：

- Promptpile ReAct private work 在 operation 后清理；
- Submission Converter 写 Candidate workspace，验证失败后丢弃；
- Archive publish 使用 prepared mutation 与 rollback；
- Markdown Draft 整理需要 working copy 与技术校验后安装。

如果 Response rejection、Thought cleanup、Draft rollback、Candidate repair 各自建立状态机和补偿代码，Core 与 TUI 会快速积累相互不一致的特殊分支。

本设计因此不只增加一个 Reviewer，而是统一这些流程的生命周期与权威提升语义。

## 2. 总体原则：Speculative Operation + Authority Promotion

所有 AI 工作都遵循：

```text
authoritative base
       |
       v
speculative operation workspace
       |
       v
produced artifact
       |
       v
Core-owned verification boundary
       |
       +-- reject/fail/cancel --> discard or retain as audit
       |
       +-- accept -----------> promote authority
```

这里的“回滚”统一定义为：

```text
未提升的推测产物不进入 authority，工作区可被丢弃。
```

不定义为：

```text
抹除用户已经看到的内容，或通过反向写正式状态伪装成从未发生。
```

可见性与权威是两个独立维度：

- Thought、work delta 或 Response Candidate 可以已经被用户看到；
- 只有通过对应验证器并完成 Core commit 的产物，才能进入后续语义或持久状态。

## 3. Authority Ladder

Dayloom 的权威提升链统一为五层：

```text
L0  ReAct Thought Work
       |
       | provenance / Observe / Check / Final discipline
       v
L1  Response Candidate
       |
       | Turn Arbiter
       v
L2  Accepted Conversation
       |
       | Draft Curator + technical check + hash/CAS
       v
L3  Accepted Markdown Draft Snapshot
       |
       | Change Planner + Converter + validator + publisher
       v
L4  Published World
```

| 层次 | 推测产物 | 验证边界 | 提升后的 authority | 未提升时 |
| --- | --- | --- | --- | --- |
| Thought | ReAct private work | Observe / Check / Final discipline | Response Candidate | 清理 work；必要时保留诊断 |
| Response | 用户可见流式 generation | Turn Arbiter | Accepted Conversation | superseded / discarded / cancelled |
| Draft | staged Markdown snapshot | technical check / hash / effect check | Accepted Draft Snapshot | 丢弃 staging |
| World | Candidate World | program validator / publisher | Published World | 丢弃 Candidate / rollback prepared publish |

每一层只能读取当前允许的 authority，不能把自己的 proposal 直接提升为更高层事实。

## 4. Operation Scope

Dayloom Core 提供一个小型 Operation Scope，统一 operation identity、工作目录、取消、事件和终局，不建设任意 DAG 或可配置工作流。

```ts
type OperationKindV1 =
  | 'response'
  | 'arbitration'
  | 'draft-curation'
  | 'submission-conversion'
  | 'submission-review';

type OperationStageV1 =
  | 'thought'
  | 'observe'
  | 'check'
  | 'final'
  | 'verify'
  | 'repair'
  | 'curate'
  | 'validate'
  | 'commit';

interface OperationScopeV1 {
  operationId: string;
  groupId: string;
  turnId: string | null;
  kind: OperationKindV1;
  attempt: number;
  workspaceRoot: string;
  signal: AbortSignal;
  base: {
    conversationId: string | null;
    draftHash: string | null;
    worldCommitId: string | null;
  };
}
```

V1 标识符由 Core 生成，格式固定为 `<prefix>_<uuid>`，其中 UUID 为 32 位小写十六进制且不含连字符。prefix 分别为 `turn`、`op`、`gen`、`verdict`、`conv`；`sessionId` 沿用现有 Session ID 契约。Response 的 artifactId 为 generationId，Arbitration 的 artifactId 为 verdictId，Draft Curation 的 artifactId 为 canonical draftHash。标识符只表达身份，不编码目录、attempt 或 authority 状态。

`groupId` 对 Conversation operation 固定为 `turnId`，对 Submission operation 固定为外层 submit command 的 operation ID。V1 不支持任意 parent/child operation tree。

一次 Response Operation 就是一次 Promptpile React process。Thought、Observe、Check 与 Final 是该 Response Operation 的内部 stage，不是额外子 operation；Promptpile private work 也不是 Dayloom operation。

Operation Scope 只负责：

1. 分配稳定 ID；
2. 创建 operation 私有目录；
3. 绑定基线引用；
4. 传递取消信号；
5. 投影进度与流式事件；
6. 记录 terminal disposition；
7. 关闭子进程和文件 runtime。

它不负责 Session policy、Draft 业务语义、Agent 数量或动态流程编排。

### 4.1 Operation disposition

所有 speculative operation 只有五种终局：

```ts
type OperationDispositionV1 =
  | 'committed'
  | 'superseded'
  | 'discarded'
  | 'cancelled'
  | 'failed';
```

- `committed`：产物被提升到下一层 authority；
- `superseded`：产物完整产生、可能已经展示，但被后续 attempt 替代；
- `discarded`：产物完整产生，但未通过或未完成提升边界；
- `cancelled`：用户取消、Core dispose 或明确中断；
- `failed`：执行、协议或验证失败。

每个 operation 恰好发送一次 started 和一次 terminal disposition；produced artifact 的 operation 恰好发送一次 produced。terminal disposition 后禁止任何 stage、delta 或 produced event。

Execution completion 与 authority disposition 必须分开。`Final` 完成或流式输出结束只表示 artifact 已产生，不等于 committed。

## 5. Conversation Turn 的双提交模型

允许未验证回答立即流式展示后，一次 turn 不可能成为单一不可见事务。V1 明确定义两个 authority commit：

```text
Commit A: Response Accept
Commit B: Draft Sync
```

完整流程：

```text
User Turn
   |
   v
Response Attempt 1 -- immediate stream --> Presentation
   |
   v
Turn Arbiter
   |
   +-- REJECT
   |     |
   |     +--> attempt 1 = superseded
   |     +--> Core repair constraint
   |     +--> Response Attempt 2
   |
   +-- ACCEPT
         |
         v
  Commit A: Accepted Conversation
         |
         +-- Draft KEEP --> Turn Complete
         |
         +-- Draft UPDATE
                   |
                   v
             Draft Curator
                   |
                   v
             technical check / hash
                   |
                   +-- success --> Commit B --> Turn Complete
                   |
                   +-- fail/cancel --> draft-sync-pending
```

一次 turn 的关键状态不是一组散落 boolean，而是由 Aggregate Head 唯一推导：

- Response 尚未 accept：正式 Conversation 与 Draft 都不变；
- Response 已 accept、Draft UPDATE 未完成：Conversation 已推进，Draft 保持基线，存在一个 pending sync；
- Draft KEEP 或 Draft UPDATE 成功：turn 完成。

## 6. Persistent Session Aggregate、Head 与 Markdown snapshot

Conversation、Turn artifact 和 Markdown Draft snapshot 使用不可变目录。每个 Draft identity slot 只有一个 Core-owned Aggregate Head；它是该 slot 中唯一可变的 authority pointer。不可变目录是 crash recovery 的事务外壳，不改变 Draft 对 AI 和用户呈现为普通 Markdown 的事实。

### 6.1 固定物理布局

Session Submission V2 使用以下最小布局：

```text
<runtimeRoot>/drafts/active/<slot>/
  meta.json
  head.json
  diagnostics.json

  snapshots/
    <draftHash>/
      brief.md
      evidence.md

  sessions/
    <sessionId>/
      meta.json
      conversations/
        <conversationId>/
      turns/
        <turnId>/
          record.json
          operations/

<runtimeRoot>/drafts/stale/
<runtimeRoot>/drafts/archive/
<runtimeRoot>/drafts/abandoned-sessions/

<runtimeRoot>/transient/<instanceId>/sessions/<sessionId>/operations/
```

`brief.md` 是提交 AI 首先阅读的当前语义摘要，由 Draft Curator 增量整理。初始 bytes 对四类 Session 固定为以下 UTF-8/LF 文本：

```text
# Dayloom Draft Brief

## Current goal

## Agreed intent

## Proposed or unresolved

## Requested archive changes

## Submission notes

```

标题只是初始写作引导，不是程序 schema；Curator 后续可以按内容自然调整，technical check 不解析标题。

`evidence.md` 是 Core-owned、只追加的来源记录。每个 UPDATE turn 追加一个 Markdown block，精确包含 turnId、当前用户原文、accepted response 和 Curator Final 整理说明；它记录证据而不宣称 accepted response 中的所有建议都已被用户确认。Thought、Observe、Check、rejected response 和 repair constraint 不进入该文件。提交 AI 在 `brief.md` 有歧义或需要追溯指代时读取它。

模型只能修改 staging 中的 `brief.md`，不能直接写 `evidence.md`。Core 在 Curator 成功后组装本轮 block，因此原始用户输入与 accepted response 不经过第二次模型改写。

`drafts/**` 持久；`transient/<instanceId>/**` 只保存当前进程的 Promptpile work、MCP gateway、working copy 和 prepared artifact。`dispose()` 只删除当前 instance transient，不删除 active aggregate。

### 6.2 Aggregate Head

```ts
interface AggregateHeadV1 {
  schemaVersion: 1;
  revision: number;
  draftHash: string;
  activeSession: null | {
    sessionId: string;
    conversationId: string;
    pendingDraftSync: null | {
      turnId: string;
      acceptedGenerationId: string;
      baseDraftHash: string;
      verdict: 'UPDATE';
    };
  };
}
```

一个 Draft identity slot 最多有一个 active Session。`conversationId` 和 `draftHash` 引用的目录必须已经完整写入并通过第 11 节技术校验；Head 不得引用 transient 路径。

### 6.3 Head CAS

所有 Head 更新都使用同一 `compareAndSwapAggregateHeadV1(expectedRevision, next)`：

1. 在 world writer lock 内重新读取并严格解析当前 Head；
2. 当前 `revision` 不等于 `expectedRevision` 时返回 `DRAFT_CONFLICT`，不得写文件；
3. `next.revision` 必须等于 `expectedRevision + 1`；
4. 验证 next 引用的所有 persistent artifact 已存在、为安全普通文件且内容 hash 匹配；
5. 在 Head 同目录以 `wx` 创建随机临时文件；
6. 写入 UTF-8 JSON、`fsync` 文件并关闭；
7. 使用与 Archive `current.json` 相同的 atomic replacement helper 将临时文件替换为 `head.json`；
8. 替换成功是唯一线性化点；临时文件在 finally 中清理。

目录 fsync 在平台支持时执行；不支持目录 fsync 不改变协议成功语义。实现必须通过 Windows 与 POSIX fault-injection 测试，不能使用逐字段或逐业务文件更新代替 Head replacement。

### 6.4 Commit A

Arbiter 接受 response 后，Core 以 CAS 更新：

```text
Head N
  draft = H1
  activeSession.conversation = C1
  activeSession.pending = null

      |
      v

Head N+1
  draft = H1
  activeSession.conversation = C2
  activeSession.pending = UPDATE ? turnId : null
```

只有 CAS 成功后 generation 才标记为 accepted。KEEP 在同一次 Commit A 中以 `pending=null` 完成 turn；UPDATE 以 `pending=turnId` 进入 Curator。

### 6.5 Commit B

Draft Curator 成功、Core 追加 evidence block 并形成完整 Markdown snapshot 后，Core 再以 CAS 更新：

```text
Head N+1
  draft = H1
  activeSession.conversation = C2
  activeSession.pending = turnId

      |
      v

Head N+2
  draft = H2
  activeSession.conversation = C2
  activeSession.pending = null
```

### 6.6 生命周期与恢复

- 新 identity slot 创建 `sourceFormat='markdown-v2'` 的 `DraftMetaV2`、上述固定初始 `brief.md` 和第 11 节固定初始 `evidence.md`，materialize 初始 snapshot H0，并以 Head revision 0、`activeSession=null` 安装；骨架只指导 AI，不参与语义 lint；
- `startSession(kind)` 创建 persistent session record、空 Conversation revision 和 Aggregate Head 的 activeSession 引用后才返回成功；
- Core 初始化时如果发现与当前 World base 匹配的 `activeSession`，必须恢复相同 sessionId，并直接投影为 ready；
- 恢复出的 pending Session 只开放 retry 和 cancel；
- 如果 Draft slot 的 base commit/root hash 与当前 World 不匹配，整个 slot 连同 sessions 原子移动到 stale，不自动 rebase；
- `dispose()` 保留 activeSession；
- submit 成功后按 Session Submission V2 事务归档 Draft aggregate；
- ready 状态下 cancel 以 CAS 将 `activeSession=null`，Draft hash 保持不变，并将 session directory 移到 `abandoned-sessions/<sessionId>`；
- 未被 Head 引用的 prepared Conversation/Markdown snapshot 在启动恢复时删除；operation audit artifact 按其 record 状态保留或清理。

未被 Head 引用的 Conversation、Draft 或 operation workspace 都不是 authority。恢复只读取 Aggregate Head，不根据目录修改时间或文件存在性猜测当前状态。

## 7. ReAct Thought Work 的统一定位

Promptpile 继续拥有一次 ReAct operation 内部的：

```text
Thought -> Observe -> Check -> Final
```

以及 private work Conversation 的创建和清理。Dayloom 不为每个 Thought step 再建立一份文件快照。

Dayloom Operation Scope 负责 ReAct operation 外部的：

- authoritative base；
- operation identity；
- stream projection；
- Final artifact disposition；
- cancellation 与 audit。

因此：

```text
Promptpile Final != accepted assistant response
Promptpile Final == Response Candidate artifact
```

现有 provenance 规则继续生效：

- Thought 生成内容只能是 `model-proposal`；
- Observe 的 confirmed decision 必须来自 `user-confirmed` 或 Published World；
- 检索事实必须带 `published:<path>` 或 `retrieval:<path/range>`；
- 用户沉默、未反对或切换话题不构成确认；
- Final 不得把 model proposal 表述成用户已经确认。

这些规则防止 Response Generator 内部漂移；Turn Arbiter 是独立的外部提升边界。两者属于不同防线，不是重复 Reviewer。

## 8. Response Generator

### 8.1 职责

Response Generator 负责：

- 理解当前用户输入；
- 读取 accepted Conversation、当前 `brief.md` 与必要的 Published Archive；需要解析历史指代时可定向读取 `evidence.md`；
- 按 Session kind 生成用户可见 Response Candidate；
- 进行必要的澄清、建议和解释。

它不负责：

- 修改 Draft；
- 发布 World；
- 判断自身最终合规；
- 声称 Draft 已经同步；
- 将模型建议升级为 confirmed；
- 越过当前 Session phase 推进业务状态。

### 8.2 私有 Conversation revision

每个 generation attempt 从当前 accepted Conversation revision 派生：

```text
accepted C1
    |
    | materialize / copy-on-write
    v
turn/<turnId>/operations/response-<attempt>/conversation
    |
    | append current user turn
    v
Promptpile React
```

固定算法：

1. `conversationId` 为 `conv_` 加去连字符 UUID，不使用 Promptpile 私有文件内容寻址；
2. Core 将当前 accepted revision 递归复制到 transient attempt directory；只允许安全普通 UTF-8 文件和 Promptpile compression archive directory；
3. compression 只在该 attempt directory 中运行；
4. Core 向 attempt Conversation 追加且只追加当前 user turn；
5. Promptpile React 将 Final 写入同一 attempt Conversation；
6. produced 后运行 `validateConversationPromotionV1(base, attempt, userText, finalText)`；可见 transcript 相对 base 必须恰好多出当前 user 与当前 assistant，且角色交替；
7. rejected attempt 只持久化 response text、verdict 和 operation metadata，完整 Promptpile attempt directory 随 transient 清理；
8. accepted attempt 在 Commit A 前复制到 persistent `conversations/<conversationId>.prepared-<operationId>`，验证、同步并原子 rename 为最终目录；Head CAS 只引用最终目录；
9. CAS 失败时最终目录成为未引用 artifact，由 recovery 清理。

accepted attempt 中发生的 compression 随整个 revision 一起提升；rejected attempt 的 compression 永不影响 accepted Conversation。

repair constraint 由 Core 写入 attempt 独立 Context layer，不作为 user/system turn 写进 accepted transcript。Published Archive Context 同样是 execution input，不参与 `conversationId`。

Conversation revision 的可见文本总量继续受现有 compression policy 约束；单个 Response Candidate 固定最多 1 MiB UTF-8，超限按 Response operation failure 关闭。

### 8.3 Streaming

Response Candidate 在生成时立即投影给用户。流结束只进入 `verifying`，不自动变为 accepted。

Response Prompt 必须禁止：

- “已经写入 Draft”；
- “已经保存”；
- “同步完成”；
- “已经发布”。

真正的持久化结果由 Core event / TUI 展示，不由模型预先声明。

## 9. Turn Arbiter

### 9.1 输入

```text
固定 Session policy
Session kind / targetDay
当前 user turn
Response Candidate
当前 brief.md（RO）与 evidence.md read-lines tool
Published Archive retrieval tools（若 World 已初始化，RO）
Conversation provenance bundle
```

Conversation provenance bundle 由 Core 确定性生成，精确包含当前 compression summary（若存在）与当前 user 之前最近四条 accepted visible turns；不包含 superseded/abandoned generation、Thought、Observe 或 repair constraint。对于“就第二个”“按刚才那个”等指代，Arbiter 只能依据该 bundle、当前 user 原文和检索证据判断，不能只依赖当前 Assistant 的转述。

Arbiter 工具集合固定为 Archive RO（若存在）、两个 Markdown Draft 的 RO/read-lines 和 `mcp__turn_control__turn_verdict`；不提供 Draft write、Candidate 或其他业务工具。

### 9.2 原子 verdict

Arbiter 使用 operation-local `turn-control` MCP server。该 server 只监听 loopback、使用随机 operation token、不访问文件系统，只导出一个工具：

```text
mcp__turn_control__turn_verdict
```

其输入 schema 精确为：

```ts
type TurnRejectionCodeV1 =
  | 'PHASE_DRIFT'
  | 'UNAUTHORIZED_PROGRESS'
  | 'USER_DECISION_INVENTED'
  | 'PUBLISHED_FACT_CONTRADICTION'
  | 'UNSUPPORTED_CLAIM'
  | 'OTHER_POLICY_VIOLATION';

type TurnVerdictV1 =
  | {
      response: { verdict: 'ACCEPT' };
      draft:
        | { verdict: 'KEEP'; evidence?: string }
        | { verdict: 'UPDATE'; evidence: string };
    }
  | {
      response: {
        verdict: 'REJECT';
        code: TurnRejectionCodeV1;
        evidence: string;
      };
      draft: { verdict: 'DEFER' };
    };

turn_verdict(input: TurnVerdictV1)
```

固定限制：

- response evidence 最大 8 KiB UTF-8；
- draft evidence 最大 8 KiB UTF-8；
- 必填 evidence 以及实际提供的可选 evidence 必须是非空可打印文本，不允许 NUL；
- rejection code 只能来自固定 enum；
- ACCEPT 必须搭配 KEEP/UPDATE；
- REJECT 必须搭配 DEFER；
- server 第一次合法调用后封存 verdict，后续调用返回协议错误且 operation 最终失败；
- Core 只接受恰好一个成功 ToolCall/ToolResult 闭包；
- Arbiter Final 仅作调试文本，不参与业务解析。

缺失、重复、非法组合、越界 evidence、tool 成功但 child 非零退出或不完整 ToolResult 均为 `TURN_REVIEW_FAILED`。operation close 时必须终止 turn-control server。

Response REJECT 必须搭配 `draft=DEFER`，不允许提前形成 KEEP / UPDATE 结论。regeneration 后重新执行完整 Arbiter，只有最终 ACCEPT 对应的 draft verdict 生效。

Draft verdict 的含义固定为：当前 turn 新增、修改、否定用户意图，或者 accepted response 引入了以后可能被引用的具体方案/选项时，必须为 UPDATE；后者只能在 brief 中记录为拟议或未决，不能冒充用户确认。KEEP 仅用于纯解释、重复确认现有 brief 或没有后续创作价值的寒暄。这样被 Conversation compression 移除的持久语义仍能在 Markdown Draft 中找到，而不要求把每个普通聊天 turn 都复制进 Draft。

### 9.3 Rejection code

```text
PHASE_DRIFT
UNAUTHORIZED_PROGRESS
USER_DECISION_INVENTED
PUBLISHED_FACT_CONTRADICTION
UNSUPPORTED_CLAIM
OTHER_POLICY_VIOLATION
```

Arbiter 自由文本只作 evidence，不能直接成为下一轮最高优先级 Prompt。Core 按 code 构造固定 repair constraint，并对 evidence 做长度和字符边界限制。

### 9.4 Bounded regeneration

V1 固定最多一次 response repair：

```text
attempt 1 -> reject -> attempt 2 -> accept/fail
```

调用方不能配置 retry 数量。达到上限仍未通过时：

- 所有已展示 generation 保留 audit；
- 最后一条 generation 标记为 superseded；
- accepted Conversation 与 Draft 不变；
- turn 返回 policy failure；
- 不降低 policy 标准。

V1 固定 Response generation timeout 为 300 秒，Arbiter timeout 为 120 秒；repair generation 使用相同 300 秒 timeout。timeout 从 child process 启动开始计算，不包含 TUI 渲染时间。

## 10. Draft Curator

### 10.1 定位

Draft Curator 是 accepted Conversation 到 Accepted Markdown Draft Snapshot 的独立 operation，不是领域编译器，也不是第二个面向用户的聊天 Agent：

```text
accepted turn + Markdown H1 + pinned Archive
                    |
                    v
            staged Draft Curator
                    |
                    v
       brief H2 + Core-owned evidence block
```

它只在最终 Arbiter verdict 为 UPDATE 时启动；KEEP 直接完成 turn。它解决的是“逐轮保存语义交接材料”，不负责提前生成 World patch。

### 10.2 输入

```text
Session policy / kind / targetDay
current user turn（原文）
accepted assistant response（原文）
Arbiter draft evidence
current brief.md
current evidence.md（RO）
pinned Archive（RO）
与 Arbiter 相同的 Conversation provenance bundle
```

Curator 必须以 H1 的完整 `brief.md` 为 accumulator，只整理当前 accepted delta；不得从压缩 Conversation 重新总结整个 Session。`evidence.md` 用于来源追溯，不要求 Curator 每轮完整重读；当当前 turn 含指代或 H1 brief 与本轮证据冲突时，Curator 使用 read-lines 工具定向查阅。

### 10.3 权限

```text
Archive: RO
brief.md base: RO
evidence.md base: RO
brief.md staging: RW
evidence.md staging: Core-owned append only
Published World: no write
Candidate World: no access
```

Session File Runtime 只向模型暴露 `brief.md` 的 read/write 和两个 base Markdown 的 read；不提供任意文件创建、删除、move、symlink、meta、head、turn record 或 Candidate 工具。Core 在 Curator operation 成功后才向 staging `evidence.md` 追加固定 block。

### 10.4 语义整理规则

- 用户明确提供、否定、修改或确认的内容必须反映到 brief；
- Assistant 建议只有在用户明确采纳后才能写成共识；未被采纳但仍值得保留的内容只能放入拟议或未决部分；
- 用户沉默、未反对或切换话题不构成确认；
- Published World 与旧 brief 中已有内容不得因本轮无关话题被静默删除或改写；
- “就第二个”“按刚才那个”等指代必须依据 provenance bundle 或 evidence 记录解析；无法稳定解析时写入未决事项，不得猜测；
- Curator 可以重组 Markdown 结构以提高可读性，但不能把 brief 伪装成 YAML、JSON、World patch 或固定领域 schema。

这些是 AI 语义职责，不声称由程序完全证明。程序只验证第 11 节的技术不变量；Draft 的领域正确性最终仍由 Submission V2 的 Change Plan、Candidate validator 和 publisher 约束。

### 10.5 完成证据

Draft Curator 不增加业务 result tool。其完成证据固定为：

1. Promptpile React protocol 成功结束并产生非空 Final；
2. 所有文件 ToolCall/ToolResult 完整闭合；
3. staging 只改变 `brief.md`；
4. `brief.md` 相对 H1 存在非空字节 diff；
5. Core 将 current user、accepted response 和 Curator Final 组装为 evidence block 并追加到 H1 `evidence.md`；
6. 完整 H2 snapshot 通过第 11 节技术校验；
7. active Head 仍指向相同 baseDraftHash。

Curator Final 只作为本轮自然语言“整理说明”写入 evidence block，不解析为业务字段，也不能声明 hash、路径或校验结果。文件事实和 hash 全部由 Core 计算。

### 10.6 Curator repair

V1 固定最多一次 Curator repair。repair 只接收文件协议、资源限制和 technical check diagnostics，不重新运行 Response Generator，不扩大用户意图，也不把 Candidate/World validation 前移到 Draft。

连续失败后保留同一个 `pendingDraftSync`，不重新生成或撤销 accepted response。首次 Curator timeout 固定为 300 秒，repair timeout 固定为 180 秒；调用方不能覆盖 timeout 或 attempt 数量。

## 11. Markdown Draft hash 与 technical check

### 11.1 Evidence block renderer

Core 只通过纯函数 `renderEvidenceBlockV1()` 追加 evidence：

```ts
interface EvidenceBlockInputV1 {
  turnId: string;
  generationId: string;
  userInput: string;
  acceptedResponse: string;
  curatorNote: string;
}

renderEvidenceBlockV1(input: EvidenceBlockInputV1): Uint8Array;
```

`userInput` 最大 1 MiB UTF-8，`acceptedResponse` 沿用 1 MiB 上限，`curatorNote` 最大 16 KiB；三者必须是有效 UTF-8、不得含 NUL。renderer 输出固定顺序：turn heading、generationId、`user-input`、`accepted-response`、`curator-note` 三个 field。block 的首行是二级标题 `Turn` 加由反引号包围的 turnId，末尾是单个 LF。ID 使用第 4 节格式，不能包含 Markdown escape 字符。

每个 field 固定包含 name、十进制 byte length、SHA-256 和一个动态 fenced code block。fence 算法精确为：

1. 分别计算原始文本中反引号和波浪号的最长连续 run；
2. 选择最长 run 更短的字符，相等时选择反引号；
3. fence 长度为 `max(3, selectedLongestRun + 1)`；
4. opening fence 的 info string 固定为 `text`；
5. opening line 后写 LF，再逐 byte 写原始 UTF-8，再写一个 framing LF、closing fence 和 LF；即使原文已经以 LF 结尾也不省略 framing LF；
6. reader 依据声明的 byte length 取得原文，framing LF 不属于原文。

block prefix 精确为：

```text
## Turn `<turnId>`

Generation: `<generationId>`

```

field 的 Markdown 形状固定为：

```text
### <name>

Bytes: <decimal>
SHA-256: <lowercase-hex>

<dynamic-fence>text
<exact UTF-8 bytes><framing LF>
<dynamic-fence>
```

prefix 与三个 field 按上述顺序直接连接，不插入其他 bytes；field name 精确为 `user-input`、`accepted-response`、`curator-note`。

`evidence.md` 初始 bytes 固定为：

```text
# Dayloom Evidence

> Core-owned append-only evidence. Assistant text is not user confirmation.

```

Core 通过从 Turn record 重新调用 renderer 并逐 byte 比较 suffix 完成校验，不以 Markdown parser 反推业务字段。renderer 必须用含 CRLF、空文本、Unicode、不同长度反引号/波浪号和接近大小上限的 golden fixtures 冻结。

### 11.2 Snapshot hash

`baseDraftHash` 只覆盖两个固定 Markdown 文件：

```text
brief.md
evidence.md
```

canonical Draft hash 精确为 SHA-256：

```text
for relativePath in ["brief.md", "evidence.md"]:
  uint32be(pathUtf8.byteLength)
  pathUtf8
  uint64be(content.byteLength)
  content bytes
```

规则：

- 两个文件都必须存在、为安全普通文件、有效 UTF-8 且不含 NUL；
- 内容使用磁盘原始 bytes，不做换行、Unicode 或 Markdown 规范化；
- `brief.md` 最大 8 MiB，`evidence.md` 最大 32 MiB，总量最大 40 MiB；该上限允许无损包裹现有最大 4 MiB Legacy Draft，日常 Curator prompt 仍要求保持 brief 简洁；
- hash 文本为 64 位小写十六进制；
- `meta.json`、`diagnostics.json`、Aggregate Head、Conversation、Turn Audit 和 transient Change Plan 不参与 Draft hash。

### 11.3 Technical check

H2 technical check 精确验证：

1. snapshot 目录只含 `brief.md` 和 `evidence.md`；
2. `brief.md` 相对 H1 发生非空字节变化；
3. H2 `evidence.md` 以 H1 `evidence.md` 的全部 bytes 为精确前缀；
4. 新增 suffix 恰好是 Core 为当前 turn 生成的一个 block；
5. block 中的 turnId、user input、accepted response 和 Curator Final 与 Turn record bytes 精确相等；
6. 文件和总量限制满足；
7. Head base hash 尚未变化。

technical check 不解析标题，不要求固定章节，不验证 confirmed/proposed，不分配持久 ID，也不判断 Markdown 是否完整表达自然语言语义。它只证明来源没有被改写、旧 evidence 没有丢失、snapshot 技术上完整且基线未冲突。

## 12. pending Draft Sync 与恢复

当 Response 已经 Commit A，但 Draft UPDATE 未完成时：

```text
Conversation = accepted C2
Draft = base H1
pendingDraftSync = turnId
```

此时：

- `send=false`；
- `submit=false`；
- `retryDraftSync=true`；
- `cancel=true`；
- accepted response 继续保留；
- UI 明确提示回答已接受，但创作状态尚未同步。

Core 增加唯一恢复命令：

```ts
retryDraftSync(): Promise<CoreResult>;
```

它只运行 Draft Curator，不运行 Response Generator 或 Arbiter。成功后执行 Commit B 并清除 pending；失败后保持同一 pending，不产生第二个 pending turn。

`retryDraftSync()` 运行期间 public Session status 为 `running`。如果 retry 被取消或再次失败，Session 回到 ready 且同一 pending 保留。

ready + pending 状态下调用 `cancel()` 的语义固定为放弃整个 Session：

1. 以 Head CAS 将 `activeSession=null`，Draft 继续指向 H1；
2. pending turn 的 terminal status 写为 `abandoned-after-accept`；
3. accepted response 保留在本地 abandoned-session audit，不再属于 active Conversation；
4. persistent session directory 移到 `drafts/abandoned-sessions/<sessionId>`；
5. 之后不能 retry；新 Session 从 Accepted Markdown Draft Snapshot H1 开始新的 Conversation。

第 1 步的 CAS 是放弃 Session 的线性化点；第 2–4 步是幂等清理。清理中断时，该 session directory 已不具备 authority，下一次初始化依据 Head 将它补写 terminal record 并移入 `abandoned-sessions`。不得为了目录移动失败把 activeSession 写回 Head。

如果 cancel 发生在 active Curator/retry operation 中，只终止当前 operation 并保留 pending；调用方可以在回到 ready 后再次 cancel 以放弃 Session。

public `CoreSessionStatus` 不增加 degraded 枚举；capability 完全由 Aggregate Head 和 active mutation 推导。TUI 稳定命令 `/retry` 仅在 `retryDraftSync=true` 时可用。

## 13. Streaming 与 Presentation

### 13.1 Response message state

```ts
type ResponsePresentationStatus =
  | 'streaming'
  | 'verifying'
  | 'accepted'
  | 'superseded'
  | 'discarded'
  | 'cancelled'
  | 'error';
```

转换规则：

```text
response stream start     -> streaming
response stream complete  -> verifying
Arbiter ACCEPT + Commit A -> accepted
Arbiter REJECT            -> superseded
Arbiter/Commit A failure  -> discarded
cancel before Commit A    -> cancelled
operation failure         -> error
```

superseded response 默认折叠但保留全文入口。用户已经看到的内容不得在 Audit 中伪装成从未发生。

### 13.2 Thought 与 Response 分组

一次 Response attempt 就是一个 Response Operation；Promptpile Thought / Observe / Check / Final 是它的 stage。attempt 被 superseded、discarded 或 cancelled 时，TUI 按 operationId 将这些 stage 与 Response 一起折叠，不为 ReAct work 或 Thought step 建立子 operation 和单独回滚状态。

### 13.3 Event V2

Core Runtime V2 一次性切换为 operation-oriented event contract：

```ts
type CoreOperationEventV2 =
  | {
      type: 'operation.started';
      sessionId: string;
      turnId: string | null;
      operationId: string;
      groupId: string;
      kind: OperationKindV1;
      attempt: number;
    }
  | {
      type: 'operation.stage';
      sessionId: string;
      turnId: string | null;
      operationId: string;
      stage: OperationStageV1;
    }
  | {
      type: 'operation.delta';
      sessionId: string;
      turnId: string | null;
      operationId: string;
      channel: 'thought' | 'observe' | 'check' | 'response';
      text: string;
    }
  | {
      type: 'operation.diagnostics';
      sessionId: string;
      turnId: string | null;
      operationId: string;
      items: readonly ValidationIssueV1[];
    }
  | {
      type: 'operation.produced';
      sessionId: string;
      turnId: string | null;
      operationId: string;
      artifactId: string;
    }
  | {
      type: 'operation.finished';
      sessionId: string;
      turnId: string | null;
      operationId: string;
      disposition: OperationDispositionV1;
      message?: string;
    }
  | {
      type: 'turn.commit';
      sessionId: string;
      turnId: string;
      commit: 'response' | 'draft';
      headRevision: number;
    }
  | {
      type: 'turn.terminal';
      sessionId: string;
      turnId: string;
      status:
        | 'committed'
        | 'draft-sync-pending'
        | 'policy-rejected'
        | 'abandoned-after-accept'
        | 'cancelled'
        | 'failed';
    };

type CoreEventV2 =
  | { type: 'state.changed'; state: Readonly<CoreStateV2> }
  | CoreOperationEventV2;
```

`operation.produced` 只表示 artifact 完整产生；`operation.finished(committed)` 才表示其 artifact 已被相应 Coordinator 接受。`operation.diagnostics` 只承载程序验证或 operation failure 的结构化诊断，不承载模型自然语言结论。`turn.commit` 必须在对应 Head CAS 成功后发送；`turn.terminal` 是该 turn 最后一个非 `state.changed` 事件。

固定事件不变量：

- `state.changed(status=running)` 先于本 turn 第一个 `operation.started`；
- 每个 operation 恰好一个 started 和一个 finished；
- produced 最多一次，并且只能位于 started 与 finished 之间；
- finished 后禁止同 operation 的 stage、delta、diagnostics、produced；
- 同一进程中的事件保持发送顺序，listener exception 被隔离；
- `turn.terminal` 后禁止该 turn 的任何 operation event；
- `state.changed(status=ready)` 紧随 `turn.terminal`；
- stale operationId 或已经 terminal 的 turn event 必须被 Core 和 TUI 忽略。

固定成功序列：

```text
ACCEPT + KEEP
  response started/stage/delta/produced
  arbitration started/produced/finished(committed)
  Head CAS Commit A
  turn.commit(response)
  response finished(committed)
  turn.terminal(committed)
  state.changed(ready)

ACCEPT + UPDATE
  response started/stage/delta/produced
  arbitration started/produced/finished(committed)
  Head CAS Commit A
  turn.commit(response)
  response finished(committed)
  draft-curation started/stage/produced
  Head CAS Commit B
  turn.commit(draft)
  draft-curation finished(committed)
  turn.terminal(committed)
  state.changed(ready)
```

固定拒绝与失败序列：

```text
REJECT + REPAIR
  arbitration-N finished(committed)
  response-N finished(superseded)
  response-(N+1) started

POLICY LIMIT
  arbitration-2 finished(committed)
  response-2 finished(superseded)
  turn.terminal(policy-rejected)

COMMIT A 后 Curator fail/cancel
  draft-curation finished(failed|cancelled)
  turn.terminal(draft-sync-pending)

COMMIT A 前 cancel
  每个 started-but-unfinished operation 按实际原因 finished(cancelled|failed)
  turn.terminal(cancelled)
```

失败 disposition 固定映射如下，Coordinator 不得自行选择：

| 失败点 | Response | 当前辅助 operation | Turn |
| --- | --- | --- | --- |
| Response execution/protocol/size | `failed` | 无 | `failed` |
| Arbiter execution/tool/protocol | `discarded` | Arbitration `failed` | `failed` |
| Arbiter REJECT 且仍有 repair | `superseded` | Arbitration `committed` | 继续下一 attempt |
| Arbiter REJECT 且达上限 | `superseded` | Arbitration `committed` | `policy-rejected` |
| Conversation promotion validate/materialize | `discarded` | Arbitration `committed` | `failed` |
| Commit A CAS conflict | `discarded` | Arbitration `committed` | `failed` |
| Curator execution/technical check | 已 `committed` | Draft Curation `failed` | `draft-sync-pending` |
| Commit B CAS conflict | 已 `committed` | Draft Curation `failed` | `draft-sync-pending` |

上述表中的 Turn 值即 `turn.terminal.status`；public error code 由第 18 节映射。Commit A 后 Response 已经终局为 committed，后续 Curator 失败不得再次改写其 disposition。

CoreEvent V2 采用一次性切换，不在生产 reducer 中长期保留 V1/V2 双轨。

## 14. Cancellation linearization

取消语义只围绕两次 Aggregate Head CAS 决定，不在每个阶段实现不同补偿。Core 在准备 CAS 前读取 cancel flag；CAS 成功后该 commit 不再接受撤销。

### 14.1 Commit A 前

包括 Response、Arbiter 和 regeneration：

- 终止 active operation 的 process/resources；
- attempt 标记 cancelled；
- accepted Conversation 与 Draft head 不变；
- 不启动后续 operation。
- `send()` 返回 `CANCELLED`，Session 回到 ready 且无 pending。

### 14.2 Commit A 后、Commit B 前

- accepted Conversation 保留；
- Draft working copy 丢弃；
- pendingDraftSync 保留；
- 正在运行的 `send()` 或 `retryDraftSync()` 返回 `CANCELLED`；
- turn terminal 投影为 `draft-sync-pending`；
- 后续只允许 retry Draft Curator 或取消 Session。

### 14.3 Commit B 后

turn 已经完成。此后到达的 interrupt cancel 不得回滚该 turn；如果调用方随后在 ready 状态再次调用 `cancel()`，其含义是放弃整个 Session，而不是撤销已经完成的 turn。

Head CAS 是唯一线性化点。若 cancel 与 CAS 竞争：CAS helper 开始前已观察到 cancel 则不写 Head；否则以 CAS 结果为准。晚到的 operation delta 由 terminal guard 丢弃。

## 15. 权限模型

权限是 Operation kind 的属性，而不是 Session Agent 的永久能力。

| Operation | Published Archive | Draft base | Draft staging | Candidate | 用户可见输出 |
| --- | --- | --- | --- | --- | --- |
| Response Generator | RO | RO | 无 | 无 | 是 |
| Turn Arbiter | RO | RO | 无 | 无 | 否 |
| Draft Curator | RO | brief/evidence RO | brief staging RW | 无 | 否 |
| Submission Converter | RO | RO | 无 | RW | 否 |
| Submission Reviewer | RO | RO | 无 | RO | 否 |

Session File Runtime 按 operation 创建 role-specific binding。Response Generator 的工具集合不包含 `mcp__draft__write_file`；不能只依赖 Prompt 声明只读。

## 16. Audit

Turn Audit 区分 presentation history 与 accepted semantic history。

### 16.1 Turn Audit

```ts
interface TurnAuditV1 {
  schemaVersion: 1;
  sessionId: string;
  turnId: string;
  userInput: string;
  baseConversationId: string;
  baseDraftHash: string;
  generationAttempts: Array<{
    generationId: string;
    operationId: string;
    attempt: 1 | 2;
    responseText: string;
    complete: boolean;
    disposition: OperationDispositionV1;
    verdict: TurnVerdictV1 | null;
  }>;
  acceptedGenerationId: string | null;
  draftVerdict: 'KEEP' | 'UPDATE' | null;
  resultDraftHash: string | null;
  curationAttempts: Array<{
    operationId: string;
    attempt: 1 | 2;
    disposition: OperationDispositionV1;
    baseDraftHash: string;
    resultDraftHash: string | null;
    diagnostics: ValidationIssueV1[];
  }>;
  terminalStatus:
    | 'committed'
    | 'draft-sync-pending'
    | 'policy-rejected'
    | 'abandoned-after-accept'
    | 'cancelled'
    | 'failed';
}
```

Turn record 在每个 produced、verdict、curation attempt terminal 和 turn terminal 后使用原子文件替换更新，但它不决定 authority。正式 Conversation transcript 从 Aggregate Head 指向的 immutable Conversation revision 导出，只包含 accepted generation。

Core 在内存中累积每个 response stream，并在 operation produced/discarded/cancelled/failed 时一次性写入 audit；不持久化每个 delta。完整产生或正常取消的 generation 可审计；进程被强制终止时，尚未写入 terminal record 的部分 delta 只属于 presentation，不承诺跨进程恢复。Conversation compression 只作用于 accepted Conversation，不读取 attempt audit。

固定限制：每个 responseText 最大 1 MiB UTF-8、每个 Turn record 最大 3 MiB UTF-8、最多两个 generation attempts 和两个 curation attempts、diagnostics 受 Core Runtime V2 固定上限约束。超限 operation 失败关闭。

submit 时 Core 在现有 audit namespace 新增而不改写现有 schema：

```text
audit/sessions/<sessionId>/turns/index.json
audit/sessions/<sessionId>/turns/<turnId>.json
```

`index.json` 精确列出按 Conversation 顺序排列的 turnId 与对应文件 hash。每个 turn 文件是上述 `TurnAuditV1`。Thought / Observe / Check 全文不进入 Published World audit；只保留 operation ID、阶段、terminal disposition 和必要 diagnostics。该新增由 Session Submission V2 冻结，不改变 Archive business publish path。

### 16.2 Published Submission Audit V2

新 publish writer 固定写入：

```text
audit/sessions/<sessionId>/
  meta.json
  transcript.json
  draft-index.json
  draft/brief.md
  draft/evidence.md
  turns/index.json
  turns/<turnId>.json
  change-plan.json
  assignment.json
  conversion-transcript.json
  validation.json
  review.json
  candidate-diff.json
```

`meta.json` 精确为：

```ts
interface SubmissionAuditMetaV2 {
  schemaVersion: 2;
  sessionId: string;
  kind: CoreSessionKind;
  sourceFormat: 'markdown-v2' | 'submission-v1-import';
  draftId: string;
  draftHash: string;
  briefHash: string;
  evidenceHash: string;
  baseWorldCommitId: string | null;
  baseRootTreeHash: string | null;
  changePlanHash: string;
  assignmentHash: string;
  turnIndexHash: string;
}

interface DraftIndexV2 {
  schemaVersion: 2;
  files: Array<{ path: 'brief.md' | 'evidence.md'; bytes: number; sha256: string }>;
}

interface ConversionTranscriptAuditV2 {
  schemaVersion: 2;
  changePlanHash: string;
  rounds: Array<{
    phase: 'convert' | 'repair';
    attempt: number;
    transcript: VisibleTranscriptV1;
  }>;
}

interface ValidationAuditV2 {
  schemaVersion: 2;
  changePlanHash: string;
  diagnostics: ValidationIssueV1[];
}

interface ReviewAuditV2 {
  schemaVersion: 2;
  changePlanHash: string;
  result: null | {
    advisory: Array<{ code: string; paths: string[]; reason: string; evidence: string }>;
  };
  diagnostics: ValidationIssueV1[];
}

interface CandidateDiffAuditV2 {
  schemaVersion: 2;
  changePlanHash: string;
  changes: Array<
    | { op: 'put'; path: string; mediaType: string; bytes: number; sha256: string }
    | { op: 'remove'; path: string }
  >;
}
```

`change-plan.json` 是第 17 节 canonical JSON，`assignment.json` 是对应 `ChangePlanAssignmentV2`；assignment canonical key order 固定为 schemaVersion、planHash、baseRootTreeHash、assignedIds，assignedIds key 按 ASCII bytes 排序。changePlanHash/assignmentHash 分别是两个完整 JSON 文件 bytes 的 SHA-256。draft-index files 顺序固定为 brief、evidence；briefHash/evidenceHash 是原始文件 bytes hash，turnIndexHash 是完整 `turns/index.json` bytes hash。`transcript.json` 继续使用 `VisibleTranscriptV1`；其余文件精确使用上述 V2 wrapper。所有 object 拒绝额外字段，所有数组保持业务发生顺序，diagnostics 继续使用冻结排序。任何字段不得包含 Thought 全文。

candidate diff 继续只记录实际 put/remove 的 path、mediaType、bytes 和 content hash。Audit 不嵌入本次 published commitId，因为 commitId 取决于包含 audit 自身的最终 tree；Archive commit/tree 已提供无递归的关联。

### 16.3 历史读取策略

- 已发布的 V1 audit 永不重写或补造缺失 turn/change-plan；
- audit reader 只依据 `meta.json.schemaVersion` dispatch `SubmissionAuditV1 | SubmissionAuditV2`；未知版本失败关闭；
- V1 reader 保留现有严格校验，缺失的 V2 字段在统一只读 view 中为 null，不从 transcript 猜测；
- 当前 writer 永远只写 V2，生产代码不存在 caller-selectable V1 writer；
- active Legacy Draft 迁移后的首次 publish 写 V2，并以 `sourceFormat='submission-v1-import'` 和 legacy import manifest 保留来源。

这属于历史格式读取，不是新旧业务双轨。

## 17. Session Submission V2

Markdown Draft 不是可执行 World patch。Submission V2 在提交期把自然语言交接材料转换成 transient structured plan，再形成 Candidate：

```text
Accepted Markdown Draft Snapshot
  -> technical check
  -> conversion operation reads brief + evidence + pinned World
  -> declare transient Change Plan
  -> Core policy check + ID assignment
  -> converter writes Candidate Overlay
  -> Candidate validation / bounded repair
  -> advisory review
  -> diff
  -> Archive V2 atomic publish
  -> audit
```

提交前必须满足 `pendingDraftSync == null`。pending 存在时 `submit()` 返回 `NOT_AVAILABLE`，不得启动 technical check 或 conversion。

### 17.1 Transient Change Plan

Submission Converter 通过 operation-local Candidate MCP 的一次性 `declare_change_plan` tool 声明本次实际变更范围。Change Plan 只包含 Candidate 构建所需的结构化 identity/action manifest、目标 World 引用和 Markdown evidence location，不复制 Draft 全文，也不成为新的持久 authority。

Converter 以 `brief.md` 作为当前交接摘要，以 `evidence.md` 作为来源追溯。evidence 中的 Assistant 文本本身不构成用户确认；只有 brief 明确列为共识且能追溯到 user field，或当前 Published World 已经确认的内容，才能作为确定变更。拟议和未决内容不进入 Change Plan；如果当前 Session 的必需提交信息仍未确定，则 conversion 失败并返回诊断。brief/evidence/Published World 冲突且无法按明确的后续用户否定或修改消解时同样失败，不得自行补全。

#### 17.1.1 精确 schema

```ts
type ChangeResourceKindV2 =
  | 'world-profile' | 'world-state'
  | 'character' | 'location' | 'arc'
  | 'fact' | 'thread' | 'story-seed' | 'location-trigger'
  | 'day-plan' | 'plan-beat' | 'event'
  | 'canon-field' | 'character-profile' | 'location-profile' | 'arc-profile'
  | 'world-variable' | 'character-status' | 'character-location'
  | 'location-status' | 'arc-stage';

type ChangeEvidenceRefV2 =
  | {
      source: 'brief';
      startLine: number;
      endLine: number;
      sha256: string;
    }
  | {
      source: 'evidence';
      turnId: string;
      field: 'user-input' | 'accepted-response' | 'curator-note';
      sha256: string;
    }
  | {
      source: 'published';
      path: string;
      startLine: number;
      endLine: number;
      sha256: string;
    }
  | {
      source: 'legacy-import';
      path: string;
      sha256: string;
    };

type ChangeIntentV2 =
  | {
      localKey: string;
      action: 'create';
      resourceKind: ChangeResourceKindV2;
      targetId: null;
      parentLocalKey: string | null;
      evidence: ChangeEvidenceRefV2[];
    }
  | {
      localKey: string;
      action: 'update' | 'remove';
      resourceKind: ChangeResourceKindV2;
      targetId: string;
      parentLocalKey: null;
      evidence: ChangeEvidenceRefV2[];
    };

interface ChangePlanV2 {
  schemaVersion: 2;
  sessionKind: CoreSessionKind;
  baseDraftHash: string;
  baseWorldCommitId: string | null;
  targetDay: string | null;
  changes: ChangeIntentV2[];
}

interface ChangePlanAssignmentV2 {
  schemaVersion: 2;
  planHash: string;
  baseRootTreeHash: string | null;
  assignedIds: Readonly<Record<string, string>>;
}

declare_change_plan(input: ChangePlanV2): ChangePlanAssignmentV2;
```

所有 object 拒绝额外字段。`localKey` 匹配 `[a-z][a-z0-9-]{0,63}`，在 plan 内唯一；changes 为 1–1024 项，每项 evidence 为 1–8 项。line 为 1-based inclusive 正整数，`startLine <= endLine`；range hash 覆盖从 startLine 首 byte 到 endLine 行终止符末 byte，文件末行没有终止符时止于 EOF。evidence field hash 覆盖第 11 节 renderer 声明的原始 field bytes；legacy-import hash 覆盖迁移前源文件原始 bytes。path 必须通过对应 Archive normalized-relative-path policy；所有 hash 为 64 位小写十六进制。

每项 change 必须至少引用一个 `brief` range，并至少引用一个 `evidence.user-input`；由 Legacy V1 迁移但尚无 turn evidence 的初始内容，以 `legacy-import` 替代 user-input。`accepted-response` 和 `curator-note` 只能补充指代上下文，不能单独证明用户确认。Core 验证引用目标、range bytes 与 hash 存在且匹配；Reviewer 继续负责自然语言是否真正支持 change 的语义判断。

#### 17.1.2 Per-kind action matrix

下表是完整 allowlist，未列组合一律拒绝：

| Session kind | create | update | remove |
| --- | --- | --- | --- |
| init | world-profile, world-state, character, location, arc, fact, thread, story-seed, location-trigger | 无 | 无 |
| planning | day-plan, plan-beat | 无 | 无 |
| play | event | world-variable, character-status, character-location, location-status, arc-stage | 无 |
| revise | character, location, arc, story-seed, location-trigger | canon-field, character-profile, location-profile, arc-profile, world-variable, character-status, character-location, location-status, arc-stage | story-seed |

`location-trigger/create` 的 `parentLocalKey` 必须引用同一 plan 中的 `location/create`；其他组合的 parentLocalKey 必须为 null。update/remove 的 targetId 必须存在于 pinned World 且类型匹配。`world-profile`、`world-state` 和 `day-plan` 是 singleton，各自在 plan 中最多出现一次且不分配持久 ID。legacy-import ref 只允许用于 `DraftMetaV2` 标记为 V1 migration 的 snapshot，path 必须出现在 import manifest。

需要 ID 的 create resource 固定为 character、location、arc、fact、thread、story-seed、location-trigger、plan-beat 和 event；前缀依次为 character、location、arc、fact、thread、seed、trigger、beat、event。Core 按 changes 数组顺序分配；Init/Planning/Play 从对应前缀 1 开始，Revise 在当前 World 与全部历史 assignment 已使用数字之外选择最小正整数。trigger 编号在各 parentLocalKey 内独立从 1 开始。assignedIds 只包含这些 create localKey，key 按 ASCII byte order 序列化；repair 不重新分配。

#### 17.1.3 Tool closure 与 canonical hash

operation-local server 的第一次 ToolCall 即封存调用：非法 input 直接使 conversion operation 失败，后续调用返回协议错误；合法调用必须形成恰好一个完整 ToolCall/ToolResult。Core 以字段声明顺序重新构造 exact object，保持 changes/evidence 数组顺序，使用无空白 `JSON.stringify` UTF-8 bytes 计算 SHA-256 planHash；禁止依赖模型提供的 object property order。

Core 在 ToolResult 中返回本次 conversion 固定的 assignment，并把同一 canonical plan 与 assignment 分别写入 transient `change-plan.json` 和 `assignment.json`。现有 ID 不复用、Session kind policy、Revise allowed paths 和 pinned World base check 全部在该边界执行。tool 关闭后 plan 与 assignment 在当前 submit 内不可改变；convert 后的 bounded repair 只读这两个文件，不重新解释 Draft 或扩大变更范围。

Change Plan、assignment 和 Candidate 都位于 transient submit workspace。提交失败或取消时可以整体丢弃；只有最终 submission audit 保留它们的 hash、实际 assignment 和验证结果。Draft 不保存 stable key、持久 ID 或 World operation schema。

### 17.2 Snapshot 接口

```ts
interface DraftMetaV2 {
  schemaVersion: 2;
  draftId: string;
  sourceFormat: 'markdown-v2' | 'submission-v1-import';
  kind: CoreSessionKind;
  worldIdentity: string;
  baseCommitId: string | null;
  baseRootTreeHash: string | null;
  targetDay: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MarkdownDraftSnapshotV2 {
  draftId: string;
  hash: string;
  root: string;
  briefPath: 'brief.md';
  evidencePath: 'evidence.md';
  meta: Readonly<DraftMetaV2>;
}

type DraftTechnicalCheckV2 =
  | { ok: true }
  | { ok: false; diagnostics: readonly ValidationIssueV1[] };

interface PreparedDraftArchiveV2 {
  commit(): Promise<string>;
  rollback(): Promise<void>;
}

interface DraftHandleV2 {
  readonly id: string;
  head(): Promise<Readonly<AggregateHeadV1>>;
  snapshot(): Promise<Readonly<MarkdownDraftSnapshotV2>>;
  technicalCheck(snapshot: MarkdownDraftSnapshotV2): Promise<DraftTechnicalCheckV2>;
  writeDiagnostics(items: readonly ValidationIssueV1[]): Promise<void>;
  prepareArchive(snapshot: MarkdownDraftSnapshotV2): Promise<PreparedDraftArchiveV2>;
}
```

`snapshot()` 固定 hash/root/meta，后续 Head 改变不改变该对象。Submission 只读取 snapshot 中的两个 Markdown 文件；publisher 前继续比较 World pinned revision，并额外确认 Aggregate Head 仍指向 snapshot.hash 且 pending 为 null。

### 17.3 Breaking boundary

Session Submission V2 明确退役：

- Session Submission V1 的 `draft.yaml` 与 `content/**` Draft Format；
- Draft `confirmed/proposed` 字段与提交前 confirmed completeness lint；
- 从 Draft stable key 直接生成 assignment；
- `DraftHandleV1.root` 可变目录语义；
- 旧 `work.*` / `output.*` / `submission.stage` public event。

Candidate schema、World validator、bounded Candidate repair、advisory review、diff 和 Archive publisher 的业务语义保持不变。变化集中在 Candidate 之前：持久输入从 YAML IR 改为 Markdown handoff，结构化 planning 移到一次 submit operation 内。

## 18. Core 状态、API 与错误

public Session status 固定保持：

```text
ready
running
submitting
```

Core State V2 精确扩展为：

```ts
type CoreSessionStatus = 'ready' | 'running' | 'submitting';

interface CoreCapabilitiesV2 {
  startSessions: readonly CoreSessionKind[];
  settle: boolean;
  abandonDay: boolean;
  send: boolean;
  submit: boolean;
  retryDraftSync: boolean;
  cancel: boolean;
}

interface CoreStateV2 {
  world: CoreWorldState;
  session: null | {
    id: string;
    kind: CoreSessionKind;
    status: CoreSessionStatus;
    draftSync:
      | { status: 'clean' }
      | { status: 'pending'; turnId: string };
  };
  capabilities: CoreCapabilitiesV2;
}
```

`draftSync` 是 Aggregate Head 的只读 public projection，不是第二份状态。Core 初始化恢复 persistent activeSession 后，第一次 `getState()` 必须直接反映恢复的 Session、draftSync 与 capability。

`DayloomCore` 的现有方法签名保持不变，并新增：

```ts
retryDraftSync(): Promise<CoreResult>;
```

`getState()` 返回 `CoreStateV2`，`subscribe()` 接收 `CoreEventV2`。`DayloomCore`、`CoreState`、`CoreEvent` 与 `CoreErrorCode` 作为 Core Runtime V2 一次性切换；不提供 V1/V2 caller-selectable 双轨。

固定 capability 矩阵：

| Session | mutation | pending | send | submit | retryDraftSync | cancel |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| null | false | 无 | false | false | false | false |
| ready | false | 无 | true | true | false | true |
| ready | false | 有 | false | false | true | true |
| running | true | 任意 | false | false | false | true |
| submitting | true | 无 | false | false | false | true |

pending 存在时 `ready` 只表示当前没有 active operation。`retryDraftSync()` 将 status 切到 running；并发 mutation 继续返回 BUSY；能力为 false 的命令返回 NOT_AVAILABLE。

Core Runtime V2 新增并冻结 public error code：

```text
TURN_POLICY_REJECTED
TURN_REVIEW_FAILED
DRAFT_SYNC_FAILED
DRAFT_CONFLICT
```

继续复用 `AGENT_FAILED`、`CONVERSATION_FAILED`、`CONVERSION_FAILED`、`CANDIDATE_INVALID`、`CANCELLED`、`BUSY`、`NOT_AVAILABLE`。固定映射：

| 故障 | public code | 最终 Session |
| --- | --- | --- |
| response repair 达上限 | TURN_POLICY_REJECTED | ready，无 pending |
| Arbiter tool/protocol/timeout 失败 | TURN_REVIEW_FAILED | ready，无 pending |
| Response Generator protocol 失败 | AGENT_FAILED | ready，无 pending |
| Conversation materialize/validate 失败 | CONVERSATION_FAILED | ready，无 pending |
| Curator 执行、technical check 或 repair 达上限 | DRAFT_SYNC_FAILED | ready，有 pending |
| Change Plan tool/policy 失败 | CONVERSION_FAILED | ready，无 pending |
| Draft base 或 Head CAS 冲突 | DRAFT_CONFLICT | ready；Commit A 后保留 pending，否则无 pending |
| Legacy Draft validate/render 失败 | DRAFT_MIGRATION_FAILED | Core 初始化失败；Legacy bytes 不变 |
| Commit A 前取消 | CANCELLED | ready，无 pending |
| Commit A 后取消 | CANCELLED | ready，有 pending |

`CoreInitializationErrorCode` V2 同时新增 `DRAFT_MIGRATION_FAILED`；普通 turn/submit 不返回该 code。

上述 turn 失败不再自动 terminalize 整个 Session。只有持久 Head 无法解析、引用 artifact 缺失或 world writer lock 所有权丢失属于不可恢复 INTERNAL_ERROR，并关闭 Session。

## 19. 代码边界

固定新增：

```text
packages/core/src/session/operation/
  scope.ts
  store.ts
  events.ts
  lifecycle.ts

packages/core/src/session/turn/
  coordinator.ts
  response-generator.ts
  arbiter.ts
  draft-curator.ts
  verdict.ts
  types.ts

packages/core/src/session/store/
  head.ts
  conversation-revision.ts
  markdown-draft-snapshot.ts
  turn-audit.ts
```

职责调整：

- `promptpile/react-runner.ts` 继续作为纯 Process Pile 协议适配器，不决定业务 accepted 语义；
- `core.ts` 只负责 capability、public state、命令入口和结果映射；
- `TurnCoordinatorV1` 编排固定 generate / arbitrate / curate 主线；
- `OperationScopeV1` 统一 process/resources、workspace、cancel 和 event terminal guard；
- `AggregateHeadStoreV1` 独占 authority CAS；
- `submission-pipeline.ts` 保留 Candidate validation/publish 主线，在 Candidate 之前增加 operation-local Change Plan/assignment boundary，并接入 Operation Scope。

禁止把 generation attempts、pending sync、Draft staging 和 verdict parsing 继续堆进 `core.ts`。

## 20. 明确不做的设计

V1 不做：

- 通用 DAG / workflow engine；
- 任意 operation 嵌套；
- 并行 response generation；
- 多个 pending turn；
- Draft 分支、merge 或 rebase；
- 调用方可配置 retry；
- public internal phase 状态爆炸；
- 持久化每个流式 delta；
- 对用户已经看到的内容做物理删除；
- Thought step 级文件快照；
- 持久 YAML/JSON Draft、Draft stable key 或 Draft-driven ID assignment；
- 由程序解析 Markdown 标题来推导领域字段或确认状态；
- 可由模型任意创建的 Draft 文件树；
- 生产路径长期保留旧 send 与 Turn Commit 双轨。

本设计固定：

```text
一个 active Turn
一个 pending Draft Sync
一套 Operation Scope
一个 Aggregate Head
固定顺序 Coordinator
不可变 artifact 目录
两次 authority CAS
两个 Markdown Draft 文件
一个 transient Change Plan boundary
```

## 21. 实现拆分

### Stage 0：提取并冻结实施契约

先形成：

```text
doc/contracts/SPECULATIVE_OPERATION_AND_AUTHORITY_V1.md
doc/contracts/CONVERSATION_TURN_COMMIT_V1.md
doc/contracts/SESSION_SUBMISSION_V2.md
doc/contracts/CORE_RUNTIME_V2.md
```

这些契约从本文提取精确 MUST/MUST NOT、类型、数值、事件顺序和迁移规则；契约通过评审后再开始生产实现。本文继续保留设计原因和解释，不承担规范冲突裁决。

### Stage 1：抽出 Operation Scope

- 从 `core.ts` 抽出 operationId、active process/resources、workPath、cancel 和 event projection；
- 保持现有单 Agent `send()` 行为不变；
- Promptpile private work 继续由 Promptpile 清理；
- 为 Submission operation 预留同一接口。

### Stage 2：Aggregate Head、immutable revision 与迁移

- 建立 immutable Conversation revision；
- 建立 `brief.md + evidence.md` canonical Draft hash；
- 建立 immutable Markdown Draft snapshot；
- 实现 Head CAS；
- 实现未引用 staging 的 crash recovery；
- 实现 legacy active Draft 的一次性迁移；
- DraftHandle V2 对 Submission 提供固定 snapshot。

### Stage 3：Response operation 与 Event V2

- generation 使用私有 Conversation；
- Final 变为 produced Response Candidate；
- 保持即时 streaming；
- TUI 按 groupId/operationId 支持 verifying、superseded、discarded、cancelled；
- operation 只在 disposition 后终止。

### Stage 4：Turn Arbiter

- 新增单一 `turn_verdict` tool；
- 新增 stable rejection code；
- 实现固定一次 repair；
- 实现 Commit A；
- rejected generation 不进入 accepted transcript。

### Stage 5：Draft Curator

- staging `brief.md` RW，base brief/evidence RO；
- Core-owned evidence block append；
- technical check / canonical hash / byte diff；
- 固定一次 Curator repair；
- 实现 Commit B；
- 实现 pendingDraftSync 与 `retryDraftSync()`。

### Stage 6：四类 Session 一次性切换

- Response Generator 去 Draft 写权；
- 删除 ordinary response Prompt 中的 Draft write obligation；
- Init / Planning / Play / Revise 同时进入新 Coordinator；
- 删除生产旧路径，不保留 feature-selectable 双轨。

### Stage 7：Submission 与 Audit 对齐

- 正式 transcript 从 accepted Conversation revision 导出；
- Turn Audit 聚合进入 Submission audit；
- 增加 transient `declare_change_plan` / assignment boundary；
- 退役 YAML Draft-driven assignment 与 confirmed completeness lint；
- Submission operations 接入统一 Operation Scope / Event V2；
- 不修改 Candidate、validator 与 Archive publish 业务契约。

### Stage 8：契约符合性报告

完成 fault injection 和真实 TUI 验证后形成：

```text
doc/contracts/CONVERSATION_TURN_COMMIT_V1_CONFORMANCE_REPORT.md
```

并核对 Core Runtime V2、Session Manager、Prompt Traceability、Session Submission V2 和 TUI 设计文档与冻结契约完全一致。

## 22. 验收测试

### 22.1 Thought / provenance

- Thought proposal 不得被 Observe 标为 user-confirmed；
- Continue 只能用于取得新权威证据；
- Final 漂移时 Arbiter 能拒绝；
- attempt superseded 时相关 Thought work 一起折叠。

### 22.2 Response

- candidate 生成时立即收到流式 delta；
- stream 完成后状态为 verifying；
- rejected candidate 标记 superseded；
- rejected candidate 不进入下一轮上下文或 compression；
- repair 使用相同 user turn 和 Core-owned constraint；
- 成功 turn 的最终 accepted generation 恰好一个；
- repair 达上限时 Conversation 与 Draft head 不变。

### 22.3 Draft

- KEEP 不启动 Curator；
- UPDATE 必须启动 Curator；
- UPDATE 的 result hash 必须变化；
- H2 `evidence.md` 精确保留 H1 bytes 并追加当前 accepted turn block；
- evidence block 的 user/response bytes 与 Turn record 精确一致；
- dynamic fence renderer 对 CRLF、Unicode、空文本和任意反引号/波浪号 run 产生稳定 golden bytes；
- Curator、technical check、cancel 或 crash 不污染 active Draft；
- 程序不解析 Markdown 标题、stable key 或 confirmed/proposed；
- base hash conflict 不覆盖当前 Draft；
- Curator 失败产生且只产生一个 pending sync；
- retry 只运行 Curator。

### 22.4 Head 与取消

- Commit A 前 cancel 不改变 Head；
- Commit A 后 cancel 保留 accepted Conversation 并保留 pending；
- Commit B 成功后 cancel 不回滚 turn；
- 任意 crash 后都能从 Head 唯一恢复 authority；
- 未引用 artifact 永不被 Submission 读取。

### 22.5 Audit / Submission

- 正式 transcript 只含 accepted generation；
- Turn Audit 包含全部完整产生或正常终止的实际展示 generation；进程被强制终止前尚未落盘的 partial delta 按第 16 节处理；
- pending 存在时 submit 被拒绝；
- pending 清除后 Submission 只读取 Head 指向的 Draft；
- Submission Converter 必须先声明 transient Change Plan，assignment 在 tool close 后固定；
- Change Plan extra field、非法 matrix 组合、错误 range/hash、缺少 user evidence 和第二次 tool call 全部失败关闭；
- repair 复用同一 Change Plan/assignment，不扩大变更范围；
- Candidate validation、review、diff 和 Archive publish 业务行为保持不变。

### 22.6 Event、恢复与迁移

- 第 13 节每条固定事件序列都有 reducer contract test，任何 operation 在 finished 后的 event 均被丢弃；
- 在 prepared artifact 写入、artifact rename、Commit A CAS、Commit B CAS 和 abandoned-session cleanup 的每个边界执行 crash fault injection；恢复后的 authority 必须只由 Aggregate Head 决定；
- Windows 与 POSIX 分别验证 Head atomic replacement、并发 CAS、未引用 artifact 清理和目录移动失败恢复；
- legacy slot 在迁移每一步 crash 后均能幂等重试，且 Head 线性化后永不回读旧根级业务文件；
- 已发布 V1 audit bytes 保持不变，reader 可读取 V1/V2，writer 只产生 V2；
- Head JSON 损坏、引用缺失或 hash 不匹配必须关闭 Session 并返回 INTERNAL_ERROR，不得猜测或扫描目录选取 authority；
- Event V1 生产 reducer、旧可变 Draft 读取路径和 caller-selectable compatibility flag 在切换后均不存在。

## 23. 冻结实施决策与迁移

### 23.1 固定实现参数

- Response generation / repair timeout：300 秒；
- Arbiter timeout：120 秒；
- Draft Curator 首次 timeout：300 秒；
- Draft Curator repair timeout：180 秒；
- Response 最多两个 attempts；
- Curator 最多两个 attempts；
- Arbiter 使用 operation-local `turn-control` MCP server 和唯一 `turn_verdict` tool；
- Curator 不使用业务 result tool，Core 只依据 protocol completion、固定文件、append-only evidence、byte diff、technical check 与 Head CAS；
- Draft 与 active Session 共用一个 Aggregate Head，不使用二级可变 pointer；
- Head replacement 复用 Archive current pointer 的 atomic helper；
- superseded Response 在 TUI 默认折叠，保留显式展开全文入口；
- `retryDraftSync()` 是稳定 public API，`capabilities.retryDraftSync` 是所有调用方的唯一发现方式；
- Turn Audit 按第 16 节进入独立 World audit 文件，不修改既有 transcript schema。

### 23.2 本地 artifact 保留

- active Session 的 Conversation、Turn record 和 committed Markdown snapshot 持久保留直到 submit、ready cancel 或 slot stale；
- submit 成功后按 Draft archive transaction 一起归档；Published World audit 是跨 runtime 的权威审计；
- ready cancel 后 session directory 移入 `drafts/abandoned-sessions/<sessionId>`，本版本不自动按时间删除；
- rejected/failed operation 的完整 Promptpile private work 不持久保留，只保留第 16 节限定的 response、verdict、hash 和 diagnostics；
- transient Change Plan、assignment、Candidate 和其他 orphan 在下一次 Core 初始化时确定性删除。

### 23.3 Legacy YAML Draft 一次性迁移

实现发布时可能存在 Session Submission V1 布局：

```text
drafts/active/<slot>/
  meta.json
  draft.yaml
  content/**
  diagnostics.json
```

迁移不得调用模型，否则 Core 初始化会引入非确定性和外部依赖。Legacy renderer 固定执行：

1. source 顺序为 `draft.yaml`，随后是按 relative path UTF-8 bytes 升序的 `content/**/*.md`；
2. `brief.md` prefix 精确为 `# Imported Session Submission V1 Draft`、空行、`> Lossless mechanical import; not a new Draft schema.`、两个 LF；
3. 每个 source 输出二级标题 `Source: <path>`（path 使用反引号包围）、Bytes、SHA-256 和 fenced body；fence 字符/长度与第 11.1 节算法相同，`draft.yaml` info string 为 `yaml`，其他 source 为 `markdown`，原始 bytes 后始终增加一个 framing LF；
4. 每个 source section 末尾再写一个 LF；renderer 不做换行、Unicode、YAML 或 Markdown normalization；
5. `evidence.md` 使用第 11.1 节固定 header，随后追加一个 `Legacy Import` block，按相同 source 顺序记录 path、bytes、SHA-256，但不重复正文；
6. path 必须已通过 V1 ASCII normalized-relative-path policy，因此 renderer 不接受反引号、控制字符或 path escape；不满足时迁移失败，不增加第二套 escaping；
7. `DraftMetaV2.sourceFormat` 固定为 `submission-v1-import`。

在 world writer lock 内，对没有 `head.json` 且符合上述布局的 slot 执行：

1. 使用冻结的 Session Submission V1 reader/lint 只读解析旧 Draft；失败则返回 `DRAFT_MIGRATION_FAILED`，旧文件完全不变；
2. 按上述 renderer 确定性生成 `brief.md` 和 `evidence.md`；
3. 按第 11 节计算 H1，将两文件写入 `snapshots/<H1>.prepared-<uuid>`，验证并同步后原子 rename 为 `snapshots/<H1>`；目标已存在时必须逐 byte 相等才能复用；
4. 以 `wx` 写入并同步 `meta.v2.prepared.json`，内容为从 V1 meta 逐字段迁移的 `DraftMetaV2`；Draft ID、kind、world/base/target、createdAt 保持，updatedAt 固定为迁移开始时捕获的一次 UTC timestamp；
5. 写入 `AggregateHeadV1 {revision:0,draftHash:H1,activeSession:null}`；Head atomic replacement 是迁移线性化点；
6. Head 成功后以 prepared meta 原子替换 `meta.json`，再将旧根级 `draft.yaml` 和 `content/` 移入 Core-owned `legacy-v1/`；这些清理失败只产生诊断，不回滚 Head；
7. 恢复看到 Head 与 V1 meta 时，必须先用 `meta.v2.prepared.json` 完成 meta replacement 再开放 Core；看到 `.prepared-*` 但没有 Head 时删除 prepared；看到完整 H1 snapshot/meta prepared 但没有 Head 时重新执行 byte 校验并复用。

renderer 必须以四类最大 V1 fixture、空 Markdown、CRLF、最长允许路径和 fence 字符组合建立 golden fixtures。它只用于无损迁移，不成为新 Draft 的长期格式。下一次 UPDATE 时 Curator 可以把 import 内容整理为自然 brief，但 `evidence.md` 的 import block 永久保留来源 hash。

生产代码不提供调用方可选择的新旧 Draft 双轨：Head 成功后，旧根级业务文件永不再作为 authority；V1 reader 只存在于隔离的 migration module，不进入普通 start/send/submit 路径。

### 23.4 Crash recovery matrix

恢复不得根据 mtime、最大编号或“看起来最新”的目录猜测 authority：

| Crash boundary | Authority after restart | Required recovery |
| --- | --- | --- |
| Response/Arbiter 尚未 Commit A | Head 仍为 C1/H1，无 pending | 关闭未终局 operation，删除 transient 和未引用 C2 |
| C2 已 materialize、Commit A 前 | Head 仍为 C1/H1，无 pending | 删除未引用 C2；用户可重新 send |
| Commit A 成功、Curator 前或运行中 | Head 为 C2/H1，有 pending | 保留 accepted response，删除 Curator transient，恢复 ready + retry/cancel |
| H2 prepared/final 已写、Commit B 前 | Head 为 C2/H1，有 pending | 删除未引用 H2/prepared；retry 从 H1 重新 curate |
| Commit B 成功、turn terminal record 前 | Head 为 C2/H2，无 pending | 以 Head、evidence suffix 和 operation record 幂等补齐 committed terminal/audit，不重新运行模型 |
| ready cancel CAS 成功、session directory move 前 | Head activeSession=null，Draft 不变 | 幂等补写 abandoned record并移动 session；不得写回 activeSession |
| Change Plan/Candidate 已生成、Archive publish 前 | Aggregate Head 仍 active，Archive current 未变 | 删除整个 submit transient；Draft/Session 保持可重试 |
| Archive current 已切换、Draft archive cleanup 前 | 新 Archive commit 为 Published World authority | 根据新 audit sessionId 幂等完成 Draft/session archive cleanup，不再次 publish |
| Legacy snapshot/meta prepared、迁移 Head 前 | 旧布局仍为 authority | 校验并复用 exact prepared，或删除后重做迁移 |
| Legacy migration Head 后、meta/旧文件清理前 | Head/H1 为 authority | 完成 meta replacement 与 `legacy-v1` move，不回滚 Head |
| Head JSON/hash/reference 损坏 | 无可安全推导的 Session authority | Core 初始化以 INTERNAL_ERROR 失败，不扫描 artifact 猜测 |

Windows 与 POSIX fault-injection 必须覆盖每一行的文件写入、fsync、rename、CAS 和 cleanup 边界。

### 23.5 不再开放的架构决策

- 允许 speculative streaming，可见性不等于 authority；
- Response 与 Draft 是两个 commit；
- rejected generation 不进入 accepted Conversation；
- pending 时禁止新 send 和 submit；
- Draft Curator 只写 staging `brief.md`，`evidence.md` 来源由 Core 追加；
- 持久 Draft 固定为 Markdown handoff，不保存领域 YAML/JSON IR；
- structured Change Plan 只存在于 submit transient workspace；
- 所有持久提升由 Core-owned technical verification、Aggregate Head CAS 或 Archive publisher 完成；
- Candidate schema、World validator 和 Archive publish 仍是严格领域边界。

## 24. 目标不变量

完成改造后必须能够声明：

- Thought work、模型 Final 和工具结果默认都是 speculative artifact；
- Promptpile Final 未经 Arbiter 不能成为 accepted assistant response；
- 完整产生或正常终止、但被拒绝的可见 generation 永远可追踪，不伪装成未发生；强制进程终止前的 partial delta 只保证当前 presentation 可见性；
- rejected generation 不进入 accepted Conversation、compression 或下一轮普通语义上下文；
- Conversation Agent 与 Arbiter 无权修改 Draft 或 World；
- Draft Curator只能修改 operation-scoped `brief.md` staging；
- Core-owned `evidence.md` 保留每个 UPDATE turn 的原始 user/accepted response 来源，且旧 bytes 永不被 Curator 改写；
- Draft 更新经过 technical check、hash、effect 和 base CAS 后才能成为 Accepted Markdown Draft Snapshot；
- 程序不把 Markdown 标题、自然语言或模型声明解释为领域 schema；
- cancel、Curator failure 和 technical-check failure 不污染 active Draft；
- accepted Conversation 与 Draft 之间最多存在一个显式 pending sync；
- pending 未解决时不能继续 send 或 submit；
- Submission 只读取 Aggregate Head 指向的固定 Markdown snapshot；
- stable ID、World operation 和严格业务结构只在 transient Change Plan、Candidate 与 Published World 边界出现；
- Candidate World 未经程序验证和 publisher commit 不能成为 Published World；
- 所有“回滚”都表现为未提升 artifact 的 discard，而不是修改正式状态或抹除用户观察历史。

最终统一数据流：

```text
User
  |
  v
ReAct Speculative Work
  |
  v
Response Candidate -- visible, not authoritative
  |
  v
Turn Arbitration
  |
  v
Accepted Conversation
  |
  v
Staged Markdown Curation
  |
  v
Accepted Markdown Draft Snapshot
  |
  v
Transient Change Plan + Candidate Conversion
  |
  v
World Validation
  |
  v
Published World
```

整个系统只采用一个原则：

```text
AI 产生并整理推测产物；
Presentation 可以提前观察；
Core 只验证来源、事务和真实领域边界；
未提升的产物只 discard，不污染正式状态。
```

## 25. Sealed Control 与 Speculative Artifact 实施收敛

### 25.1 两类 Operation

运行时只保留两类结束语义：

- 开放式 Operation：Response、Curator、Converter、Reviewer 可以在各自固定技术检查通过后产生自然语言 Final；
- 封存型 Operation：Turn Arbiter 与 Change Plan 必须在 Final 前通过唯一 control tool 产生一个 Core 可验证的 sealed result。

封存型 Operation 统一使用同一个 operation-local sealed-control lifecycle。该 lifecycle 持有 control server、严格 runtime schema、协议状态和 Final Gate；调用方不得直接读取结果文件并使用类型断言。Final Gate 固定验证工具调用闭包、`status=sealed`、调用次数为一以及结果 schema。open、missing、invalid、violated、残缺 ToolResult 或非零 child exit 全部失败关闭，不存在默认 ACCEPT、KEEP 或从 Final 文本恢复结构化结果的降级路径。

凡是 Final Gate 需要读取 ReAct `work_path`，工作目录生命周期必须同属该 Operation：Core 传入固定的 operation-local `react-work` root，并显式选择 `work_lifecycle=caller`；Process Pile 回报的 `work_path` 必须位于该 root 内。Core 在 `work.ready` 时完成门禁读取，只在 Process Pile 终止或失败后清理该 root。不得使用 ReAct 的默认自动清理，因为“子进程发出 `work.ready`”与“父进程消费并校验事件”之间存在竞态，自动清理会让已就绪的目录在门禁读取前消失。

Turn verdict 的嵌套 Zod schema 是 sealed result reader、Turn record validator 和测试的领域事实来源。MCP 模型边界使用无 union、字段全部必填的扁平 transport DTO（`response_verdict`、`rejection_code`、`response_evidence`、`draft_verdict`、`draft_evidence`）；control server 是唯一 DTO→领域 verdict 映射点，并在写入 sealed result 前用领域 schema 复核组合约束。不得把根 union 直接交给 MCP schema 导出，也不得让 transport DTO 泄漏进 Head 或 Turn record。Change Plan 同样经 sealed-control lifecycle 返回，并在 Core 侧重新 canonicalize plan、重算 assignment 后比较，不信任结果文件中的派生字段。

### 25.2 专属 Agent loop 与最小权限

Arbiter 使用专属 Observe / Check：证据不足时只能继续只读检索，证据充分且尚未 sealed 时唯一下一动作是 `mcp__turn_control__turn_verdict`，sealed 后才允许进入 Final。普通 Draft Agent 的“用户问题已经可以回答即可 Final”规则不得用于控制型 Operation。

Draft 工具显式拆为 read 与 write 集合。Response、Arbiter、Change Plan 只看到 list/read；Curator 才看到受 `brief.md` path policy 约束的 write。Hook 保留为纵深防御，但不再承担隐藏无权限工具的职责。

Arbiter 判定 `draft=UPDATE` 后，Core 必须先把最新 user 原文以自然 Markdown 引用块确定性锚定到 staging `brief.md`，再启动 Curator 做归纳整理。Curator 可以重组并去掉临时标题，但不得丢失该语义。这样 UPDATE 的最小持久化结果由 Core 保证，不依赖模型是否记得调用 write；即使 Curator 未进一步改写，technical check 仍能验证一个包含用户原文的非空 brief delta。`evidence.md` 仍只由 Core 追加固定 evidence block。

### 25.3 Speculative Conversation transaction

Response attempt 的 Conversation 只存在于 operation-local staging root。生成完成后可立即流式展示全文，但 Arbiter ACCEPT 前不得物化到 persistent Session。ACCEPT 后 Core 执行：

```text
prepare immutable Conversation -> Commit A CAS -> commit prepared handle
```

Arbiter failure、REJECT、cancel、prepare failure 或 Commit A CAS failure 均 rollback/discard staging，Aggregate Head 保持不变。Commit A 成功后，transient staging cleanup 失败不得反转已经线性化的 authority；恢复仍只依据 Head。

### 25.4 Event ownership

只有 `operation.kind=response` 的 Final delta 可以投影为 `channel=response`。Arbiter、Curator 与 Submission Final 是内部调试输出，不进入用户 transcript。Operation disposition 固定区分：`cancelled` 表示真实取消，`superseded` 表示被 repair attempt 替代，`discarded` 表示已产生但未通过提升边界，`failed` 表示 operation 自身失败，`committed` 表示已经进入 authority。TUI 不得再把 discarded 映射为 cancelled。

### 25.5 必测闭环

- sealed result 缺失、非法、重复与合法单次调用；
- caller-owned ReAct 工作目录在 Final Gate 前可读、Operation 终止后清理，且越界 `work_path` 被拒绝；
- 真实 Session File Runtime 中 Arbiter 只暴露 Draft RO 和 verdict tool；
- Arbiter failure 时 staged Response 被 discarded 且 Head revision 不变；
- ACCEPT 后才 prepare Conversation，Commit A/B 顺序保持；
- Arbiter Final 不产生第二条用户可见 AI 消息；
- discarded 与 cancelled 在 Core event、Turn Audit 和 TUI 中语义一致。
