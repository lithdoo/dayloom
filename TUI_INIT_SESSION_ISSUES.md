# TUI Init Session 问题记录

> 状态：已分析，待修复  
> 范围：Dayloom TUI / Core2 / Promptpile-ReAct / Promptpile  
> 主要场景：未初始化 World 时进入 Init Session，与 AI 多轮协作构建世界

## 1. 背景

在 TUI 中测试 Init Session 时观察到两个明显问题：

1. 首轮 AI 回复看起来是正常流式输出，但后续轮次经常表现为长时间等待，然后大段内容一起出现，流式体验明显退化。
2. AI 没有持续围绕“世界观、人物、关系、情节基础”等初始化内容进行协作，而是在认为信息“差不多完整”后开始直接推进剧情事件，行为从世界设计滑向了 Play/Simulation。

本文件记录当前代码链路、已确认原因、风险以及建议修复顺序。

---

## 2. 当前调用链

普通 Session 输入最终经过以下路径：

```text
TUI submitSessionText
  -> runtime-driver requestSend
  -> core.send(text)
  -> append user turn to Promptpile Conversation
  -> runCompressionBeforeCompletion
  -> runSessionReact
  -> promptpile-react
       -> Thought
       -> Observe
       -> Check
       -> Final
  -> final.delta
  -> Core2 output.delta
  -> TUI message update + render
```

相关代码：

- `packages/tui/src/runtime-driver/driver.ts`
- `packages/core2/src/core.ts`
- `packages/core2/src/promptpile/react-runner.ts`
- Promptpile 仓库：`packages/promptpile-react/src/react-runtime.ts`
- Promptpile 仓库：`packages/promptpile-react/src/react-processes.ts`

一个重要事实是：**TUI 与 Core2 本身没有“仅第一轮流式、后续轮次关闭流式”的分支。**

Core2 会在收到 `final.delta` 时立即触发 `onDelta`，再发布 `output.delta`；TUI 收到 `output.delta` 后会立即追加到当前 streaming assistant message 并 `emit()`。

因此目前看到的“后续回复像一次性加载”不能简单归因于 TUI 把完整回答缓存到最后。

---

## 3. 问题一：后续回复的流式体验退化

### 3.1 当前行为

`core.send()` 的可见输出并不是直接的一次聊天 completion。

每轮都会完整执行：

```text
Thought -> Observe -> Check -> Final
```

只有进入 `Final` 阶段以后，`promptpile-react` 才通过 output pile / fd3 暴露 token/delta，并进一步产生 `final.delta`。

也就是说，用户看到：

```text
AI 正在回复...
```

时，前面可能正在串行进行多个完全不可见的 LLM 调用。

### 3.2 为什么越到后面越明显

随着 Conversation 变长，隐藏阶段处理的上下文也会变长，导致真正进入 `Final` 前的等待时间增加。

表现上会从：

```text
短暂等待 -> Final 持续流式输出
```

逐渐变成：

```text
长时间无可见输出 -> 很短的 Final -> 看起来像整块突然出现
```

如果 provider 自身的 SSE chunk 较大，或者 Final 回复较短，这种感受会更强。

### 3.3 当前 transport 本身基本是流式的

已确认的链路：

1. Promptpile Chat Completions 请求使用 `stream: true`。
2. SSE 中的 `delta.content` 会立即进入 `onChunk`。
3. output pile writer 会立即写出 delta。
4. Promptpile-ReAct 的 Final 阶段实时消费 fd3。
5. `final.delta` 被实时写为 Agent Event JSONL。
6. Core2 立即转换为 `output.delta`。
7. TUI 立即更新 streaming message。

所以这里的首要问题不是“stream transport 被关闭”，而是**可见流式阶段前存在过重的隐藏工作**。

### 3.4 `max_step = 1` 让 Observe/Check 的收益尤其低

Core2 派生 ReAct 配置时固定：

```text
max_step = 1
```

而 Promptpile-ReAct 中的 Check 阶段本质是在决定外层 ReAct 是否继续。

在 `max_step = 1` 的前提下，即使 Check 判断“应该继续”，runtime 也已经达到最大 step，仍然会进入 Final。

