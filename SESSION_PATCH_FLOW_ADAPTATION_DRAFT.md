# Dayloom Session Patch 流程适配草案

> 状态：Draft / Gate 0 后实施
> 日期：2026-08-24
> 依赖：`SESSION_PATCH_PROFILES_DESIGN_DRAFT.md`、`SESSION_PATCH_FILESYSTEM_MCP_AND_PROMPTS_DRAFT.md`
> 实施范围：Init、Planning、Play、Revise 全部切换为各自 Patch Profile

本文件是 Session 状态机、publication、错误恢复、audit 和实施顺序的唯一规范来源。Patch 目录 schema 以及文件工具/AI 编辑规则分别引用另外两份草案，不在本文件另立规范。

本文已经冻结产品方向，按 Gate 0 → P0 → P1 → P2 → P3 实施。Gate 0 不重新选择 Patch Profile 或双实例 MCP 产品方向，但必须验证第三方公开执行契约；若依赖假设失败，应先在保持核心拓扑的前提下修正固定版本、配置或打包方式，再进入 P0。

## 1. 结论

Dayloom 当前四类对话 Session 共用 Conversation/Promptpile React 生命周期，但拥有不同 submission 和 publication 语义。改造采用：

- 一个共同的 Core-owned Session File Runtime：内部固定一个 loopback `promptpile-mcp` gateway 与 `archive_fs`、`patch_fs` 两个 `fs-mcp-rs` stdio 实例；
- Init、Planning、Play、Revise 四套独立 Patch Profile；
- 四种模式的普通 `send` 都可以渐进形成候选；
- 四种模式的 `submit` 都不调用 AI，而由 Core 确定性扫描、校验、冻结和发布当前 patch；
- Core 分别冻结为现有 submission 类型并复用现有 builder/publisher；
- Settle、abandon 不是对话候选流程，不接入 patch。

## 2. 目标流程矩阵

| 流程 | Patch Profile | freeze 目标 | 现有发布构建器 |
| --- | --- | --- | --- |
| Init | `init` | `InitSubmissionV2` | `buildInitMutationV1()` |
| Planning | `planning` | `PlanningSubmissionV2` | `buildPlanningMutationV1()` |
| Play | `play` | `PlaySubmissionV2` | `buildPlayMutationV1()` |
| Revise | `revise` | `ReviseSubmissionV2` | `buildReviseMutationV1()` |

四种模式不再从 submit Final 获取 submission；自然语言 Final 只属于普通 `send`。

本文件描述目标实现，不描述当前已上线行为。在该改造合入前，`doc/contracts/CORE_RUNTIME_V1.md`、`doc/architecture/SESSION_MANAGER.md` 等正式文档继续以当前代码为准；改造完成时必须在同一提交中更新这些正式文档并移除本草案。二者的差异是实施输入，不是设计冲突。

## 3. 共同 Session 能力

共同 Session runtime 继续负责：

```text
Conversation
Promptpile React
compression
cancel/dispose
Process Pile projection
audit transcript
```

所有对话 Session 直接拥有一个 Core-owned `SessionFileRuntime`。`session.kind` 是 Patch Profile 的唯一判别源，不再保存第二份 `profile` 字段，也不为单个字段建立 `PatchRuntime` 包装层：

```ts
const sessionModes: SessionModeRegistry = {
  init: initMode,
  planning: planningMode,
  play: playMode,
  revise: reviseMode,
};
```

AI 不传 profile。Core 始终通过 `sessionModes[session.kind]` 一次选择 snapshot manifest、prompt、freezer 和 publication adapter，避免 `kind`、profile 和发布语义漂移。Session 已有 root，`snapshotRoot` 和 `patchRoot` 由约定路径派生，不作为重复状态保存。

所有模式使用 `SESSION_PATCH_FILESYSTEM_MCP_AND_PROMPTS_DRAFT.md` 定义的共同 authority 和编辑规则；本流程只依赖其结果：snapshot 是正式事实的只读证据，patch 是唯一已保存候选，当前用户 turn 决定本轮获准变化，最终有效性和发布权只属于 Core。

## 4. Workspace 创建

`createSessionWorkspace()` 继续创建通用 context、conversation、react 和 compression 层。Core 通过当前 `SessionMode` 从已验证的 `PublishedWorld` 内存表示物化 mode-specific immutable snapshot；不再遍历整棵 Archive，Init 创建空 snapshot。精确文件集由 Patch Profiles 草案的 snapshot manifest 唯一定义。各 `create*Workspace()` 再创建对应 patch：

