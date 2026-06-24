# day-loom 设计计划

> 类似 SillyTavern 的「以天为单位」结构化角色扮演循环：用户输入今日意图 → AI 生成事件（对话与行为分支）→ 完成全部事件后结算 → AI 写日记并更新世界档案 → 进入下一天。

---

## 与 SillyTavern 的异同

| | SillyTavern | day-loom |
|---|---|---|
| 交互单元 | 单条消息，无限续聊 | **一天**为一个完整回合 |
| 结构 | 对话为主，分支靠 prompt / World Info | **事件队列 + 显式分支** |
| 记忆 | 聊天记录、Lorebook、向量检索 | **日记 + 结构化世界档案** |
| 推进 | 用户随时发消息 | **完成当日事件 → 结算 → 下一天** |

SillyTavern 的核心是「聊天体验 + 角色卡 + 世界书」；day-loom 的核心是 **「日程引擎 + 状态机 + 结算器」**。AI 是各阶段的生成器，而不是唯一的交互界面。

---

## 一天循环（状态机）

```text
[新的一天]
    ↓
planning     用户输入「今天要做什么」
    ↓
generating   AI 生成当日事件图（含对话、行为、分支）
    ↓
playing      逐个事件：展示 → 用户选择/输入 → 记录结果
    ↓
closing      所有事件完成
    ↓
settling     AI 生成日记 + 更新人物/场景/事件档案
    ↓
advance      day++，进入下一天
```

每个阶段都应有明确 **输入 / 输出 / 是否可回退**，避免「一整段 prompt 让模型自己跑完一天」导致失控。

---

## 数据分层

将「玩的过程」与「长期记忆」分开存储。

### 1. 世界档案（跨天、低频变更）

类似 SillyTavern 的 Character + World Info，使用 JSON 便于程序读写：

```text
world/
  meta.json          # 当前第几天、时间线、风格设定
  characters.json    # 人物：性格、关系、当前状态
  scenes.json        # 场景：地点、氛围、可用事件钩子
  timeline.json      # 已发生的重要事件摘要（不是全文）
```

可与仓库内 [`statelith`](../statelith/) 对齐：**固定 schema 的 JSON 状态文档**，便于校验、diff、watch。

### 2. 当日运行态（高频变更）

```text
days/042/
  plan.user.md           # 用户今日意图
  events.generated.json  # AI 生成的事件图
  events.state.json      # 当前进度：哪个事件、选了哪条分支
  play/                  # 每个事件的对话与选择记录
    evt-01/
      scene.md
      [0]assistant.md
      choices.json       # 可选分支及用户选择
  diary.draft.md         # 结算阶段产出
  settlement.patch.json  # 对世界档案的增量更新
```

### 3. 事件图结构（关键设计）

不要只存「一段故事文本」，要存 **可执行的事件图**，例如：

```json
{
  "day": 42,
  "events": [
    {
      "id": "evt-01",
      "title": "晨间咖啡",
      "scene": "cafe",
      "characters": ["alice"],
      "beats": [
        { "type": "narration", "text": "..." },
        { "type": "dialogue", "speaker": "alice", "text": "..." },
        {
          "type": "choice",
          "prompt": "你怎么回应？",
          "options": [
            { "id": "a", "label": "...", "effects": { "relationship.alice": 1 } },
            { "id": "b", "label": "...", "next": "evt-01b" }
          ]
        }
      ],
      "status": "pending"
    }
  ]
}
```

`status` 取值：`pending` | `active` | `done`。

**playing 阶段** 不必每次都让模型从零编故事：

- **generating**：一次性产出事件图
- **playing**：以读盘为主；用户选了意外选项时再局部调用 AI 补全

---

## AI 阶段拆分（建议 4 次调用）

全部塞进一次 prompt 容易失控；可对应 [`promptpile`](../../promptpile/packages/promptpile/) 的消息目录多轮调用：

| 阶段 | 任务 | 输入 | 输出 |
|------|------|------|------|
| **Plan** | 理解用户今日意图 | 世界摘要 + 用户 plan | 结构化 plan |
| **Generate** | 生成事件与分支 | plan + characters + scenes | `events.generated.json` |
| **Play**（可选多次） | 分支外即兴 | 当前 beat + 用户输入 | 局部对话/旁白 |
| **Settle** | 日终结算 | 当日 play 日志 + 世界档案 | 日记 + patch |

[`promptpile-react`](../../promptpile/packages/promptpile-react/) 的 thought → observe → check → final 模式，适合套在 **Generate** 和 **Settle**：

- Generate 后 check：事件是否可玩、分支是否闭合
- Settle 后 check：patch 是否符合 schema、有无自相矛盾

---

## 与仓库其它包的关系

不必在 day-loom 内重写 LLM 客户端：

| 包 | 职责 |
|----|------|
| **promptpile** | 各阶段 LLM 调用、消息落盘（`[idx]user.md` / `[idx]assistant.md`） |
| **promptpile-react**（或自写 orchestrator） | 驱动「生成 → 校验 → 结算」多步流程 |
| **statelith**（或 day-loom 内自建 schema） | 世界状态 JSON 的 parse / validate / watch |
| **hostra** + web-components | 将来 UI：事件卡片、分支按钮、日记阅读 |

**day-loom** 本身适合承担：

1. **领域模型**（Day、Event、Choice、WorldPatch）
2. **状态机**（day loop）
3. **prompt 模板与上下文拼装**（给 promptpile 喂什么）
4. **结算 merge 逻辑**（把 patch 写回 `world/`）

---

## 风险与约束

### 1. 分支爆炸

生成阶段限制：每个事件最多 N 个选择、分支深度、是否允许跳事件。避免模型编出玩不完的分支树。

### 2. 结算与世界更新要「增量」

Settle 不要重写整个 world，而是输出 patch，由程序 merge：

```json
{
  "characters.alice.mood": "tired",
  "timeline.append": [{ "day": 42, "summary": "..." }]
}
```

### 3. 日记 ≠ 聊天记录

日记是 **第三人称/第一人称叙述 + 情感总结**；原始 play 日志保留在 `days/042/play/`，日记是压缩后的「记忆层」。

### 4. 下一天的 plan

结算后可生成「明日建议」，或保留用户空白输入；与 SillyTavern 一样尊重用户主导。

### 5. 角色一致性

每次 Generate / Play 注入 **人物卡摘要 + 最近 3～7 天 timeline**，不要塞全文日记。

---

## 最小可行版本（MVP）

先做 CLI，不做 UI：

1. 用户输入 plan → 生成 3～5 个**线性**事件（暂不做复杂分支）
2. 终端展示事件，用户选 1 / 2 / 3
3. 全部完成后 → 生成日记 + 更新 `characters.json` 一项字段
4. `day++`，打印「进入第 N 天」

跑通后再加：分支图、局部即兴、hostra 窗口、多角色并行事件。

---

## 一句话定位

**day-loom = 以「天」为 tick 的 SillyTavern 式世界模拟器**：

- SillyTavern 管「怎么聊」
- day-loom 管「今天发生什么、怎么选、怎么记住、怎么进入明天」

---

## 后续可细化项

- [ ] 事件 JSON schema（正式版 + 校验规则）
- [ ] 四个阶段的 prompt 模板
- [ ] 目录结构 v1 与示例存档
- [ ] CLI 子命令：`plan` / `generate` / `play` / `settle` / `advance`
