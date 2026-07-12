# TODO：指令页（Hub）与对话页（Session）双页架构

> **状态**：待做（大改动，规格优先冻结）  
> **范围**：主要 `@dayloom/tui`（`main` / ViewModel / 组件）；core **MVP 可不改**  
> **约束**：独立跟踪；不修改既有 `TODO.md` / `packages/tui/TODO.md` 正文（可交叉引用）  
> **日期**：2026-07  
> **相关**：  
> - [`TODO-autofocus-input.md`](./TODO-autofocus-input.md)  
> - [`TODO-confirm-focus-chrome.md`](./TODO-confirm-focus-chrome.md)  
> - [`TODO-user-message-history.md`](./TODO-user-message-history.md)  
> - [`TODO-message-list-focus.md`](./TODO-message-list-focus.md)  
> - [`TODO-stick-to-bottom-scroll.md`](./TODO-stick-to-bottom-scroll.md)

---

## 0. 一句话

把「一个 Textarea 兼任指令台 + 对话」拆成 **指令页（Hub）** 与 **对话页（Session）**。  
执行与退出仍走 core 的 `runGameShell` 能力 / `SessionExit`；TUI 做呈现与外环编排。  
**大在产品层状态机，不是重写游戏引擎。**

---

## 1. 问题

### 1.1 逻辑上已有两层

```text
runGameShell（Shell 等待循环）
  ├─ /status /help     → io.write，留在 shell
  ├─ /next             → runShellNext → init|daily|play|settle 对话
  ├─ /revise           → runReviseInteractive 对话
  └─ /quit             → 结束 shell
```

Session 内已有 `/exit`、`/cancel`、`/save` 等，且可通过 `SessionExit.shell-command` 冒泡。

### 1.2 TUI 体验扁平

- Shell 与 Session 都走同一个 Textarea（`beginInput`）
- 用户分不清「选全局指令」还是「和 AI 对话」
- `/exit`（回 shell）与 `/quit`（退程序）语义不同，UI 未强化

---

## 2. 目标与非目标

### 2.1 目标

1. 启动后先进入 **Hub**：可选指令 + 短提示 + 推荐高亮  
2. 仅在需要多轮交互时进入 **Session 对话页**  
3. Session 用既有 `/exit`（等）回 Hub；Hub 用退出项 / `/quit` / Ctrl+C 离开应用  
4. **禁止** tui 写 phase / World 业务分支；选项与执行基于 core 公开能力  

### 2.2 非目标（MVP）

- 重写 init/daily/play/settle/revise 对话逻辑  
- 把 CLI 改成双页  
- Hub 内嵌完整聊天  
- 鼠标操作  

---

## 3. 退出语义（冻结）

| 命令 / 操作 | 层级 | 含义 |
|-------------|------|------|
| `/exit`、session 的 cancel/save 等 | Session | 结束**当前会话** → 回到 Hub |
| `/quit` 或 Hub「退出游戏」 | Shell / App | 结束 **dayloom-tui** |
| Ctrl+C | App | 与 quit 同类 |

对话页文案强调「退出会话 → 返回指令页」；Hub 强调「退出游戏」。

---

## 4. 页面模型

### 4.1 状态

```ts
type TuiPage = 'hub' | 'session';

// ViewModel（示意）
uiPage: Signal<TuiPage>;
hubSelection: Signal<number>;
```

约定：

```text
uiPage = 'session'  当正在 await interactive session（next/revise 等）
uiPage = 'hub'      shell 在等用户选下一步（含 /exit 归来）
```

### 4.2 Hub 布局

```text
┌ Header（World / phase / 推荐）────────────────┐
├ MessageList（status / 系统提示，可选）────────┤
├ HubPanel ─────────────────────────────────────┤
│  标题：指令                                    │
│  ○ 下一步 — 执行推荐（默认高亮）               │
│  ○ 状态 / 修订 / 帮助 / 退出游戏               │
│  提示：Enter 确认 · ↑↓ 选择                    │
└───────────────────────────────────────────────┘
  （MVP：无大 Textarea；二期可加「手动 /cmd」）
```

### 4.3 Session 布局

```text
┌ Header ───────────────────────────────────────┐
├ MessageList（对话主舞台）─────────────────────┤
├ LoadingBar ───────────────────────────────────┤
├ Textarea + multiline hint ────────────────────┤
│  Footer：会话中 · /exit 返回指令页 · Ctrl+Enter │
└───────────────────────────────────────────────┘
```