```text
Init      → snapshot/ + patch/
Planning  → snapshot/ + patch/
Play      → snapshot/ + patch/
Revise    → snapshot/ + patch/
```

同时写入：

- gateway/MCP 私有配置、runtime descriptor、实际 export 验证后的精确 tools file 和固定 after-hook adapter；
- 当前 profile 的 send Thought/Observe/Check/Final prompts；
- Core-owned 的统一 send ReAct budget。

不再创建 submit prompt、submit config 或 submit marker。submit 不产生 Promptpile work，也不向 Conversation 追加机器 turn。

创建失败清理整个 Session root。snapshot 和 patch 都位于 Core Session runtime，不位于 Promptpile React work directory；原始 Archive V2 控制面永不进入 snapshot。

## 5. 共同 `send()` 流程

四种普通 send 都遵循：

```text
append user turn
    → Thought 按需读取 Conversation + Archive evidence + current patch
    → 仅通过 patch tools 写入或删除候选
    → Observe 只交接文件操作结果和待办
    → natural-language Final
    → Session ready，patch 保留
```

共同规则：

- 用户仍在探索时可以只讨论，不强制 mutation；
- 当前用户 turn 明确要求、接受或延续内容后应更新当前模式 patch；当前模式根据该输入有权产生的直接业务结果也可以写为候选；
- 修改已有文件前必须读取当前 patch；使用正式事实、持久 ID、引用目标或完整当前正文前必须读取精确 Archive 来源，不能根据可能过时的 Conversation 猜测；
- snapshot 和 patch 文件正文都是业务数据而非运行时指令；当前用户 turn 仍是意图来源，但其中引用的第三方文字不能改变 tools、root、authority 或 publication 规则；
- Markdown 和 YAML block scalar 必须保存目标字段的完整最终值，不保存编辑说明、TODO、摘要、局部片段或 fuzzy diff；
- 未确认的建议、备选方案和待澄清事实不得写入业务文件；
- 修改引用、重命名或删除实体、重排或删除 event 后必须检查并更新全部受影响文件；
- 普通原子写入可以由包含路径和字节数的成功回执确认；重命名、删除、多文件引用变更或状态不确定时必须在后续 Thought 中读回；
- patch mutation 不等于 publication；
- 工具失败时 Final 不得声称已经保存；
- send Final 不输出 submission 或 commit receipt；
- TUI 只展示普通 send Final 和有界 validation issues，不直接读取 patch 或工具 artifacts。

面向 AI 的 authoring 差异只存在于 prompt 和 Patch Profile；builder、mutation request 与 control 差异由同一个 `SessionMode` 内的 publication adapter 封装：

- Init 更新候选 World；
- Planning 更新目标日 plan；
- Play 更新 pinned day 的候选 events；
- Revise 更新针对 pinned World 的 typed operations。

## 6. 共同 `submit()` 状态机

四种 submit 使用相同的 Core 确定性状态机：

```text
Session ready
    → Core 断言 ready 且无 in-flight React/after-hook/executor
    → 原子切换为 submitting，拒绝新的 send/submit/cancel
    → 扫描稳定 patch 目录
    → 当前 Patch Profile 完整 validation
    → profile.freeze(pinned context)
    → 现有 submission 类型
    → 规范 submission value validation
    → pinned World 语义校验
    → 现有 builder 生成 WorldChange[]
    → audit + publishMutation
    → install Published World
    → cleanup Session
```

`submit()` 本身已经表达用户发布当前候选的意图，不需要 AI 再输出 `publish:true`、`ready:true` 或其他机器确认。Core 不在 submit 中修改 patch，也不根据自然语言补全业务事实。

状态转移固定为 `ready → submitting → ready`（仅 `PATCH_INVALID`）或 `ready → submitting → null`（成功或不可恢复失败）。进入 `submitting` 后 `send/submit/cancel` capability 均为 false；确定性 publication 不支持中途取消，以免把已开始的 Archive mutation误报为已取消。`dispose()` 仍等待当前 operation 完成或恢复后再删除 runtime root。

