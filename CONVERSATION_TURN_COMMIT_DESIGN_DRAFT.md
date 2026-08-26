# Dayloom Conversation Turn Commit 改造设计草案

> 状态：DESIGN DRAFT
> 日期：2026-08-26
> 范围：`@dayloom/core` 的 Init / Planning / Play / Revise 对话期 `send()` 路径
> 非目标：不修改 Archive V2、World Profile V1、Session Submission V1、Settle 与 abandon 的发布语义
> 背景：当前对话 Agent 同时承担用户回答、阶段约束遵循和 Draft 维护，出现两类可靠性问题：回答可能偏离 Session 流程；回答完成后 Draft 可能没有同步更新

本文提出 Conversation Turn Commit：将一次用户对话拆成 Response Generation、Turn Arbitration、Draft Compilation 三个权限隔离阶段。用户可见流式回答仍可立即展示，但只有经过策略评审的回答才成为 accepted response；只有经过独立 Draft Compiler 和程序 lint 的草稿变更才成为本轮持久状态。

## 1. 问题陈述

当前对话期主要依赖一个 Promptpile React Agent 同时完成：

1. 理解当前 Session kind 与阶段边界；
2. 阅读 Published World / Draft；
3. 回答用户；
4. 避免越权推进业务流程；
5. 判断本轮是否产生新的创作状态；
6. 将新状态写回 Draft。

这种多职责模型存在两个已经观察到的问题。

### 1.1 Response phase drift

例如 Init Session 的职责是协作定义世界、角色、地点、Canon、Arc 与初始状态，但模型在连续对话中可能逐渐进入叙事模式，开始模拟事件、推进时间或直接写小说。

这类约束属于语义约束，单纯依赖主 Prompt 不能保证稳定满足。

### 1.2 Draft synchronization drift

现有 Prompt 要求“每轮对话都必须把新增创作成果同步到 Draft”，但 Draft 写入仍由同一个回答 Agent 自主决定和执行。

因此可能发生：

```text
用户明确提供了新的世界设定
        |
        v
Assistant 正确回答
        |
        v
Draft 未更新
```

Conversation 与 Draft 因而产生分叉。由于 Draft 是本次 Session 创作成果的权威，这种分叉不能只视为提示词质量问题。

## 2. 核心决策

Conversation 对话期改造成显式的 Turn Commit 管线：

```text
User Turn
   |
   v
Response Generator
   |
   v
Response Candidate
   |
   v
Turn Arbiter
   |-------------------- reject -------------------|
   |                                               |
 accept                                      Regenerate
   |                                               |
   |<----------------------------------------------|
   v
Accepted Response
   |
   +------ Draft KEEP ------> Turn Complete
   |
   +------ Draft UPDATE
              |
              v
       Draft Compiler
              |
              v
       deterministic lint
              |
              v
         Draft Commit
              |
              v
         Turn Complete
```

核心决策：

1. Response Generator 只负责生成用户回答，不再拥有 Draft 写权限。
2. Turn Arbiter 独立判断回答是否偏离 Session policy，以及本轮是否需要更新 Draft。
3. Turn Arbiter 使用受限工具提交 verdict，不以自由格式 JSON 作为协议。
4. 被拒绝的流式回答不会伪装成“从未展示”，而是标记为 superseded，并保留审计证据。
5. Reviewer 自由文本只作为 evidence，不直接拼接成下一轮最高权威 Prompt；Core 根据稳定 code 构造 repair prompt。
6. Draft Compiler 使用独立 Promptpile React Conversation；Archive 只读，Draft 可写。
7. Draft Compiler 只负责编译本轮 accepted turn 到已有 Draft，不负责用户可见回答。
8. Draft Compiler 完成后必须经过程序 lint；模型声称“已经更新”不是成功证据。
9. Draft 是增量 accumulator：`Draft_n + accepted Turn_(n+1) -> Draft_(n+1)`，不在每轮从完整 Conversation 重新推导全部 Draft。
10. Submission V1 继续从持久 Draft 转换 Candidate，不修改现有提交架构。

