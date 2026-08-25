# Dayloom ReAct Thought 发散与 Final 事实漂移问题报告

> 修复状态：已在当前工作树落地，尚未提交。本报告第 4–7 节保留修复前实现的证据链，第 11 节记录实际修复结果。

## 1. 结论

当前问题不是 Final 单阶段措辞不佳，而是 `Thought -> Observe -> Check -> Final` 之间缺少“来源与确认状态”约束，叠加 ReAct 步数由 1 提升到 10 后形成的系统性语义回归。

最关键的实现缺口是：设计稿已经规定了 Dayloom 专用的 Check 早停条件，但 Core 没有生成或配置 `check_prompt`。运行时因此回退到 `promptpile-react` 的通用 Check，只根据 Observe 报告自由判断是否继续。对于没有检索工具的 Init Session，继续循环不会获得任何新的权威证据，只会让模型反复扩写自己的候选内容。

在多轮内部循环中，Thought 输出会被持久化到 ReAct 私有工作 Conversation，随后又作为 Observe 输入和下一轮 Thought 输入。Observe 合同虽然区分了“权威事实、决定、未解决项”，却没有要求为每项标注来源，也没有禁止把 Thought 生成的候选内容归入 `[DECISIONS]`。一旦 Observe 把模型提议错误地归类为“决定”，Final 的现有约束就会接受这份交接，最终出现类似以下错误表述：

> “我们刚刚把所有核心设定都敲定了，包括标题、反派动机和女主角的结局。”

这是一条“模型候选内容 -> 内部 Conversation -> Observe 决定 -> Final 既成事实”的来源漂白路径。

## 2. 影响范围与严重性

- 严重性：高。
- 直接影响：普通 `send()` 的用户可见回复偏离最新用户问题，自行推进或补全情节，并把未确认提议表述为已确认事实。
- 最明显场景：Init Session。Init 没有 Archive Retrieval 工具，多步循环不可能增加权威证据。
- 潜在影响：Planning、Play、Revise 同样共享 Observe、Check 和 Final 机制；当检索已经充分、被阻塞，或真正需要用户澄清时，也可能继续自循环并放大模型生成内容。
- 数据安全边界：普通 `send()` 不会直接发布 World，Core 的提交校验仍在；但错误回复会进入可写 Conversation，影响后续轮次，并可能在用户最终 `submit()` 时进入候选 Submission。

## 3. 用户可见症状

典型症状包括：

1. 用户只提出一个局部问题或给出一个简短偏好，Thought 却自行补齐人物、反派、结局等未询问内容。
2. Final 不直接回答最新问题，而是总结一套模型自己扩写的世界设定。
3. Final 使用“已经敲定”“都确认了”“世界文档已完整成型”等完成态语言。
4. Final 主动给出“开始正文、继续细化、调整设定”等下一阶段菜单，仿佛当前设计任务已经完成。
5. 用户没有明确确认的内容，在后续对话中逐渐被当成历史决定。

## 4. 实际运行链路

```text
用户消息
  -> 写入 Dayloom 可写 Conversation
  -> Thought 读取权威层 + 可写 Conversation + ReAct 私有工作 Conversation
  -> Thought 输出写入 ReAct 私有工作 Conversation
  -> Observe 读取权威层 + 可写 Conversation + 全部私有 Thought 工作
  -> Observe 生成唯一 Final handoff
  -> 通用 Check 只看 Observe，自由决定是否继续
       -> true：再次执行 Thought，读取此前自己的输出并继续扩写
       -> false / 达到 10 步：进入 Final
  -> Final 不读取原始 Thought，但读取原始权威 Conversation + 最新 Observe handoff
  -> Final 回复写回 Dayloom 可写 Conversation
```

这套隔离拓扑成功阻止了 Final 直接读取隐藏 Thought，但没有阻止 Observe 把 Thought 内容重新包装后交给 Final。隔离解决了“可见性”问题，没有解决“来源可信度”问题。

## 5. 代码证据

### 5.1 步数从 1 提升到 10，放大了内部自循环

`packages/core/src/promptpile/react-runner.ts:38` 固定：

```ts
const REACT_MAX_STEPS = 10;
```

同文件的 `baseArgs()` 将该值作为 `--max-step 10` 传给 Promptpile React。上一提交版本使用的是 `REACT_MAX_STEPS = 1`。单步时期即使语义约束较弱，模型也只有一次 Thought；当前最多可以执行十次 Thought/Observe/Check。

