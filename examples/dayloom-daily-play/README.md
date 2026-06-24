# dayloom daily + play example

这个示例通过真实 AI + MCP 连续测试两个命令：

1. `daily`：从已有 World 制定当天初步计划。
2. `play`：逐个生成、互动、结算事件，并根据结果修订后续计划。

它不会初始化 World。请先在相邻示例中创建源 World：

```bash
cd ../dayloom-init-revise
./run-interactive.sh
```

源 World：

```text
../dayloom-init-revise/output/world-interactive
```

测试 World：

```text
output/world-daily-interactive
```

首次运行 daily 时会复制源 World，后续 play 只修改这份测试副本。

## Prerequisites

- Node.js
- `DEEPSEEK_API_KEY`
- 可用的 `promptpile-mcp`，或由脚本构建仓库内版本
- filesystem MCP，首次运行会安装到本示例的 `.runtime/`

复制 `.env.example` 为 `.env`：

```text
DEEPSEEK_API_KEY=sk-...
```

也可以配置外部 MCP 网关：

```text
PROMPTPILE_MCP_BASE_URL=http://127.0.0.1:8765
PROMPTPILE_MCP_TOKEN=...
```

## 1. Generate Daily Plan

macOS/Linux：

```bash
./run-interactive.sh
```

Windows：

```bat
run-interactive.bat
```

进入 daily 后可多轮问答。输入 `/start` 并确认后生成 `plan.initial.json`，脚本随后运行 `scripts/verify-daily.js`。

如果测试 World 已经是 `planned` 或 `playing`，不需要删除它，直接进入 play。

## 2. Play Events

macOS/Linux：

```bash
./run-play-interactive.sh
```

Windows：

```bat
run-play-interactive.bat
```

play 会从 `planned` 初始化执行状态，也能从 `playing` 恢复。事件内可输入多行自由行动：

- macOS/Linux：空行处按 `Ctrl+D` 提交
- Windows：`Ctrl+Z` 后 Enter 提交
- 输入 `/status` 查看当前事件
- 输入 `/end-day` 立即结束当天并进入结算
- 输入 `/exit` 保存进度并退出

退出或完成后，脚本运行 `scripts/verify-play.js`。验证器接受：

- `playing`：事件尚未全部完成，可以再次运行 play 脚本继续
- `settling`：所有 beat 已完成或取消，等待日终结算

## Reset

需要从 daily 重新测试时删除测试副本：

```bash
rm -rf output/world-daily-interactive
```

Windows：

```bat
rmdir /s /q output\world-daily-interactive
```

然后重新运行 daily 脚本。

## Verification

`verify-daily.js` 检查初步计划、阶段和规划期不应产生的结果文件。

`verify-play.js` 检查：

- `plan.current.json`、`play.state.json`、`runtime.state.json`
- 至少一个 `event_NNN/event.json` 和非空 transcript
- 事件生成阶段没有预写 outcome/result/reward
- 已结算事件具有 result、state patch、replan 及 applied 标记
- active event 与状态文件一致
- `settling` 时不存在 pending/active beat
- 已完成事件具有 `event_resolved` 状态日志

## 3. Settle The Completed Day

默认调用 AI 读取当天计划、事件结果和有限的对话尾部，只生成客观摘要、主角日记、次日局势概述和行动建议：

```bash
./run-settle-interactive.sh
```

程序负责生成 `version`、`day`、安全的短期记忆补丁和已有未解决线索。默认仅把完整草稿写入：

```text
days/day_NNNN/ending/settlement.proposal.json
```

审阅后提交：

```bash
./run-settle-interactive.sh \
  --proposal output/world-daily-interactive/days/day_0001/ending/settlement.proposal.json \
  --yes
```

也可以让 AI 生成后直接提交：

```bash
./run-settle-interactive.sh --yes
```

需要纯手工 proposal 时仍可编辑 `settlement.proposal.example.json`。提交成功后，当前天生成 `summary.md` 和 `ending/` 产物，世界推进到下一天的 `idle`，随后再次运行 `./run-interactive.sh`。

### Natural-language Daily Controls

Daily planning now routes each normal user message through a separate intent classifier. You can say “开始执行计划”、“让我看看当前计划”、“取消今天的计划”或“先保存退出” directly. The classifier cannot access World tools and never writes files; starting or cancelling still requires confirmation. Slash commands remain available as a debugging fallback.