因此对当前普通聊天型 `send()` 而言：

```text
Thought -> Observe -> Check
```

增加了多次模型调用和 latency，但基本无法产生真正的第二轮 ReAct 修正。

---

## 4. 问题二：隐藏 Thought 被写入正式 Conversation

这是当前更严重的结构性问题。

### 4.1 Core2 始终以 continue 模式运行 promptpile-react

`packages/core2/src/promptpile/react-runner.ts` 中会传入：

```text
--continue
```

同时指定：

```text
-d <context>
--output-dir <conversation>
```

### 4.2 Promptpile-ReAct 会给 Thought 和 Final 都加 `-c`

Promptpile 仓库中的 `buildPhaseArgv()` 当前逻辑：

```text
if continueMode && phase in { thought, final }
  add -c
```

这意味着：

- Thought completion 会以 assistant turn 写入 Conversation。
- Final completion 也会以 assistant turn 写入 Conversation。

### 4.3 实际历史与用户看到的历史不一致

用户看到的逻辑历史应当类似：

```text
user
assistant-visible
user
assistant-visible
```

但实际 Conversation 可能变成：

```text
user
assistant-hidden-thought
assistant-visible-final
user
assistant-hidden-thought
assistant-visible-final
```

也就是说，**内部 agent reasoning 被永久保存成普通 assistant 历史。**

下一轮模型会把这些 hidden Thought 重新当作历史上下文读取。

### 4.4 风险

这会造成至少四类问题：

1. **行为漂移**：模型会把先前内部推理误认为自己已经向用户做出的公开判断。
2. **目标漂移**：Thought 中的“下一步建议”可能在下一轮被继续执行。
3. **上下文膨胀**：每个用户回合实际上会产生至少两条 assistant 内容。
4. **压缩污染**：Semantic Summary 可能进一步把 hidden Thought 中的计划、承诺或“next action”固化为长期历史。

该问题应被视为 P0。

---

## 5. 为什么 Init Session 会从世界构建滑向剧情推进

目前至少有三个因素叠加。

### 5.1 hidden Thought 污染 Conversation

Thought 可能产生类似内部判断：

```text
设定已经比较完整，可以开始通过一个开场事件使世界具体化。
```

正常情况下这只应存在于 ephemeral scratch/reasoning 中。

但当前实现会把它保存成 assistant history，下一轮 Final 再看到它时，就很容易顺势开始剧情。

这很可能是“AI 自己觉得差不多了，然后开始跑事件”的重要原因。

### 5.2 Promptpile 默认 ReAct Core 偏“执行任务”

Promptpile-ReAct 默认 core prompt 将模型定位为多轮 agent 的“执行核心”，强调：

- 推理与行动；
- 每轮推进当前可完成工作；
- 多步任务明确下一步建议。

这种 prompt 对工具型 agent 合理，但对 Init 的“协作式世界设计室”并不理想。

它天然比纯 authoring conversation 更容易向“继续执行下一步”收敛。

### 5.3 Init prompt 没有明确划定 Authoring / Simulation 边界

当前 Init prompt 会要求模型：

- 建立 title、premise、rules、style、user role；
- 向用户提问或总结仍需确认的选择。

但是没有明确禁止：

- 推进世界时间；
- 开始 Day 1；
- 让 NPC 实际行动；
- 发生正式剧情事件；
- 进入世界内角色扮演；
- 把候选示例描述成已经发生的事实。

因此从 LLM 视角，“通过一个事件把设定具体化”仍可能被理解为合理的世界构建方式。

产品语义上则已经越界进入 Play。

---

## 6. 当前 Init Canon 数据模型与产品目标不匹配

当前 `InitSubmissionV1` 只有：

```json
{
  "version": 1,
  "title": "...",
  "canon": {
    "premise": "...",
    "rules": "...",
    "style": "...",
    "userRole": "..."
  }
}
```

也就是说，正式 World Canon 当前主要只有：

```text
canon/premise.md
canon/rules.md
canon/style.md
canon/user-role.md
```

但实际希望 Init 阶段协作构建的内容还包括：