`SESSION_ARCHIVE_RETRIEVAL_MCP_DRAFT.md` 第 11.1 节明确说明 10 是安全上限而不是目标，简单或无检索场景预期只运行 1–2 步。因此问题不在“10”这个硬上限本身，而在早停机制没有按设计落地。

### 5.2 设计规定了专用 Check 语义，实现没有配置 `check_prompt`

设计稿第 11.2 节要求 Check 仅在以下条件全部成立时继续：

1. 仍有实质问题未解决；
2. 当前可用检索可能回答该问题；
3. 答案会实质提升 Final 或 Submission 的正确性。

并要求在证据充分、需要用户澄清、检索阻塞或只能重复确认时停止。

但 `packages/core/src/promptpile/config.ts:48-49` 只派生：

- `thought_prompt`
- `observe_prompt`
- `final_prompt`

没有写入 `check_prompt`，Session 工作区也没有创建 Dayloom Check prompt 文件。

`promptpile-react` 本身支持 `[promptpile-react].check_prompt`；未配置时，`load-react-prompts.js` 回退到 `DEFAULT_REACT_CHECK`。默认 Check 只要求模型根据 Observe 报告判断是否继续，并未包含 Dayloom 的三项继续条件、用户澄清边界或“优先停止”规则。

这是设计与实现之间的直接缺口，也是把步数提升到 10 后出现行为回归的主因。

### 5.3 Thought 输出会成为后续内部轮次的输入

`promptpile-react/dist/build-phase-argv.js:39-44` 对 Thought 使用：

```text
directories = authoritativeReadLayersAbs
outputDirectory = session.conversationWorkAbs
continueMode = true
```

Promptpile 会把 `outputDirectory` 同时加入输入层，因此第一轮 Thought 的 assistant 输出会保存在私有工作 Conversation，并在后续 Thought 中再次出现。

`build-phase-argv.js:46-50` 对 Observe 使用“权威读取层 + `conversationWorkAbs`”，所以 Observe 必然能够看到当前 ReAct run 中所有 Thought 产物。

这个机制对多步工具调用是合理的，但如果没有严格的来源标签，它也允许模型把自己的上一轮假设当成下一轮已有上下文继续发展。

### 5.4 Init Thought 的目标宽泛，未明确保护用户决策权

`packages/core/src/session/prompts/init.ts:2` 要求模型帮助建立完整 World，包括标题、canon、状态、角色关系、地点、长线剧情、事实、未解决线索和故事种子。

该 prompt 禁止伪造既有历史、推进时间或开始 Day 1，也声明模型输出只是候选；但没有明确规定：

- 只能扩展用户明确要求扩展的部分；
- 不得替用户决定关键设定；
- 模型提议在用户明确确认前必须保持为 proposal；
- 用户未反对不等于确认；
- 当缺少用户选择时，应停止内部循环并让 Final 提问。

对创作模型而言，“建立一个 rich new World”与“converge on one coherent authored World”会自然诱导其补全缺失部分。现有负面约束只保护“不能假装已有已发布世界”，没有保护“不能假装用户已经选择了模型刚生成的候选设定”。

### 5.5 Observe 合同没有保留来源和确认状态

`packages/core/src/session/prompts/observe.ts` 要求输出：

```text
[AUTHORITATIVE_FACTS]
[DECISIONS]
[UNRESOLVED]
...
```

但没有要求 `[DECISIONS]` 中每项必须来自明确的用户确认、固定 Published World 或有路径的检索证据，也没有单独保存 `[MODEL_PROPOSALS]`。它还使用“Carry ... decisions”这种表述，却没有定义什么才算 decision。

因此 Observe 可能把 Thought 刚生成的反派动机、角色结局等候选内容放进 `[DECISIONS]`，并把 `[UNRESOLVED]` 写成 `<none>`。这一步造成了语义上的来源漂白。

当前语义摘要 `SUMMARY_SYSTEM_PROMPT` 反而要求 `sourceTurnIndices`，说明项目已经认识到跨轮记忆需要来源约束；但更关键的 ReAct Observe handoff 没有同等的来源要求。

### 5.6 Check 只能看到 Observe，无法自行纠正错误归类

`promptpile-react/dist/react-runtime.js:110` 将 `observeText` 交给 Check；Check 使用隔离目录，不读取原始用户 Conversation、Published World 或 Thought 工作目录。

这种设计要求 Observe 必须是可信、完整、带来源的状态投影。当前 Observe 一旦把模型候选错标为决定，Check 没有原始证据可用于复核，只能在错误摘要上继续判断。