第一版只允许 AI 文件工具通过 Session File Runtime 的 patch writer lane 编辑运行中的 patch。TUI 通过 `send()` 表达用户意图，不直接写 patch；测试 fixture 可在 Session 启动前准备。Archive reader 不参与 mutation。未来的受控外部 writer 必须通过新的 Core patch editor API 与 Core operation gate 串行，不能通过宿主目录绕过 Core。

四种 mode 统一使用一个最小内部描述符：

```ts
interface SessionMode<S> {
  createSnapshot(world: PublishedWorld | null): Promise<SnapshotFiles>;
  prompt: PromptDescriptor;
  freeze(root: string, context: PatchContext): Promise<S>;
  preparePublication(session: CoreSession, submission: S): Promise<PreparedPublication>;
}
```

`PromptDescriptor.render({ previousSubmitIssues })` 是 Thought prompt 的唯一 renderer；启动时传空数组，`PATCH_INVALID` 时用新 issues 原子重写同一路径。`freeze()` 是 scanner、parser、Profile validation、freezer 和规范 Submission value validation 的唯一入口；当前没有第二个消费者需要 `scan(): unknown` 中间层。`PreparedPublication` 持有当前 kind 的 `operationType`、`base`、可选 `initialManifest`、`WorldChange[]` 和目标 control；共同 submit pipeline 在其 changes 中加入 audit 后调用唯一 `publishMutation()`。registry 的异构泛型由 Core 内部封装，不作为公共 API 暴露。

每种 Submission V2 parser 拆成“JSON text parse”与“纯 unknown value validation”两层；freezer 的结果必须经过同一个规范 value validator，不能复制字段规则。Pinned World 引用、重复 target 和 expected 注入由对应 Patch Profile 完成。进入 builder 后若仍发生未分类错误，视为实现 invariant/internal error。

## 7. Init 适配

### Context 与 patch

Init 没有 pinned World，patch 从空候选开始。普通 send 逐步形成 title、canon、state、entities 和 narrative。

已有 Init 文件是当前候选权威。修改前先读取并完整写回；重命名或删除 character/location/arc 时同步处理全部 local-key 引用。四个 canon Markdown 的正文是对应字段的完整最终值，不承载修改指令。

### Freeze 与发布

```text
patch/
    → freezeInitPatch()
    → InitSubmissionV2
    → buildInitMutationV1()
    → buildSessionAuditV1()
    → publishMutation(base: null)
```

Core 继续分配 World ID、character/location/arc IDs 和 Archive IDs。Patch local key 不能成为持久 ID authority。

## 8. Planning 适配

### Context 与 patch

Planning 保持当前 pinned World、target day、canon 和 last-settled context。`patch/plan.yaml` 只表达候选计划，不允许选择或修改 target day。

普通 send 对 intent、constraints、open questions 和 beats 的确认应同步到 plan patch。

`plan.yaml` 始终表示完整候选计划。修改时必须先读取当前文件并保留未要求改变的字段和 beats；Conversation 中较旧的计划描述不得覆盖较新的 patch。

### Freeze 与发布

```text
patch/plan.yaml
    → freezePlanningPatch(pinnedWorld, targetDay)
    → PlanningSubmissionV2
    → buildPlanningMutationV1(targetDay, submission)
    → buildSessionAuditV1()
    → publishMutation(base: pinnedWorld)
```

freeze 必须验证 beat keys、顺序依赖，并按规范 `PlanningSubmissionV2` 校验 `maxEvents`。Patch 层不额外要求 `beats.length <= maxEvents`；若要收紧该领域规则，应统一修改 submission、builder、测试和文档。Core 继续分配正式 beat IDs。

## 9. Play 适配

### Context 与 patch

Play 保持当前 immutable World/plan context 和 pinned day。`patch/events/<local-event-key>/` 使用 plan beat IDs、character IDs 和 location IDs。每个 event 必须包含 `event.yaml`，并可按需包含 `scene.md` 和 `dialogue.md`；缺省正文由 freezer 映射为空字符串。

普通 send 产生的已确认场景、对话、用户行动和结果逐步进入候选 events。AI 不能通过 patch 修改 canon、计划本体或正式 World state。

`scene.md` 和 `dialogue.md` 存在时分别是字段的完整最终正文，不包含创作说明、TODO、摘要或局部 diff。重排后检查所有 `order` 仍为唯一安全整数；删除 event 后只删除其候选文件，不重新编号其他 event。

