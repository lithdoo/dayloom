# prompts

day-loom **运行时提示词**与**存档协议**目录（路径相对本包根目录 `packages/day-loom/`）。

| 文件 / 目录 | 用途 |
|-------------|------|
| [`spec.md`](./spec.md) | World 按天存档规范（协议定义） |
| `*.system.md` | 各 AI 模块的 system 提示词 |

CLI / orchestrator 调用 promptpile 等 LLM 阶段时从此处加载模板。存档内 `canon/`、`days/` 等**不**存放通用提示词；世界设定与用户输入仍在 World 存档中。

## 文件约定

| 文件 | AI 模块 | 阶段 |
|------|---------|------|
| `day-planner.system.md` | Day Planner | 根据今日计划生成 `day_outline.yaml` |
| `event-runner.system.md` | Event Runner | 执行单个事件：场景、对话、选项 |
| `dialogue.system.md` | Dialogue Engine | 生成符合人物性格的对话 |
| `choice.system.md` | Choice Engine | 生成行为分支与自定义输入入口 |
| `state-resolver.system.md` | State Resolver | 根据用户行为生成结果与 `state_patch.yaml` |
| `diary-writer.system.md` | Diary Writer | 生成 `ending/diary.md` |
| `day-summarizer.system.md` | Day Summarizer | 生成根级 `summary.md`（结算必填） |
| `memory-updater.system.md` | Memory Updater | 更新 `memory/` 与实体派生记忆 |
| `next-day-seeder.system.md` | Next Day Seeder | 生成 `next_day_seed.yaml` |
| `play-event-generator.system.md` | Play Event Generator | 从当前可执行 beat 生成单个未决事件 |
| `play-event-dialogue.system.md` | Play Event Dialogue | 推进事件内多轮互动并判断是否解决 |
| `play-event-resolver.system.md` | Play Event Resolver | 从完整 transcript 生成事件结果和运行时补丁 |
| `play-replanner.system.md` | Play Replanner | 根据事件结果修订后续 beat |
| `init-interviewer.system.md` | Init 访谈 | 交互式 init 多轮追问 |
| `init-finalize.system.md` | Init 定稿 | 根据 transcript 生成存档 JSON |

- 扩展名 **`.md`**；文件名 `{模块}.system.md` 表示默认 **system** 角色提示词。
- 若某阶段需要独立 user 模板，可增加 `{模块}.user.md`。
- 模板内占位符与注入规则待 runtime 实现时在代码与本 README 中补全。

## 参考

- 按天存档规范：[`spec.md`](./spec.md) §10
- 项目总设计：[`README.md`](../README.md) §10