对于 Init，Observe 还被统一要求提供 `[RETRIEVAL_STATUS]` 和 `[NEXT_RETRIEVAL]`，但 Init 实际 `tools = []`。共享的检索导向合同没有显式告诉 Observe“本 Session 无检索能力，不能通过继续循环解决不确定性”。

### 5.7 Final 只约束“未解决值”和“已发布”，没有约束“用户已确认”

`packages/core/src/session/prompts/final.ts` 当前只要求：

- 从权威上下文和最新 Observe handoff 渲染；
- 不要发明被标记为 unresolved 的值；
- 不要把检索错误当事实；
- 不要声称 Core 已经发布候选输出。

如果 Observe 已经把臆造内容写入 `[DECISIONS]` 并清空 `[UNRESOLVED]`，上述约束不会阻止 Final 使用它们。

`packages/core/src/session/lifecycle.ts:13-19` 的 Init ordinary-send Final 要求自然协作、提问或总结待确认选择，并禁止声称 World 已发布；但没有要求“优先直接回答最新用户问题”，也没有禁止以下较弱但同样误导的说法：

- “所有核心设定都敲定了”；
- “世界文档已经完整成型”；
- “我们已经确认了角色结局”。

Play 的 ordinary-send Final 明确写了“for the latest user turn”，而 Init、Planning、Revise 没有同等强度的最新用户回合锚定，行为因此更容易转向阶段总结或自主推进。

### 5.8 Final handoff 强化了错误 Observe 的影响

`promptpile-react/dist/final-observation-handoff.js:20` 明确要求 Final 使用“authoritative conversation and this report”回答原始请求。`react-runtime.js` 只传递 `latestSuccessfulObserve`。

因此最后一次 Observe 是 Final 的唯一内部工作交接。一旦它发生来源漂白，Final 不会看到更早 Observe，也不会看到 raw Thought，更无法判断某项“决定”其实只是模型内部提议。

## 6. 根因分级

### 主根因 P0：Dayloom Check 早停策略未落地

只提升了最大步数，没有实现设计稿要求的 Check prompt 和可验证继续条件。无检索或需要用户澄清时仍可能继续内部循环。

### 主根因 P0：Observe 缺少来源/确认状态模型

Thought 产物、用户明确选择、Published World 事实和检索结果在 Observe 中没有强制 provenance 区分，模型候选可以被归入 `[DECISIONS]`。

### 次根因 P1：Thought 缺少用户决策权约束

角色目标鼓励丰富和收敛，但没有定义“提议”和“确认”的边界，尤其容易诱发创作型发散。

### 次根因 P1：ordinary-send Final 缺少最新问题和确认态约束

Final 防止“声称发布”，但没有防止“声称用户已确认”或“声称设计已完整”。Init/Planning/Revise 也没有像 Play 一样明确锚定 latest user turn。

### 放大因素 P1：Init 与检索型 Session 共用同一多步 Observe 合同

Init 没有工具，多步执行不产生新证据；共享的 `[RETRIEVAL_STATUS]` / `[NEXT_RETRIEVAL]` 语义却没有显式表达这一点。

### 测试缺口 P1：现有测试验证协议，不验证语义闭环

`react-beta5-e2e.test.js` 已验证：

- Thought 不直接泄漏给 Final；
- Observe handoff 能到达 Final；
- 10 步上限和 `max_step` 协议一致；
- 多阶段事件顺序正确。

但 mock provider 直接返回预制 Observe/Check/Final，未覆盖：

- 普通对话是否回答最新用户问题；
- Thought 自创内容是否被 Observe 错标为决定；
- 用户未确认时 `[UNRESOLVED]` 是否保留；
- Init 无工具时，Check 是否按通用早停规则拒绝无实质进展的继续请求；
- `needs-more` 但需要用户澄清时是否停止；
- Final 是否禁止“已敲定/已完成”类无依据声明。

`boundaries.test.js` 只断言 Observe section 名存在，没有断言来源规则或 Dayloom `check_prompt` 已派生。

## 7. 为什么该问题在本次改造后更明显

本次提交同时发生了两项变化：

1. `REACT_MAX_STEPS` 从 1 提升到 10；
2. Thought/Observe/Final prompt 被重构为检索感知合同。

设计稿原本用严格 Check 早停作为 10 步上限的配套条件，但实现遗漏了 `check_prompt`。结果是“允许多步”已经生效，“仅在可通过检索取得实质进展时继续”没有生效。

