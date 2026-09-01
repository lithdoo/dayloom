# `@dayloom/draft-assistant` V1 设计草案

> 状态：**Draft**（2026-09-01）  
> 范围：`packages/draft-assistant`  
> 目标：在保持 `dayloom-draft` CLI 参数兼容的前提下，将“用户对话”和“Draft 更新”拆成两条独立的 Promptpile React 流程，并通过 stage-aware Observe/Check 防止对话偏离当前 Dayloom 主线流程。

---

## 1. 结论先行

`@dayloom/draft-assistant` 不是 `@dayloom/draft` 的另一套 Draft editor。

V1 将其定义为一个 **Dayloom 对话编排层**：

```text
User message
    ↓
Dialogue React
    ↓
Conversation
    ↓
Draft Sync React
    ↓
Draft
    ↓ later
@dayloom/cli check / settle
    ↓
World
```

核心边界：

```text
Conversation = 用户意图形成过程
Draft        = Conversation 的当前语义投影
World        = settle 后的 canonical state
```

因此：

- Dialogue React 负责和用户对话、保持当前 stage 目标、发现偏离并自动修正；
- Draft Sync React 负责把已接受的 Conversation 投影到 Draft；
- Dialogue React **没有 Draft 写权限**；
- Draft Sync React 拥有受限 Draft 写权限；
- 两条 React 都只能只读 World；
- World mutation / validation / settlement 继续由 `@dayloom/cli` 负责；
- Promptpile React 保持通用执行器，不知道 `init / plan / play / revise` 的业务语义。

---

## 2. 与现有 `@dayloom/draft` 的区别

现有 `@dayloom/draft` V1 的主流程是：

```text
User message
    ↓
Single Promptpile React
    ↓
Thought 同时：
- 理解用户意图
- 读取 World
- 修改 Draft
    ↓
Observe 检查 Draft 是否还需要继续编辑
    ↓
Check
    ↓
Final
```

它本质上是一个“带对话能力的 Draft editor”。

`draft-assistant` V1 改为：

```text
User message
    ↓
Dialogue React
    ↓
只负责用户交互与 stage 对齐
    ↓
Final → Conversation
    ↓
Draft Sync React
    ↓
只负责 Conversation → Draft
```

关键差异：

| 维度 | `@dayloom/draft` | `@dayloom/draft-assistant` |
| --- | --- | --- |
| React 数量 | 1 | 2 条独立 React |
| Dialogue 与 Draft 编辑 | 耦合 | 分离 |
| Dialogue Draft 权限 | RW | **无权限** |
| Draft Sync Draft 权限 | 不存在独立阶段 | 受限 RW |
| World 权限 | RO | 两条都 RO |
| Dialogue Observe | Draft 是否改完 | 当前回复是否偏离 stage / 是否需要 repair |
| Sync Observe | 不独立存在 | Conversation 与 Draft 是否一致 |
| Conversation 地位 | React 上下文 | Draft 的上游语义来源 |
| Draft 地位 | React 直接工作对象 | Conversation 的派生投影 |

---

## 3. CLI contract

V1 **完全参考并兼容现有 `dayloom-draft` 参数面**，不因内部改成双 React 而暴露新的流程参数。

形式：

```text
dayloom-draft-assistant [init|plan|play|revise]
  --world <path>
  (--draft <path>... | --draft-dir <path>)
  --conversation <path>
  --llm-config <path>
  --message <text>
  [--output-format terminal|stream-json]
```

规则：

1. command 可显式指定 `init | plan | play | revise`；
2. 未显式指定时，继续通过当前 World 状态推导可用 mutation command；
3. `--world` 必填；
4. `--conversation` 必填；
5. `--llm-config` 必填；
6. `--message` 必填且不可为空；
7. `--draft` 可重复；
8. `--draft` 与 `--draft-dir` 互斥且必须二选一；
9. `--output-format` 默认 `terminal`；
10. CLI 参数的 path canonicalization、command availability 与 argument validation 语义应尽量复用 `@dayloom/draft` 已有 public primitives。

示例：

```bash
dayloom-draft-assistant init \
  --world ./world \
  --draft-dir ./draft \
  --conversation ./conversation \
  --llm-config ~/.dayloom/llm.toml \
  --message "我想做一个近未来东京背景的故事"
```

外部仍保持：