## 3. 权限模型

改造后，对话期三个模型角色采用最小权限。

| 角色 | Published Archive | Draft | Candidate | 用户可见输出 |
| --- | --- | --- | --- | --- |
| Response Generator | RO | RO | 无 | 是 |
| Turn Arbiter | RO | RO | 无 | 否 |
| Draft Compiler | RO | RW | 无 | 否 |
| Submission Converter | RO | RO | RW | 否 |

关键变化是：Conversation 主 Agent 不再通过 `mcp__draft__write_file` 修改 Draft。

因此“用户回答”和“持久创作状态维护”从同一个 Agent 中解耦。

## 4. Response Generator

### 4.1 职责

Response Generator 负责：

- 理解当前用户输入；
- 读取当前 Draft 与必要的 Published Archive；
- 按当前 Session kind 回答；
- 进行必要的澄清、建议和解释；
- 生成流式 response candidate。

它不负责：

- 修改 Draft；
- 发布 World；
- 判断自己是否最终合规；
- 将模型建议升级为 confirmed；
- 通过叙事推进超出当前 Session phase 的业务状态。

### 4.2 输入

建议固定输入包含：

```text
Session policy
Session kind / targetDay
Pinned World identity / revision summary
Current Draft (RO)
Conversation context / compression
Current user turn
Repair constraint（仅重生成时）
```

### 4.3 输出

Response Generator 保持现有 Promptpile React 流式 Final 行为，但其 Final 在 Arbiter 接受前只是：

```text
Response Candidate
```

而不是已提交的 Conversation authority。

## 5. Turn Arbiter

### 5.1 目标

Turn Arbiter 在完整 response candidate 生成后运行，回答两个问题：

1. 本回答是否违反当前 Session phase / policy？
2. 本轮 accepted information 是否要求更新 Draft？

两个判断共享同一份证据，因此使用一个 Arbiter process，而不是启动两个独立 Reviewer。

### 5.2 最小输入

```text
固定 Session policy
Session kind / targetDay
Current user turn
Response candidate
Current Draft (RO)
必要的 Published Archive (RO)
```

完整历史 Conversation 不是默认输入；只有判断必须依赖历史时才提供压缩后的必要上下文。

### 5.3 Verdict tools

Arbiter 不通过自由格式 Final JSON 传递协议结果。建议提供两个 Core-owned tool：

```text
response_verdict(
  verdict: ACCEPT | REJECT,
  code?: stable enum,
  evidence?: string
)

draft_verdict(
  verdict: KEEP | UPDATE,
  evidence?: string
)
```

Core 要求一次 Arbiter operation 中两个 verdict 都恰好成功提交一次；缺失、重复或参数非法均视为 Arbiter failure。

### 5.4 Response rejection code

首版建议保持有限、稳定的拒绝枚举，例如：

```text
PHASE_DRIFT
UNAUTHORIZED_PROGRESS
USER_DECISION_INVENTED
PUBLISHED_FACT_CONTRADICTION
UNSUPPORTED_CLAIM
OTHER_POLICY_VIOLATION
```

其中 `evidence` 可以由模型自由描述，但只能作为诊断证据。

### 5.5 Repair prompt ownership

Arbiter 的自由文本不得直接变成新的高优先级 Prompt。

拒绝后由 Core 根据 verdict code 生成固定 repair instruction，例如：

```text
上一候选回答未被接受。

失败类型：PHASE_DRIFT

评审证据：
<bounded evidence>

本次重新生成必须：
- 保留用户已经明确提供的信息；
- 回到当前 Init 世界设计职责；
- 不模拟事件；
- 不推进时间；
- 不开始 Day 1。
```

Repair prompt 的结构和 policy authority 由 Core 拥有。

## 6. Streaming 与 superseded response

### 6.1 不定义为物理撤回

由于 Response Generator 是流式输出，用户可能在 Arbiter 运行前已经看到完整 candidate。