### 4.4 动作 → 页面

| 动作 | 页面 | 行为 |
|------|------|------|
| status | 留 Hub | `formatNextStatus` → `io.write` |
| help | 留 Hub | 写帮助 |
| next（interactive） | → Session | `runShellNext` / `runRecommendedAction` |
| next（quick init 无对话） | 可留 Hub | 写结果即可 |
| revise | → Session | `runReviseInteractive` |
| quit | 退出 app | `dispose` + exit |

settle 大量 confirm 仍算 **Session 页**（confirm 叠在其上）。

---

## 5. Hub 选项表

### 5.1 数据来源（硬约束）

```text
inspectNextState(worldDir)   → action
describeNextAction(state, t) → 推荐说明
SHELL_WAIT_COMMANDS          → 指令目录
inspectTuiHeader             → Header（已有）
```

**禁止** tui 直接读 yaml 判断 phase。

### 5.2 固定 id → 执行映射

| id | 标签（示意） | 说明 | 执行 |
|----|--------------|------|------|
| `next` | 下一步 | `describeNextAction` | 等价 `/next` |
| `status` | 状态 | 固定摘要 | 等价 `/status` |
| `revise` | 修订 | 固定摘要 | 等价 `/revise` |
| `help` | 帮助 | 固定 | 等价 `/help` |
| `quit` | 退出游戏 | 固定 | 等价 `/quit` |

默认选中：`next`。

### 5.3 交互

- ↑↓ + Enter（可选数字键）  
- 控件：`@bindtty/widgets` `Select` 或自研 focusable 列表  
- 二期：Footer「手动输入 /」展开 Textarea  

---

## 6. 实现策略

### 6.1 MVP 推荐：方案 B — tui 自管外环

```text
main / runTuiGameShell:
  while (true) {
    uiPage = hub
    refreshHeader()
    selection = await waitHubSelection()
    if quit → break
    if status/help → io.write; continue
    if next → uiPage=session; await runShellNext(ctx); finally hub
    if revise → uiPage=session; await handleShellCommand(revise); finally hub
  }
```

- 复用 core：`runShellNext`、`handleShellCommand`、`inspectNextState` 等  
- CLI 继续用现有 `runGameShell`  
- tui 增加 `runTuiGameShell`（或同等），**不**在 tui 复制 phase 分支  

### 6.2 备选：方案 A — 包装 `readInput` 注入命令

Hub 选中后把 `"/next"` 等注入下一次 `readInput`，仍 `await runGameShell`。  
实现快但「是否在 Session」探测脆弱；**不推荐作 MVP 主路径**。

### 6.3 后期（可选 core）

```ts
listShellActions(worldDir, t): { id, label, summary, recommended }[]
runShellAction(id, ctx): Promise<void>
```

Hub 只消费 API；不挡 MVP。

---

## 7. 状态机（细化）

```text
[启动]
  refreshHeader
  uiPage = hub
  autoStart?
    → 产品二选一（见 §12）：Hub 确认 / 直接 Session+runShellNext

[Hub]
  焦点: HubSelect
  Enter next/revise → session → 执行 → finally hub + refreshHeader
  Enter status/help → write → hub
  quit / Ctrl+C → dispose exit

[Session]
  焦点: Textarea（见 TODO-autofocus-input）
  /exit|cancelled|saved|completed → hub
  SessionExit.shell-command
    next|revise → 保持 session 直到链式结束再 hub（与现 core 一致）
    quit → 退出 app
```

---

## 8. 与 SessionIO / 其它体验

| 能力 | Hub | Session |
|------|-----|---------|
| MessageList | status / 系统提示 | 主对话 |
| 清屏 | **不建议**回 Hub 清空；可选 `── 会话结束 ──` system 行 | 连续 |
| user echo | 可选记「执行：下一步」 | `[YOU]`（见 user-history TODO） |
| stickToBottom | 次要 | 重要 |
| confirm | autoStart 确认可用 | 常用 |
| inputMode | `hidden` 或 `'hub'` | `text` / `confirm` |

---

## 9. i18n 草案

```text
tui.hub.title
tui.hub.hint                      # Enter 确认 · ↑↓ 选择
tui.hub.item.next
tui.hub.item.status
tui.hub.item.revise
tui.hub.item.help
tui.hub.item.quit
tui.session.footer                # 会话中 · /exit 返回指令页 · Ctrl+Enter 发送
tui.hub.sessionEnded              # 可选 system 分隔
```