在旧的单步模式中，模型最多生成一次候选 Thought，Observe 随后交给 Final；现在候选 Thought 可以多轮读回并自我强化。Prompt 重构本身还增加了 `[DECISIONS]` 这一强语义容器，却没有为其增加来源验证，所以最终表现为更明显的“自说自话”和“虚假完成态”。

## 8. 建议修复方案

### 阶段 A：补齐 Check 早停闭环（P0）

1. 新增 Core-owned `DAYLOOM_CHECK_PROMPT`。
2. 在 Session workspace 生成 `react/check.md`。
3. 在派生 TOML 中显式写入 `check_prompt`。
4. Check 仅允许在以下条件全部成立时返回 `true`：
   - `[RETRIEVAL_STATUS]` 为 `needs-more`；
   - `[NEXT_RETRIEVAL]` 是具体、可执行、非重复的检索动作；
   - 当前 Session 确实具备检索工具；
   - 不确定性可由检索而不是用户澄清解决；
   - 新证据会实质改变 Final/Submission 正确性。
5. `sufficient`、`blocked`、需要用户选择、无工具、仅能继续创作/推演时必须返回 `false`。

所有 Session 继续统一使用 `--max-step 10` 作为硬上限，不对 Init 做步数特判。Init 没有检索能力时，应由同一套 Check 语义得出 `continue=false`：需要用户选择就交给 Final 澄清，继续创作或自我推演不属于可取得新权威证据的合法继续理由。

### 阶段 B：给 Observe 增加来源与确认状态（P0）

在不改变现有 section 顺序的前提下强化内容合同：

- `[AUTHORITATIVE_FACTS]` 每项必须标记来源：`published:<path>`、`retrieval:<path/range>` 或 `user:<turn>`。
- `[DECISIONS]` 只允许记录用户明确确认或 Published World 已固定的决定。
- Thought/assistant 本轮生成内容必须标记为 `model-proposal`，不得进入已确认决定。
- 用户未明确接受的提议必须进入 `[UNRESOLVED]`，并标明“awaiting user confirmation”。
- 缺少来源的内容不得用于 Final 的事实陈述。
- Init 的 `[RETRIEVAL_STATUS]` 固定表达为无检索需求/能力，不得用继续 Thought 代替用户澄清。

如果允许升级 Observe schema，最好新增显式 `[MODEL_PROPOSALS]` 或结构化 provenance；如果必须保持设计稿冻结 section，则在 `[DECISIONS]` 和 `[UNRESOLVED]` 内使用强制标签。

### 阶段 C：收紧 Thought 和 ordinary-send Final（P1）

Thought 增加：

- 只处理最新用户回合实际提出的问题或授权的创作范围；
- 可以提出候选，但不得替用户选择关键设定；
- 未被用户明确确认的 assistant 提议始终是 proposal；
- 用户沉默、转移话题或未反对不构成确认；
- 当下一步需要用户选择时停止推演，把澄清需求交给 Final；
- 不得为了“让 World 完整”而填补用户未要求的字段。

ordinary-send Final 增加：

- 第一职责是直接回答 latest user turn；
- 仅总结与该问题直接相关、且有来源的已确认内容；
- 模型候选必须用“可以考虑/一个选项是”等提议态表述；
- 没有明确证据时禁止使用“已敲定、已确认、已完整、已成型、都决定了”等完成态措辞；
- 不主动宣告阶段完成或引导进入下一生命周期；
- 需要用户选择时只提出聚焦问题，不继续内部创作。

### 阶段 D：增加确定性运行时防线（P1）

仅靠 prompt 无法形成强闭环。建议 Core 在 Process Pile reducer 中累计最新 Observe 文本，并在接受 `check continue=true` 前验证：

- 状态确为 `needs-more`；
- `NEXT_RETRIEVAL` 非空；
- Session 具有 retrieval binding；
- 下一动作不是与此前相同的重复检索。

不满足时可强制停止或按协议失败关闭。该 guard 应依据 Observe 状态、下一检索动作和实际 retrieval binding 统一判断，不依据 Session 类型或单独修改 Init 的最大步数。

还可以在 Final 前验证 Observe section 完整性和来源标签，避免只靠模型遵循文本格式。

### 阶段 E：补测试与文档一致性（P1）

新增以下确定性测试：