```text
one invocation = one user message
```

内部则执行：

```text
one user message
    ↓
one Dialogue React
    ↓
one Draft Sync React
```

---

## 4. Stage contract

command 不只是 Draft 类型，也定义 Dialogue React 当前必须遵守的 stage objective。

### `init`

目标：

```text
收敛初始化 World 所需的用户意图。
```

允许：

- 询问缺失初始化信息；
- 总结用户已经确认的设定；
- 提供有限候选供用户选择；
- 在信息充分时确认当前理解。

禁止：

- 未完成初始化就推进故事时间；
- 自顾自写场景或小说正文；
- 提前进入 `plan`；
- 将 assistant 自己的建议视为用户确认。

### `plan`

目标：

```text
收敛下一日 / 下一阶段的用户计划意图。
```

禁止：

- 把计划讨论直接当成已经发生的剧情；
- 未经用户确认自行决定关键目标、场景或行为。

### `play`

目标：

```text
在当前 World 与当前计划约束下完成用户交互式 play。
```

允许实际叙事推进，但不得越过当前 World / plan 的 canonical 约束。

### `revise`

目标：

```text
收敛用户希望长期修改的 World / canon / memory 意图。
```

禁止：

- 把讨论中的候选修改视为已经写入 World；
- 绕过 Draft / CLI lifecycle 直接变更 Archive。

---

## 5. Dialogue React

### 5.1 Authority

Dialogue React：

```text
Conversation    RW（通过 Promptpile）
World           RO
Draft           NONE
```

工具层必须保证 Dialogue React 根本看不到任何 `mcp__draft__*` 写工具。

这不是 prompt-only 约束，而是 infrastructure authority。

### 5.2 Promptpile React 配置

V1 建议：

```toml
[promptpile-react]
max_step = 4
observe_carryover = 1
```

`observe_carryover = 1` 的目的：

```text
Thought₀
  ↓
Observe₀ 发现偏离并给出修正方向
  ↓
Check₀ = continue
  ↓
Thought₁ 自然看到 Observe₀
  ↓
按评价修正
```

Promptpile React 的 phase 职责保持通用：

```text
Thought  = 执行 / 推进工作
Observe  = 观察 / 评价当前 iteration
Check    = current Observe → continue / stop
Final    = 对外形成最终回复
```

`draft-assistant` 不扩展 Check protocol，也不要求 Check 产生业务 feedback。

### 5.3 Dialogue Observe contract

建议固定为：

```text
[ASSESSMENT]
当前 iteration 相对 stage objective 的总体评价。

[DRIFT]
<none> 或具体偏离。

[REPAIR]
<none> 或下一轮应该如何修正。

[STAGE_STATUS]
collecting | ready

[USER_REPLY]
当前已通过评价、准备交给用户的回复；若还需 repair 则为 <none>。

[SHOULD_CONTINUE]
true | false
```

其中：

```text
SHOULD_CONTINUE=true
= 当前这次用户回复仍需内部 repair

SHOULD_CONTINUE=false
= 当前回复已经可以交给 Final
```

它**不表示整个 init / plan / play / revise stage 是否已经结束**。

例如：

```text
init 尚未收集完用户角色
但当前最合理的回复是询问用户角色
```

此时应该是：

```text
[STAGE_STATUS]
collecting

[USER_REPLY]
你希望自己在这个世界中扮演什么角色？

[SHOULD_CONTINUE]
false
```

即：当前 React turn 已完成，但整个 init stage 仍未完成。

### 5.4 Final contract

Final 尽量保持低自由度：

```text
只输出 latest approved Observe 中的 [USER_REPLY]。
不得引入新的事实、决定、问题、计划或剧情推进。
```

目标是让真正被 Observe / Check 审查过的内容成为用户可见回复，而不是 Final 再重新做一次业务推理。

### 5.5 偏离示例

用户：

```text
我想初始化一个近未来东京世界。
```

错误 Thought：

```text
雨落在新宿站外，你推开酒吧的门……
```

Observe：

```text
[ASSESSMENT]
Current iteration violates init objective.

[DRIFT]
The response begins fictional scene narration before initialization is complete.

[REPAIR]
Return to initialization. Do not advance story time. Ask the user to establish their role.

[STAGE_STATUS]
collecting

[USER_REPLY]
<none>

[SHOULD_CONTINUE]
true
```