### Freeze 与发布

```text
patch/events/**
    → freezePlayPatch(pinnedWorld, pinnedPlan)
    → PlaySubmissionV2
    → buildPlayMutationV1(pinnedWorld, submission)
    → buildSessionAuditV1()
    → publishMutation(base: pinnedWorld)
```

freeze 必须验证 `event.yaml.order` 是唯一安全整数，并据此形成 events 数组；同时验证 beat/character/location 引用、completed/skipped 冲突和 proposed patch references。authoring 文件中的 proposed patches 只写 target 与新值；`freezePlayPatch()` 从 pinned World 注入 `expected`/`expectedLocationId`，并拒绝整次 Play 内重复写同一状态目标。proposed patches 仍只被记录，后续 Settle 才应用。

## 10. Revise 适配

### Context 与 patch

Revise 保持 pinned Published World 的 mode-specific 只读业务上下文，不暴露整棵 World checkout。`patch/operations.yaml` 保存有序 authoring operations：AI 提供目标、persistent ID 和新值，不重复保存当前值。

普通 send 中已经确认的修改应更新 operations；AI 不能 checkout 后覆盖完整 World，也不能修改 manifest、day history、audit 或 Archive control plane。

replacement operation 的 `value` 必须是目标字段发布后的完整最终值。即使只修改一句话，也必须从 pinned World 的当前权威正文生成完整 replacement；不能把“修改第二段”一类自然语言编辑指令或 fuzzy diff 写入 `operations.yaml`。

### Freeze 与发布

```text
patch/operations.yaml
    → freezeRevisePatch(pinnedWorld)
    → ReviseSubmissionV2
    → buildReviseMutationV1(pinnedWorld, submission)
    → buildSessionAuditV1()
    → publishMutation(base: pinnedWorld)
```

freeze 校验 persistent IDs、引用和冲突写，并从 pinned World 注入 `expected`、`expectedLocationId` 或 `expectedText`，生成完整 `ReviseSubmissionV2`。第一版 create operations 只能引用 pinned World 已有实体，不允许预测 builder ID 或引用同一文件中新建实体；需要新建后引用时拆成下一次 Revise。现有 builder 继续校验 exact preconditions，publication 继续以 pinned World 为 base 执行 OCC。Patch Profile 不引入通用 checkout、overlay 或三方 merge。

## 11. 可恢复 Patch validation

四种模式统一把 patch incomplete、schema invalid、引用 invalid 和候选冲突视为 `PatchValidationError`：

```ts
interface PatchIssue {
  code: string;
  path?: string;
  message: string;
}

class PatchValidationError extends Error {
  constructor(readonly issues: readonly PatchIssue[]) { super('Session patch is invalid.'); }
}
```

公开错误必须保留结构化 issue，而不是要求 TUI 解析 `message`：

```ts
type PatchInvalidCoreError = {
  code: 'PATCH_INVALID';
  message: string;
  issues: readonly PatchIssue[];
};
```

其他错误继续只要求稳定 `code` 与 `message`。`PatchIssue` 是已经移除正文、绝对路径和工具参数的安全公开投影；Core event 如需增量展示，复用同一结构，不定义第二套 validation shape。

可恢复失败不调用 publisher，也不删除 patch。Core 返回稳定 `PATCH_INVALID` 错误码，投射有界 issue，并把 Session 恢复为 ready；同一 Session File Runtime 和 workspace 继续使用，不重启 gateway、MCP server 或 rebind root。

为了让下一次 `send()` 必然看到校验反馈，Core 同时用 `sessionModes[session.kind].prompt` 的同一 renderer 原子重写 Session 私有 Thought prompt，在固定“Previous submit issues”段落中加入有界 issues。该段明确标注为上一次扫描结果、不是用户意图或正式事实；后续 validation failure 覆盖旧段，成功发布随 Session 一起清理。TUI 与模型因此消费同一个 `PatchIssue[]`，不增加 feedback Conversation turn、patch control 文件或第二套错误格式。

authority/executor failure、builder invariant、mutation 状态不确定和 publication conflict 不是 Patch validation failure，继续终止 Session。由于 submit 不创建 Conversation turn 或 Final，不需要 submit artifact classification 或基于文本的 transcript 过滤。

## 12. 终止、cancel 与 dispose

以下终止 Session并清理 patch：