1. 派生配置必须包含 `check_prompt`，且内容包含三项继续条件和用户澄清停止条件。
2. 所有 Session 均保持 `--max-step 10`；Init 无工具且没有可取得新证据的动作时，Check 必须按通用规则返回停止，非法继续应被 guard 拒绝。
3. Observe 中 assistant/Thought 生成的候选不得被标成 user-confirmed decision。
4. 用户只说“科幻”时，Final 不得声称标题、反派、结局已经确定。
5. 用户问局部问题时，Final 必须锚定 latest user turn，不得输出阶段完成菜单。
6. `blocked`、`sufficient`、需要用户澄清、`NEXT_RETRIEVAL=<none>` 均不得继续。
7. 只有 `needs-more + concrete retrieval + retrieval available` 才允许多步。
8. 多步检索仍保持现有最大 10 步、ToolCall 闭环、Final guard 与 Process Pile 顺序测试。

同时更新 `doc/contracts/CORE_RUNTIME_V1.md`：该文档仍写 `--max-step 1`，与当前实现和设计稿的 10 不一致。这不是本次行为问题的直接原因，但会干扰后续审查和回归判断。

## 9. 建议验收标准

修复完成后应满足：

- 所有 Session 保持统一的 10 步硬上限；Init ordinary send 在无工具且需要用户选择时通过 Check 自然早停，而非通过专用步数限制。
- 模型自己生成但用户未确认的设定不会出现在 `[DECISIONS]`。
- Final 能区分 published fact、user-confirmed decision、retrieval evidence、model proposal 和 unresolved choice。
- Final 对最新用户问题给出直接响应，不自行宣布设计完成或进入下一生命周期。
- 任何“已确认/已敲定/已完整”陈述都能追溯到明确用户回合或 Published World 证据。
- Planning/Play/Revise 只有在下一次具体检索能增加实质证据时才进入下一步。
- 10 步仍只是异常复杂检索的硬上限，普通无检索请求稳定在 1 步，常规检索稳定在 2–4 步。
- 普通 `send()` 产生的 assistant 回复不会把未确认模型提议写成后续 Conversation 的稳定事实。

## 10. 最小修复优先级

如果只安排一个最小闭环版本，建议按以下顺序：

1. 实现并接入 Dayloom `check_prompt`，统一按“是否能取得实质新证据”决定继续或停止。
2. Observe 强制来源标签，禁止 model proposal 进入 `[DECISIONS]`。
3. ordinary-send Final 强制回答 latest user turn，并禁止无来源完成态声明。
4. 添加上述回归测试。

只修改 Final 文案不足以解决问题，因为错误事实在进入 Final 前已经由 Observe 完成了来源漂白；只把最大步数改回 1 也只是降低发生概率，无法修复 Thought 候选被 Observe 当成决定的根本缺陷。

## 11. 实际修复结果

当前工作树已经完成以下闭环，并保持所有 Session 统一使用 `--max-step 10`：

1. 新增 Core-owned `prompts/check.ts`，将设计稿的五项继续条件和停止条件写入 Dayloom Check prompt。
2. Session workspace 生成 `react/check.md`，派生 TOML 显式配置 `check_prompt`，不再回退到 Promptpile React 通用 Check。
3. Observe prompt 按 Session 实际能力写入 `retrieval_available=true|false`，强制区分 `user-confirmed`、`published:<path>`、`retrieval:<path/range>` 和 `model-proposal, awaiting-user-confirmation`。
4. Thought policy 明确限制 latest user turn 授权范围，禁止把模型提议、用户沉默或未反对解释为确认。
5. ordinary Final 强制直接回答 latest user turn，禁止无来源的“已确认、已完成、已成型”声明和未经请求的生命周期推进。
6. Core Process Pile reducer 增加统一 continuation policy：只有存在 retrieval binding、Observe 状态为 `needs-more`、下一动作命名一个具体 Archive 工具且不重复时，才接受 `continue=true`；否则失败关闭。
7. 补充派生配置、prompt 合同和 continuation policy 回归测试，并将稳定契约中的过期 `--max-step 1` 修正为统一 `--max-step 10`。
8. 后续将全部 Thought、Observe、Check、Final、Submission、摘要和 submit marker 提示词集中到 `packages/core/src/session/prompts/`，统一改为中文，并通过 `@dayloom/core/prompts` 单独导出。

验证结果：Core 122 项测试全部通过；monorepo build、Core architecture guard、docs check、examples check 和 Core package dry-run 均通过。完整临时消费者安装验证受第三方 `@rustmcp/rust-mcp-filesystem` GitHub 二进制下载阻塞，未出现与本次代码相关的构建或打包断言失败。