TUI Hub **不再**把 `shell.promptInstruction`（「输入 /status、/next…」）当主提示。

---

## 10. 与其它 TODO 的顺序建议

1. （可选）`TODO-tui-docs-sync`  
2. user-history + message-list-focus（对话页可读性）  
3. **本双页骨架（H0–H2）**  
4. autofocus / confirm-chrome 接到双页  
5. stick-to-bottom  

也可先上 Hub 骨架再补 history——优先「分得清两页」时采用。

---

## 11. 分期任务清单

### Phase H0 — 规格冻结

- [ ] 确认方案 **B（tui 外环）**（或书面否决改 A）  
- [ ] 冻结选项表与 `/exit` vs `/quit` 文案  
- [ ] 冻结 autoStart 行为（§12）  
- [ ] 冻结回 Hub 是否插入会话结束分隔行  

### Phase H1 — Hub UI

- [ ] `uiPage` + HubPanel / Select  
- [ ] 选项由 `inspectNextState` + `SHELL_WAIT_COMMANDS` + i18n 生成  
- [ ] status/help 不切页；quit 退出  
- [ ] 默认高亮 `next`  

### Phase H2 — 接 Session

- [ ] `runTuiGameShell`（或 main 内环）调用 `runShellNext` / revise  
- [ ] 进入前 `uiPage=session`，`finally` → hub + `refreshHeader`  
- [ ] Session footer / hint  
- [ ] 隐藏 HubSelect、显示 Textarea（互斥 focusable）  

### Phase H3 — 打磨

- [ ] 对接 autofocus、user echo、system 分隔  
- [ ] PTY：Hub → 对话 → `/exit` → Hub  
- [ ] README 快捷键 / 双页说明  

### Phase H4 —（可选）core `listShellActions`

- [ ] 公开 API + Hub 改消费  

---

## 12. 产品待拍板（写入实现前）

| # | 问题 | 选项 |
|---|------|------|
| 1 | 外环方案 | **B（推荐）** / A |
| 2 | `--auto-start` | Hub 确认后再 next / 直接进 Session |
| 3 | 回 Hub | 插入 `── 会话结束 ──` / 不插 |
| 4 | Hub 手动斜杠 | MVP 不做 / 二期一行 Textarea |

---

## 13. 测试计划

| 用例 | 期望 |
|------|------|
| `--no-auto-start` 冷启动 | 在 Hub，焦点在列表 |
| 选「状态」 | 消息有 status，仍在 Hub |
| 选「下一步」（无 API） | Session 可出 ERR，回 Hub，不崩 |
| 选「修订」后 `/exit` | 回 Hub |
| Hub「退出游戏」 | 进程退出 |
| 硬约束 | tui 无 World 读写、无 phase 业务分支 |

---

## 14. 风险

| 风险 | 缓解 |
|------|------|
| 与 `runGameShell` 双维护 | tui 用 `runTuiGameShell`；cli 保留 `runGameShell` |
| 用户在 Session 找指令列表 | footer 写明 `/exit` 返回 |
| 历史混杂 | system 分隔；勿强清屏 |
| Select / Textarea 抢焦 | 同时仅一页主 focusable |

---

## 15. 参考代码

| 路径 | 说明 |
|------|------|
| `packages/core/src/shell/index.ts` | 现有 shell 外环（CLI 可继续用） |
| `packages/core/src/shell/routing.ts` | `runShellNext` / `handleShellCommand` |
| `packages/core/src/shell/commands.ts` | `SHELL_WAIT_COMMANDS` |
| `packages/core/src/next/inspect.ts` | `inspectNextState` / `describeNextAction` |
| `packages/core/src/session-io/types.ts` | `SessionExit` / `ShellCommand` |
| `packages/tui/src/main.ts` | 改为双页外环入口 |
| `bindtty/packages/widgets/src/form/select.ts` | Hub 选择控件候选 |

---

## 16. 完成定义

- [ ] Hub / Session 页面可感知切换  
- [ ] 选指令带提示；对话页 `/exit` 回 Hub；Hub 可退出游戏  
- [ ] 硬约束通过；CLI 行为不回归  
- [ ] H0 产品表已拍板并写进本文或实现注释  
- [ ] 关键路径有单测或 PTY 覆盖  

---

*本文件独立于仓库根 `TODO.md` 与 `packages/tui/TODO.md`，专跟踪「指令页 + 对话页」大改动。*