因此 rejected response 不应在数据模型中定义为“撤回后不存在”，而应定义为：

```text
superseded response
```

### 6.2 Presentation state

TUI / presentation layer 可使用：

```text
streaming
verifying
accepted
superseded
```

典型体验：

```text
Assistant streaming...

正在检查回答…

如果接受：
✓ accepted

如果拒绝：
✗ 本回答偏离当前阶段，正在修正
[旧回答降级 / 折叠为 superseded]
[重新流式生成新回答]
```

用户已经看到的内容不得在 Audit 中被伪装成从未发生。

### 6.3 Accepted response

只有 Arbiter `ACCEPT` 后，该 candidate 才成为：

```text
accepted response
```

Conversation 的后续语义上下文应优先使用 accepted response；superseded generation 属于审计和调试证据，不进入普通可压缩对话语义历史。

## 7. Regeneration policy

Response 被拒绝后：

```text
candidate N
  -> Arbiter REJECT(code, evidence)
  -> Core repair prompt
  -> candidate N+1
  -> Arbiter
```

必须有有界重试上限，避免：

```text
generate -> reject -> generate -> reject -> ...
```

首版建议配置固定最大 repair rounds，而不是让调用方自由指定。

达到上限仍未通过时，turn 失败并保留完整诊断；不得自动降低 policy 标准。

## 8. Draft verdict

当 response accepted 后，Arbiter 的第二个 verdict 决定是否需要 Draft Compiler。

### 8.1 KEEP

适用于：

- 用户只询问解释性问题；
- 用户要求重述当前状态；
- 本轮没有产生新的 confirmed / proposed 创作信息；
- Draft 已完整包含本轮有效信息。

此时不启动 Draft Compiler。

### 8.2 UPDATE

适用于：

- 用户新增或修改明确设定；
- 用户确认此前 proposed 内容；
- 用户否定或替换已有决定；
- Assistant 产生允许保存为 proposed 的新建议；
- 当前 Draft 缺少本轮应保留的创作状态。

Arbiter 只判断“需要更新”，不产生 Draft patch。

## 9. Draft Compiler

### 9.1 定位

Draft Compiler 是一个独立 Promptpile React operation：

```text
accepted turn + current Draft + pinned Archive
                 |
                 v
          Draft Compiler
                 |
                 v
          updated Draft
```

它是 Conversation 状态到 Draft 状态的编译器，而不是第二个聊天 Agent。

### 9.2 输入

建议输入限制为：

```text
Session policy
Draft contract for current kind
Current user turn
Accepted assistant response
Current Draft
Pinned Archive (RO)
必要的局部历史上下文
```

原则上不提供完整 Conversation 作为主要事实源。

Draft 自身承担 accumulated state；每轮只编译当前 accepted delta。

### 9.3 文件权限

Draft Compiler：

```text
Archive server: RO
Draft server: RW
```

仍沿用当前 Session File Runtime 的文件安全策略：

- 只能写 `draft.yaml` 与 `content/**/*.md`；
- 已有文件必须先读后写；
- 禁止写 Core-owned `meta.json` / `diagnostics.json`；
- 禁止 symlink / path escape；
- 保持文件数、单文件大小和总大小限制。

### 9.4 confirmed / proposed authority

Draft Compiler 必须继承现有规则：

- 用户当前 turn 明确提供或明确确认的值才能新增为 `confirmed`；
- Assistant 建议默认只能写为 `proposed`；
- 用户沉默、未反对、切换话题都不构成确认；
- Published World 和旧 Draft 中的 confirmed 状态不能被模型无证据降级或改写。

### 9.5 Compiler Final

Draft Compiler 的 Final 不是业务数据载体。

业务结果必须通过文件工具写入 Draft；Final 只允许给出执行完成/失败的简短过程结果，并由 Core 的文件状态和 lint 决定是否成功。

## 10. Draft consistency 与 base hash