- 人物；
- 人物关系；
- 地点；
- 势力或组织；
- 世界历史；
- 主要冲突；
- 可供后续 Planning / Play 使用的故事种子。

这些内容目前没有正式、明确的持久化位置。

因此模型一旦填满 premise/rules/style/userRole，就有充分理由认为 Init 的核心任务已经接近完成。

之后自然容易转向“开始故事”。

---

## 7. Compression 会放大 Conversation 污染

Core2 Semantic Summary 当前会保留：

- user choices；
- established events；
- assistant commitments；
- unresolved story state；
- next relevant actions。

如果 hidden Thought 已被写成 assistant history，那么其中本应是内部推理的内容可能被 summary 识别为：

- assistant commitment；
- unresolved work；
- next action。

最终会从一次内部 reasoning 进一步变成长期压缩历史。

因此修复 hidden Thought 污染应优先于调整 summary prompt。

---

## 8. 推荐架构

### 8.1 Authoritative Conversation 只保存用户真正参与的对话

目标结构：

```text
authoritative Conversation
  user
  visible assistant
  user
  visible assistant
```

ReAct 内部状态如果仍然需要，应放在独立的 ephemeral scratch 中：

```text
ReAct scratch
  thought
  observe
  check
```

**Thought / Observe / Check 不应该进入 authoritative Conversation。**

### 8.2 Init / Planning / Revise 普通 send 不建议使用完整 ReAct

这三个 Session 的普通交互本质更接近：

```text
collaborative authoring conversation
```

推荐：

```text
user
  -> direct Promptpile streaming completion
  -> visible assistant delta
  -> persist visible assistant response
```

而在 `/submit` 时再执行结构化生成：

```text
conversation
  -> submit-specific system prompt
  -> structured submission JSON
  -> Core2 validate
  -> publish
```

这样仍然保持 Core2 对最终 World mutation 的 authority。

### 8.3 Play 才是完整 ReAct 更合理的使用场景

Play 需要：

```text
user action
  -> reasoning
  -> observation/tool/world state
  -> check
  -> final narration
```

因此 ReAct 更适合作为 Play 的 agent runtime，而不是所有 Session 的统一 conversational runtime。

---

## 9. Init prompt 需要增加明确 phase boundary

Init 应被明确定义为：

```text
AUTHORING ROOM
```

建议语义约束：

- 你的任务是与用户共同设计 World，而不是在 World 中行动。
- 不得推进世界时间。
- 不得开始 Day 1。
- 不得让角色实际经历正式剧情事件。
- 不得以 NPC 身份与用户进行世界内角色扮演。
- 可以提出候选人物、地点、冲突与故事种子，但必须明确它们仍处于设计阶段。
- 示例必须保持 hypothetical/candidate 状态，不能自动成为已发生事实。
- 只有用户显式执行 `/submit` 才表示初始化结束。
- AI 不拥有自行判断“世界已经准备好并开始剧情”的权限。

最关键的业务约束是：

> **Init Session 的结束权属于用户的 `/submit`，不属于模型。**

---

## 10. Canon 扩展建议

如果 Init 的产品目标确实包括世界、人物和未来故事基础，建议至少为这些内容提供正式位置，例如：

```text
canon/
  premise.md
  setting.md
  rules.md
  style.md
  user-role.md
  characters.md
  relationships.md
  locations.md
  story-seeds.md
```

这里不要求全部改为复杂 JSON。

继续使用 document-native Markdown Canon 也可以，只要明确哪些内容属于 Published World authority。

`story-seeds.md` 应保存潜在可能性，而不是已发生事件，例如：

```text
- 城西旧城区近期存在异常停电现象。
- 某主要人物可能隐瞒与一个组织的关系。
- 用户所在机构存在一项尚未公开的内部冲突。
```

这些应被视为 latent possibilities，之后由 Planning / Play 决定是否实际进入事件历史。

---

## 11. 推荐修复顺序

### P0 — 阻止 hidden Thought 写入 authoritative Conversation

必须优先处理。

可选实现方向：

- 修改 Promptpile-ReAct，使 Thought 不因 `continueMode` 自动带 `-c`；或
- 为 Thought 指定独立 scratch output directory；或
- Dayloom 不再用同一个 continue conversation 承载内部 ReAct phase。