- cancel、dispose 或用户明确放弃；
- snapshot 或 patch root identity/authority 校验失败；
- executor 协议损坏；
- mutation 状态无法确定；
- Session workspace 损坏；
- Core 判断无法安全继续的内部错误。

Core 必须：

- 终止 active React 和工具 executor；
- 等待 React/after-hook 结束，并 dispose Session File Runtime；
- 拒绝迟到 mutation commit；
- 只产生一次 terminal presentation event；
- gateway 与两个 MCP server 全部退出后再删除整个 Session root；
- cancel/dispose 使用可测试的进程树终止抽象，确保 Windows x64、Linux x64 都不留下 React、adapter、gateway、MCP launcher 或原生 binary 后代进程。

## 13. ReAct runner 适配

`runReact` 接受 Core-owned send budget：

```ts
interface RunReactInput {
  // existing fields
  maxSteps: number;
}
```

第一版固定 `PATCH_SEND_MAX_STEPS = 4`，caller 与 Profile 都不可覆盖。Reducer 必须验证 `process.started.max_steps` 与请求一致，并保持 phase、step、stop reason 和 Final evidence校验；四种真实 provider fixture 都必须证明能在该预算内完成 inspect → edit → review → Final。

## 14. Audit 与 transcript

四种成功发布都建议保持：

```text
audit/sessions/<session-id>/meta.json
audit/sessions/<session-id>/transcript.json
audit/sessions/<session-id>/submission.json
```

- meta 保存 Session kind 和可选稳定快照 digest；
- transcript 只包含用户可见自然语言 turns；
- submission 保存冻结并被接受的现有 submission 值；
- tool calls/results、patch state 和未接受正文不进入正式 transcript；
- accepted submission 是正式发布输入审计，不是未发布 draft 日志。

由于 submit 不运行 React、不追加 marker 或机器 Final，audit builder 不再接收 `hiddenFinal`，也不按文本值过滤 submit attempt。正式 Conversation 天然只包含用户普通消息与普通 send 的自然语言 Final。

## 15. Settle 与 abandon

二者不是对话 Session，继续由 Core 根据 Published World 和已发布 Play events 确定性执行：

```text
Published events/state
    → buildSettlementMutationV1() 或 abandon mutation
    → publishMutation()
```

它们不创建 snapshot/patch、不启动 Session File Runtime，也不向 AI 提供文件工具。

## 16. 配置与公开 API

caller 不能指定：

- Patch Profile；
- tools/adapter/MCP server/gateway；
- hook failure policy；
- patch/work root；
- send max steps；
- path/schema/resource policy。

现有公开方法保持不变：

```text
startSession
send
submit
cancel
settle
abandonDay
dispose
```

第一版不为“候选已更新”增加 Core state 或 event；普通 send Final 已经能说明本轮是否保存。`submit()` 的 `PATCH_INVALID` 在现有 `CoreResult` 上增加结构化 `issues`，TUI 直接渲染该结果。`PatchIssue` 不重复暴露 profile 字段，也不暴露绝对路径、完整 arguments 或候选正文；Session kind 已经是唯一 Profile 身份。只有出现独立候选面板的真实产品需求时，才增加新 event。

## 17. 分阶段实施

阶段按共同基础设施和四个 Profile 组织，不以“是否改造某个对话模式”为可选项。

当前代码中的明确切入点如下，它们都是本改造要替换的现状，不是前置阻塞：

- `session/common.ts` 当前写入空 tools；P0 改为写入双实例 gateway/MCP 配置、runtime descriptor、经 export 验证的精确 tools file 和固定 after-hook adapter；
- `packages/core/package.json` 当前已加入但生产代码尚未使用 `promptpile-mcp`；Gate 0 验证并固定它与 `fs-mcp-rs` 的实际可执行产物后，P0 接入生产 Runtime；
- `promptpile/react-runner.ts` 当前把 ReAct 固定为单步；P0 改为接受统一的 Core-owned send budget；
- `core.ts` 当前 submit 运行 React 并从 Final 解析 submission，且 failure 统一终止清理；P0/P2 改为确定性 patch pipeline，并区分可恢复 `PatchValidationError` 与不可恢复的 authority/executor/invariant/publication failure；
- cancel/dispose 当前只跟踪一个根 child；P0 改为同时拥有 React/adapter 与 gateway 进程树，等待 gateway 和两个 MCP server 全部退出后再清理 Session root；
- 四种 Session 当前从大型 typed JSON Final 读取 Submission V2；P2 切换为无 AI submit + patch freeze，并删除 submit prompt/config/marker 和旧解析路径，不保留 fallback。