为了避免 retry、cancel 或未来并发路径覆盖已经变化的 Draft，每轮 Draft Compiler 应 pin 当前 Draft workspace。

建议引入：

```text
baseDraftHash
```

计算对象应覆盖 Draft 业务内容，例如规范化排序后的：

```text
draft.yaml
content/**
```

Core 在启动 Draft Compiler 时记录：

```text
expectedBaseDraftHash = H1
```

Compiler 完成、准备接受新 Draft 前再次检查：

```text
current base still matches H1
```

若不匹配则失败为 Draft conflict，不覆盖其他已生效变更。

此设计与 World publish 的 pinned revision / root tree 思路保持一致。

## 11. Draft validation

Draft Compiler 完成后必须运行确定性的 Draft lint。

管线：

```text
Draft Compiler
   |
   v
lintDraftWorkspaceV1
   |
   +-- valid --> accept Draft update
   |
   +-- invalid --> bounded repair / fail
```

程序 lint 继续拥有结构性权威，例如：

- schemaVersion / kind；
- required fields；
- stable key；
- Markdown references；
- decision enum；
- relationship references；
- Planning `dependsOn` 顺序；
- targetDay 不变；
- 文件边界与资源限制。

AI 不得通过 Final 声称 lint 通过。

首版可以复用当前 `lintDraftWorkspaceV1()`，再根据新的 Turn Commit 测试补足缺失 invariant。

## 12. Turn consistency semantics

一次 turn 不再等同于一次 LLM Final，而是：

```text
User input
  -> Response candidate
  -> Response accepted
  -> Draft decision
  -> optional Draft compilation
  -> Draft validation
  -> Turn complete
```

### 12.1 Response accepted + Draft KEEP

直接完成 turn。

### 12.2 Response accepted + Draft UPDATE success

完成 turn，并记录新的 Draft hash / metadata。

### 12.3 Response accepted + Draft UPDATE failure

这里需要区分 presentation 与 persistent-state consistency。

推荐首版语义：

- 已 accepted 的用户回答不伪装成未发生；
- turn 标记为 degraded / draft-sync-failed；
- Draft 保持更新前版本；
- UI 明确提示本轮回答已完成，但创作状态未成功同步；
- 允许仅重试 Draft Compiler，不重新生成用户回答；
- `/submit` 在存在未解决 draft-sync failure 时应拒绝，避免用户以为所有 accepted 创作状态已经进入 Draft。

这比在 Draft Compiler 失败后删除一个用户已经看到且已通过 policy 的回答更符合实际可观察行为。

## 13. Conversation 与 Audit 模型

Turn Audit 应区分用户实际看到的 generation 与最终 accepted response。

建议每个 turn 至少记录：

```text
turnId
user input
generation attempts[]
  response text
  arbiter verdict
  rejection code / evidence
accepted generation id
draft verdict
baseDraftHash
resultDraftHash
draft compile attempts / diagnostics
terminal status
```

概念结构：

```text
turn/
  user
  generation-1
  review-1
  generation-2
  review-2
  accepted-response
  draft-decision
  draft-compilation
```

Submission audit 仍按现有 Session Submission V1 保存最终 Draft、Conversation transcript、conversion、validation、review 和 diff。

Turn Audit 是否进入 World Archive，或只保留在 Session runtime 后随 submit 聚合写入 audit，需要在实现前进一步冻结；本草案不改变现行 Archive business path。

## 14. Core internal phase

不建议立即扩大 public `CoreSessionStatus`。

外部仍可保持：

```text
ready
running
submitting
```

内部 operation phase 增加：

```text
response.generate
response.verify
response.repair
draft.compile
draft.validate
```

并通过现有 `work.*` / `output.*` event 体系向 TUI 提供透明进度。

这样可以增强可观察性，同时避免 public state contract 因内部 Agent pipeline 变化快速膨胀。

## 15. Cancellation

### 15.1 Response generation

与当前 send cancellation 相同：终止 active child，停止后续 delta，恢复 Session ready。