Check：

```text
true
```

下一轮 Thought 看到该 Observe 后修正。

---

## 6. Draft Sync React

Dialogue Final 成功并持久化进入 Conversation 后，启动独立 Draft Sync React。

### 6.1 Authority

Draft Sync React：

```text
Conversation    RO
World           RO
Draft           RW（严格受 --draft / --draft-dir 限制）
```

Draft Sync 不产生用户对话，不向用户 Conversation 写入任何 Thought / Observe / Final。

### 6.2 目标

```text
根据当前 command，将 Conversation 中仍然有效、已经成立的用户意图投影到 Draft。
```

保留现有 `@dayloom/draft` V1 中已经证明有价值的语义约束：

1. Draft 是 `@dayloom/cli` 的后续语义输入，不是 World mutation DSL；
2. World 只读；
3. Draft 必须反映当前有效用户意图；
4. 被否定或替换的旧意图不得因为仍存在于 Conversation 就继续占优；
5. assistant 自己的建议不等于用户确认；
6. 只能写 granted Draft authority；
7. Draft 改动只能通过授权工具发生。

### 6.3 Draft Sync Observe contract

建议：

```text
[EVIDENCE]
本轮有效的 Draft reads / writes。

[MISMATCH]
当前 Draft 与有效 Conversation 之间仍然存在的语义不一致；无则 <none>。

[REPAIR]
下一轮应如何修正 Draft；无则 <none>。

[SHOULD_CONTINUE]
true | false
```

V1 建议：

```toml
[promptpile-react]
max_step = 6
observe_carryover = 1
```

### 6.4 不污染 Conversation

Draft Sync React 不应使用：

```text
--output-dir <user-conversation>
--continue
```

它自己的 work Conversation 只属于内部 session。

用户 Conversation 中只允许出现：

```text
User
Assistant Final
User
Assistant Final
...
```

---

## 7. 一次 invocation 的完整顺序

```text
1. parse / validate argv
2. classify World / resolve command
3. resolve canonical authority
4. resolve Promptpile binaries + LLM config
5. prepare Dialogue React runtime
6. append user message → Conversation
7. run Dialogue React
8. persist Dialogue Final → Conversation
9. prepare Draft Sync React runtime
10. run Draft Sync React
11. return Dialogue Final / process status
```

关键要求：

- setup failure 发生在 append user 之前时，不得污染 Conversation；
- Dialogue React 没有 Draft authority；
- Draft Sync 失败不得回滚已经成功的 Conversation；
- Conversation 成功但 Draft Sync 失败属于可恢复状态。

---

## 8. Failure / recovery semantics

### 8.1 Dialogue 失败

```text
User message 已经 append
Dialogue Final 未成功
```

该 invocation 返回失败；保留必要调试状态，具体 cleanup 语义参考 Promptpile React 自身失败契约。

V1 不尝试伪造 assistant Final。

### 8.2 Dialogue 成功，Draft Sync 失败

```text
Conversation = ahead
Draft        = stale
```

这是允许且可恢复的状态。

原因：

```text
Conversation 是交互历史
Draft 是其派生投影
```

不应为了保持二者“原子一致”而 rollback Conversation。

V1 应提供内部或 public library primitive：

```text
syncDraft()
```

使调用方可以重新执行 Conversation → Draft 投影。

### 8.3 World / Draft authority violation

一律 fail-closed。

不得自动扩大 path authority，不得把不存在的 World 文件视为可写工作区，也不得因为模型请求而暴露未声明工具。

---

## 9. `--output-format` 语义

`--output-format terminal|stream-json` 继续只代表**用户可见 Dialogue React**。

Draft Sync React 的 Thought / Observe / tool events 不直接转发到 stdout。

原因：调用方应继续把一次 invocation 理解为“一次用户对话 turn”，而不是观察内部两条 React 的混合 event stream。

Draft Sync failure 可以通过：

```text
stderr + non-zero exit
```

表达。

V1 暂不扩展额外 lifecycle protocol。

---

## 10. 实现复用边界

V1 应尽量复用 `@dayloom/draft` 已有 public primitives：

```text
argv parsing contract
command classification
World mutation availability
path canonicalization
Draft authority resolution
Promptpile binary resolution
LLM config reading
```

但不直接复用旧的单 React orchestration：