需要保证最终 invariant：

```text
Conversation 中只存在用户真实输入和用户真实看到的 assistant 输出。
```

### P1 — Init / Planning / Revise 的普通 send 改为 direct streaming completion

减少无意义的 Thought/Observe/Check latency，同时避免 agent execution bias。

`submit()` 继续单独走结构化生成与 Core2 validation。

### P2 — 强化 Init authoring contract

加入明确的 simulation 禁止项，并规定只有 `/submit` 可以结束 Init。

### P3 — 扩展 Canon 对人物、关系、地点、冲突和 story seeds 的表达能力

否则模型无法把这些内容稳定落入正式 World authority。

### P4 — 补充 regression tests

见下一节。

---

## 12. 需要补充的测试

### 12.1 真正的多轮 streaming test

目前测试更多是在证明“存在 `output.delta` event”，而不是证明真正的持续流式。

建议至少测试同一个 Session 的三轮输入：

```text
send #1 -> delta A -> delta B -> delta C
send #2 -> delta A -> delta B -> delta C
send #3 -> delta A -> delta B -> delta C
```

关键断言：

1. 每轮都能收到多个 delta。
2. 第一个 delta 必须发生在 `core.send()` Promise resolve 之前。
3. 第二轮及以后不能退化为仅在 completion 结束时一次性收到完整内容。

### 12.2 Conversation purity test

执行：

```text
user -> send -> visible final
user -> send -> visible final
```

然后直接 inspect conversation directory。

期望：

```text
user
assistant-visible
user
assistant-visible
```

不得出现：

```text
assistant-hidden-thought
observe/check artifact as conversational turn
```

### 12.3 Init phase-boundary test

给模型足够完整的世界设定输入，并明确仍在 Init Session。

验证普通 `send()` 输出不得：

- 开始 Day 1；
- 描述已发生正式事件；
- 进入 NPC 角色扮演；
- 自动宣告初始化完成。

只有 `/submit` 才能结束 Init。

### 12.4 Compression purity test

构造足够长的 Init Conversation 触发 semantic summary。

验证 summary 只能总结：

- 用户真实选择；
- 可见 assistant 对话中的确认内容；

不得包含任何内部 Thought / Observe / Check 的 reasoning 或 next action。

---

## 13. 相关源码位置

Dayloom：

- `packages/core2/src/core.ts`
- `packages/core2/src/promptpile/react-runner.ts`
- `packages/core2/src/promptpile/conversation.ts`
- `packages/core2/src/promptpile/config.ts`
- `packages/core2/src/promptpile/compression.ts`
- `packages/core2/src/session/common.ts`
- `packages/core2/src/session/lifecycle.ts`
- `packages/tui/src/runtime-driver/driver.ts`
- `packages/tui/src/view-model.ts`
- `packages/tui/src/components/message-list.tsx`
- `packages/core2/test/completion.test.js`
- `packages/core2/test/helpers.js`

Promptpile：

- `packages/promptpile-react/src/react-runtime.ts`
- `packages/promptpile-react/src/react-processes.ts`
- `packages/promptpile-react/src/build-phase-argv.ts`
- `packages/promptpile-react/src/default-react-prompts.ts`
- `packages/promptpile-react/src/promptpile-invoker.ts`
- `packages/promptpile-react/src/react-event-writer.ts`
- `packages/promptpile/src/index.ts`
- `packages/promptpile/src/ai-client.ts`
- `packages/promptpile/src/output-pile.ts`

---

## 14. 当前判断

目前不建议优先修改 TUI rendering 层。

TUI 对 `output.delta` 的消费逻辑本身符合流式设计。更值得优先修复的是：

```text
1. ReAct hidden phases 的 Conversation 隔离
2. 普通 authoring Session 不必要的 ReAct 调用
3. Init 的 Authoring / Simulation 边界
4. Canon 对人物与故事基础的表达能力
```

其中第 1 项属于正确性问题，第 2 项同时影响 latency 和 UX，第 3、4 项决定 Init Session 是否真正符合 Dayloom 的产品语义。