### 15.2 Verification

取消后不启动 regeneration 或 Draft Compiler。

如果 candidate 已经完整展示但尚未 accepted，则保留为未提交 generation audit，不成为 accepted response。

### 15.3 Draft compilation

取消 Draft Compiler：

- 终止 child；
- 关闭 file runtime；
- 不接受未完成 Draft；
- 恢复到 `baseDraftHash` 对应内容。

因此实现时最好不要让 Compiler 直接不可逆修改 active Draft；可考虑使用 Draft working copy / staged workspace，lint 成功后再原子替换 active Draft 业务文件。

这是本草案建议新增的实现强化点。

## 16. Draft Compiler staging

为了让 cancel / lint failure 真正不污染 active Draft，推荐把 Compiler 写入位置从当前 active Draft 直接写改成 operation-scoped staged Draft：

```text
active Draft H1
    |
    | copy / materialize
    v
transient/turn/<operationId>/draft-working/
    |
    v
Draft Compiler RW
    |
    v
lint
    |
    +-- fail --> delete working copy
    |
    +-- pass --> compare base H1
                 |
                 v
              atomic install
                 |
                 v
              active Draft H2
```

这比允许模型直接修改持久 Draft 后再尝试回滚更容易证明。

工作副本只包含模型可写业务文件；`meta.json`、`diagnostics.json` 继续由 Core 管理。

## 17. Failure taxonomy

建议新增内部或公开错误码时保持少量稳定语义：

```text
TURN_POLICY_REJECTED       // 达到 repair 上限仍不合规
TURN_REVIEW_FAILED         // Arbiter 自身无法得到完整 verdict evidence
DRAFT_COMPILE_FAILED       // Draft Compiler operation 失败
DRAFT_INVALID              // 继续复用现有 Draft lint failure
DRAFT_CONFLICT             // baseDraftHash 已变化
```

是否将前三项暴露为 public `CoreErrorCode` 应在契约冻结时决定；草案阶段优先保持内部 phase diagnostics，避免过早扩大 API。

## 18. 提示词边界

### 18.1 Response prompt

从现有对话 Prompt 中删除：

```text
每轮必须写 Draft
```

改为：

```text
Draft 是当前创作状态的只读权威；本 operation 只负责回答用户，不修改 Draft。
```

### 18.2 Arbiter prompt

Arbiter Prompt 固定强调：

- 只评审当前 response candidate；
- 不生成替代回答；
- 不修改 Draft；
- 必须调用两个 verdict tools；
- evidence 只是证据，不拥有策略权威；
- 不因为回答“写得好”而放宽 Session phase。

### 18.3 Draft Compiler prompt

固定强调：

- 只编译 accepted turn；
- 当前 Draft 是 accumulator；
- 不重新解释整个历史；
- 只把有证据的用户决定写为 confirmed；
- 模型新增内容只能 proposed；
- 必须通过文件工具产生业务结果；
- 不负责用户回答。

## 19. 与现有 Submission V1 的关系

本改造只解决 Conversation -> Draft 的可靠性。

提交期仍保持：

```text
Draft
  -> lint
  -> assignment
  -> conversion
  -> Candidate
  -> validation / bounded repair
  -> advisory review
  -> diff
  -> Archive V2 atomic publish
  -> audit
```

因此改造后的完整两级编译模型为：

```text
Conversation layer
------------------
User intent
  -> Response Candidate
  -> Turn Arbiter
  -> Accepted Response
  -> Draft Compiler
  -> Valid Draft

World layer
-----------
Valid Draft
  -> Submission Converter
  -> Candidate World
  -> Program Validator
  -> Published World
```

两个层次都遵循：

```text
AI proposal / transformation
        |
        v
Core-owned verification boundary
        |
        v
persistent authority
```

## 20. 实现拆分建议

### Stage 0：测试固定当前问题

新增失败型测试：