### Gate 0：第三方执行契约

Gate 0 只验证和锁定既定 `fs-mcp-rs@1.2.2 + promptpile-mcp@0.1.0-beta.3 gateway + after-hook adapter` 路线，不重新选择架构：

- fresh install 后从 package metadata 解析已安装 bins，确认 npm package、launcher release target 与实际 binary `--version` 都为 `1.2.2`，禁止生产时 `npx -y` 下载 latest；
- 明确接受固定 GitHub release tag 的 HTTPS asset 作为第一版二次下载信任边界：发布流水线在打包阶段完成下载和实测，运行时不得下载；npm lockfile 不被描述成覆盖原生 binary，组织级 digest pinning 需要时另做制品镜像/依赖获取方案；
- 逐项核对 npm package version、实际 binary `--version`、平台 asset 和许可证；任何不一致立即失败，并在相同拓扑下修正固定版本或包获取方式；
- 启动随机 loopback port/token 的 strict gateway，验证两个 server 同时 `up`、鉴权生效、端口冲突有界重试；
- 通过真实 `tools/list` 与 gateway export 固定 archive list/read、patch list/read/write/remove 的精确名称、schema 和成功/失败回执；
- 证明 after-hook adapter 只用公开 artifacts/env/CLI 完成最小 schema 投影、`exec-calls`、result 配对和首错停止；
- 证明 Promptpile 只在 hook/exec-calls 完成后结束 Thought，并验证 Windows x64、Linux x64 下 cancel、强制终止与无孤儿进程；特别覆盖 npm launcher 及其原生 binary 后代，unsupported platform/arch 必须在初始化阶段失败。

### P0：共同 Patch Runtime 与 Session File Runtime

- 保留并精确固定 `promptpile-mcp@0.1.0-beta.3`，在 Gate 0 证明实际 binary version 匹配后加入 `fs-mcp-rs@1.2.2` 依赖/获取配置并提交 lockfile；
- 实现 Core-owned snapshot projection、双实例配置、随机 gateway port/token、health/export startup gate 和唯一 patch writer lane；
- 实现固定 after-hook adapter，只通过 `promptpile-mcp exec-calls` 公共 CLI 路由；若需要解析 Promptpile tool artifact，只使用公开 `promptpile-protocol` 入口并声明直接依赖；
- 扩展 `resolvePackagedBoundaries()`，解析 gateway、filesystem bin 与 packed adapter，拒绝 caller path；`test:pack` 必须从安装后的 tarball 验证这些边界；
- 实现双 root confinement、服务端 archive 只读、Core 路径复核、资源限制、串行首错停止和裁剪回执；
- 实现 ready/quiescent 不变量与可恢复 `PatchValidationError`；validation failure 复用同一 Runtime/workspace 并刷新 Thought issue context；
- 将当前单一 `activeChild` 扩展为明确的进程树所有权，验证 after-hook 中途取消、gateway dispose 和强制终止都不会迟到写入；
- `runReact` 接受统一的 Core-owned send maxSteps。

### P1：四个 Patch Profiles

- 实现 Init schema/validate/freeze；
- 实现 Planning schema/validate/freeze；
- 实现 Play schema/validate/freeze；
- 实现 Revise schema/validate/freeze；
- 把可复用值校验从 Submission V2 text parser 提取为规范纯值校验器，text parser 与 freezer 都调用它；不得以 JSON stringify 绕行或复制另一套字段校验；
- 分别验证 freeze 与现有 parser/builder 语义一致。

### P2：四条 Session 流程切换

- start/send/submit 通过 `session.kind` 一次路由对应 `SessionMode`，由同一 descriptor 成对提供 snapshot、prompt、freeze 与 publication adapter；
- 更新四套 send Thought/Observe/Final prompts；
- 删除四种 submit React、prompt、config、marker 和机器 Final；
- 复用现有 builders/audit/publisher；
- 删除四种生产大型/typed JSON Final 路径及长期 fallback。

### P3：产品化