```text
executeDraftV1()
runPromptpileReactV1()（若其 argv 固定旧语义）
startFileRuntimeV1()（若其固定同时暴露 World RO + Draft RW）
```

原则：

```text
复用 contract / primitive
不复用旧 orchestration
```

后续若 `draft-assistant` 架构稳定，可再决定是否把通用 runtime primitives 下沉成共享 package。

---

## 11. 建议源码结构

```text
packages/draft-assistant/
├── README.md
├── package.json
├── doc/
│   └── DESIGN_V1.md
└── src/
    ├── index.ts
    ├── assistant.ts
    ├── types.ts
    ├── errors.ts
    │
    ├── stage/
    │   ├── resolve.ts
    │   └── contract.ts
    │
    ├── dialogue/
    │   ├── prompts.ts
    │   ├── react.ts
    │   └── run.ts
    │
    ├── sync/
    │   ├── prompts.ts
    │   ├── react.ts
    │   └── run.ts
    │
    └── runtime/
        ├── authority.ts
        ├── file-runtime.ts
        ├── hook.ts
        ├── promptpile.ts
        └── config.ts
```

职责：

```text
assistant.ts
= orchestration

dialogue/*
= user interaction policy

sync/*
= Conversation → Draft policy

runtime/*
= Promptpile / MCP mechanics

stage/*
= Dayloom command semantics
```

---

## 12. V1 验收场景

第一版不以“自动完成完整故事”为验收目标。

必须先证明下面的 vertical slice：

```text
用户：
“我想初始化一个近未来东京世界。”

Dialogue Thought₀
→ 错误开始小说叙事

Observe₀
→ 检测 init narrative drift
→ 给出回到初始化、询问用户角色的 repair

Check₀
→ true

Thought₁
→ 因 observe_carryover=1 看到 Observe₀
→ 修正

Observe₁
→ [USER_REPLY] = “你希望自己在这个世界中扮演什么角色？”
→ SHOULD_CONTINUE=false

Final
→ 用户收到该回复
→ Conversation 成功持久化

Draft Sync React
→ Draft 只记录“近未来东京”这一已成立用户意图
→ 不把 assistant 的角色建议写成用户决定
→ 不修改 World
```

### 必测 invariant

1. Dialogue React 不能获得任何 Draft write tool；
2. `init` 阶段发生 narrative drift 时可通过 Observe carryover 自动 repair；
3. Check 只做 `Observe → continue/stop`；
4. Final 不重新发明未经 Observe 审核的业务内容；
5. assistant 建议但用户未确认时不得进入 Draft；
6. 用户改变主意后，旧意图不得继续残留在 Draft；
7. Draft Sync failure 不回滚 Dialogue Conversation；
8. World 始终 RO；
9. `--draft` / `--draft-dir` authority escape 必须 fail-closed；
10. CLI 参数与 `dayloom-draft` V1 保持兼容；
11. `terminal` 与 `stream-json` 的用户可见输出不混入 Draft Sync 内部事件；
12. Linux / Windows path 行为保持一致。

---

## 13. V1 非目标

以下暂不进入 V1：

- 自动 settle / publish World；
- 新的 Archive protocol；
- 新的 Promptpile React Check protocol；
- 多 agent 调度；
- 自动 command 跨阶段切换；
- `--session` / `--resume` / interactive shell 等新 CLI surface；
- 把 Draft Sync 内部事件暴露给默认 stdout；
- 为 Conversation + Draft 构造跨文件系统事务；
- 删除或替换现有 `@dayloom/draft`。

---

## 14. Open questions

实现前仍需决定：

1. `draft-assistant` 是否直接依赖 `@dayloom/draft` public primitives，还是先复制最小 primitive，待稳定后再抽共享层；
2. Dialogue React 的 Final 是否严格逐字返回 `[USER_REPLY]`，还是允许非常有限的格式化；
3. Draft Sync 失败后的 public recovery API 命名：`syncDraft()` / `resyncDraft()` / 其他；
4. Draft Sync 的内部 work root 生命周期是否每次 invocation 独立，还是允许显式 debug preserve；
5. stage-specific prompt 是否全部代码生成，还是部分以 package 内 markdown sidecar 维护；
6. `play` 阶段对“允许叙事推进”的具体边界需要单独补充更严格 contract。

在这些问题没有结论前，本文件保持 **Draft** 状态。