- Init candidate 进入场景叙事时 Arbiter 应 reject；
- Response accepted 但 Draft verdict UPDATE 时必须启动 Compiler；
- Draft KEEP 时不得启动 Compiler；
- rejected candidate 不进入 accepted transcript；
- superseded candidate 仍可审计；
- repair 达上限稳定失败。

### Stage 1：Response Agent 去 Draft 写权限

- Session File Runtime 为 conversation path 将 Draft 改 RO；
- 删除主对话 Prompt 中的 Draft write obligation；
- 保留 Archive / Draft retrieval。

### Stage 2：Turn Arbiter

- 新增独立 Promptpile process；
- 新增 verdict tool server 或等价 Core-owned tool boundary；
- 增加 stable rejection code；
- 实现 bounded regeneration。

### Stage 3：Presentation supersede

- runtime-driver 支持 verifying / superseded presentation；
- 保证 stale generation delta 不覆盖 newer generation；
- Conversation accepted transcript 只接收最终 generation。

### Stage 4：Draft Compiler

- 建立独立 Promptpile React conversation；
- Archive RO；
- staged Draft RW；
- 复用 Session File Runtime policy；
- lint + bounded repair；
- 成功后原子安装。

### Stage 5：Draft hash / conflict

- 定义 canonical Draft hash；
- pin `baseDraftHash`；
- compiler commit 前 compare；
- 冲突时不覆盖 active Draft。

### Stage 6：Audit 与恢复

- 记录 generation / verdict / compile attempts；
- 明确 crash 时 staged Draft 清理；
- 明确 `draft-sync-failed` 对 `/submit` 的阻塞语义；
- 增加 kill / cancellation fault injection。

### Stage 7：契约冻结

实现验证后再形成稳定契约，例如：

```text
doc/contracts/CONVERSATION_TURN_COMMIT_V1.md
```

并同步 Core Runtime、Session Manager、Prompt Traceability、TUI 设计文档。

## 21. 需要冻结前决定的问题

以下问题本草案暂不强行冻结：

1. Arbiter 最大 regeneration rounds 的精确数值；
2. Draft Compiler 最大 repair rounds 与 timeout；
3. verdict tools 是专用本地工具 server，还是复用现有 Promptpile tool evidence 机制；
4. Turn Audit 是立即持久化到 runtime，还是 submit 时统一进入 World audit；
5. `draft-sync-failed` 是否新增 public state / CoreResult warning；
6. Draft staged install 的精确原子替换算法与目录 fsync 策略；
7. `baseDraftHash` 是否覆盖 diagnostics / meta，建议首版只覆盖模型可写业务文件；
8. superseded response 在 TUI 中默认折叠还是保留全文展示。

这些决定不影响核心架构：Response、Policy Verification、Draft Compilation 必须是三个独立权限边界。

## 22. 目标不变量

完成改造后应能够声明：

- 用户可见回答不能未经独立 policy verification 就成为 accepted conversation state；
- Session phase drift 可以被稳定识别并有界重生成；
- 被用户看到但被拒绝的 generation 永远可追踪，不伪装成未发生；
- Conversation Agent 无权修改 Draft；
- Arbiter 无权修改 Draft 或 World；
- 只有 Draft Compiler 能在 conversation turn 中产生 Draft 业务文件变更；
- Draft Compiler 不能修改 Published World；
- Draft 更新必须经过程序 lint 后才提交；
- cancel、compiler failure、lint failure 不污染 active Draft；
- accepted turn 与 persistent Draft 不允许静默分叉；
- Submission V1 继续把 Draft 当作会话创作成果的唯一提交输入。

最终的数据流为：

```text
User
  |
  v
Response Candidate
  |
  v
Turn Policy Verification
  |
  v
Accepted Response
  |
  v
Draft Compilation
  |
  v
Validated Draft
  |
  v
World Candidate Conversion
  |
  v
World Validation
  |
  v
Published World
```

这使 Conversation 与 World 两层都采用“AI 产生候选、Core 验证后提升 authority”的统一设计原则。