- TUI 渲染 `PATCH_INVALID.issues` 与现有 send Final；
- Init/Planning/Play/Revise 真实 provider fixtures；
- Windows x64、Linux x64 × Node 20/22；unsupported platform/arch 在 `SessionFileRuntime.start()` 初始化阶段稳定失败；
- packed fresh-install；
- 全量回归和发布门禁；
- 同步更新 `doc/contracts/CORE_RUNTIME_V1.md`、`doc/architecture/SESSION_MANAGER.md`、`doc/concepts/SESSION.md`、`doc/guide/WORLD_LIFECYCLE.md`、`doc/guide/TROUBLESHOOTING.md`、Core/TUI 文档与测试说明；
- 正式文档落地后删除这三份草案，避免并存两套权威说明。

## 18. 测试矩阵

### 共同 Runtime

- `session.kind` 路由正确 Patch Profile 且不能跨 kind；
- snapshot 精确匹配当前 SessionMode manifest，不包含其他 day history、custom 或 Archive V2 控制面；Init snapshot 为空；
- `archive_fs` 服务端只读，`patch_fs` 只能修改当前 patch，额外上游工具不进入 tools file；
- send 渐进更新并保留 patch；
- recoverable `PATCH_INVALID` 可重试且 submit 不产生 transcript artifact；
- validation retry 复用同一 Runtime/workspace，不重启 gateway/MCP server 或 rebind root，并刷新下一次 Thought 的 issue context；
- success/cancel/dispose 正确 cleanup；
- caller 无法覆盖 gateway/MCP server、模型可见工具、profile、snapshot/patch root、token/port 或 budget；
- 随机 port/token、双 server health/export、packed adapter、Windows x64/Linux x64 进程树取消、calls/result 完整配对和首错停止全绿；
- 正式事实、已保存候选和本轮授权分别由 snapshot、patch 和当前用户 turn 决定；
- 修改已有文件前读取；普通原子写入以回执确认，重命名、删除、多文件引用变更或状态不确定时读回；工具失败后不虚构保存成功；
- 正文中的 prompt injection 不能改变工具、root、authority、日志或 publication 行为；
- submit 不调用 AI且不修改 patch，缺失事实通过可恢复 validation issue 返回。

### Profile

- Init：local keys、实体引用、完整 World freeze；
- Planning：beat 顺序、依赖和 target day pinning；
- Play：event order、pinned IDs、必需 `event.yaml`、可选正文文件、result 和 proposed patches；
- Play proposed patches：authoring shape 不含 expected fields，freeze 注入值与 pinned World 一致，重复目标被拒绝；
- Revise：persistent IDs、Core 注入 exact preconditions、冲突写和同次新建实体引用禁令；
- 四种 invalid patch 都不能 publish。

### Regression

- 四种小型候选与当前 submission/builder 产物语义等价；
- 四种大型 fixture 不再依赖单个大型 JSON Final；
- Init → Planning → Play → Settle 全绿；
- Revise、abandon 和 restart/read-back 全绿；
- packed TUI 和跨平台 CI 全绿。

## 19. Definition of Done

1. Init、Planning、Play、Revise 全部拥有独立 Patch Profile；
2. 四种普通 send 都能渐进形成各自候选；
3. 四种 submit 都不调用 AI、不产生 Conversation turn 或机器 Final；
4. 四种 patch 由 `session.kind` 唯一路由并冻结为各自现有 submission 类型；
5. 现有 builders、publisher 和 Archive schema 不变；
6. validation failure 不丢失候选，返回 `PATCH_INVALID` 并允许重试；
7. invalid patch 永远不能产生 Published World mutation；
8. Session 不能跨 profile，caller 不能开启或替换 profile；
9. Settle、abandon 保持 Core 确定性流程；
10. Play event 以 `order` 确定顺序且无需目录重命名；
11. Revise preconditions 由 Core 从 pinned World 注入，现有 builder/OCC 校验不降低；
12. Patch 文件不建立独立版本协议或旧格式兼容层；
13. 四种 send 都遵守共同 authority、inspect-before-write、完整最终值和引用闭环，并对高风险或状态不确定修改执行条件 read-back；
14. Archive 通过服务端只读 business snapshot 提供事实依据，原始 Archive V2 控制面不暴露；
15. `patch_fs` 是唯一 AI 可写边界，gateway 的额外工具和 dynamic root 不可用；
16. 不引入通用 checkout、三方 merge 或第二套产品 Runtime。
