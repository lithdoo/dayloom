# TODO：beginInput / beginConfirm 后自动聚焦输入区

> **状态**：待做  
> **范围**：`@dayloom/tui`（`app.tsx` / `view-model` / `main`）；可能需暴露 bindtty `app.focus`  
> **约束**：独立跟踪，不改正文其它 `TODO*.md`（可交叉引用）  
> **日期**：2026-07  
> **相关**：[`TODO-message-list-focus.md`](./TODO-message-list-focus.md)、[`TODO-confirm-focus-chrome.md`](./TODO-confirm-focus-chrome.md)

---

## 1. 问题

`beginInput` / `beginConfirm` 出现后，bindtty 焦点常仍在 **MessageList**。用户直接打字无效，必须先 **Tab** 进入 Textarea / confirm。

`packages/tui/TODO.md` §0 已记录该限制；MVP 曾接受「手动 Tab」。体验上这是高频摩擦。

---

## 2. 目标

1. `readInput` 进入 `inputMode === 'text'` 后，焦点自动落到 `TEXTAREA_ID`（`dayloom-textarea`）
2. `confirm` 进入 `inputMode === 'confirm'` 后，焦点自动落到 confirm 焦点目标（见 confirm TODO 的 id）
3. 不破坏 Tab / Shift+Tab 手动遍历
4. loading / `disabled` 期间不抢焦到不可编辑控件（或聚焦后按键仍由 disabled 逻辑吞掉）

---

## 3. 非目标

- 不要求每次 keystroke 后重聚焦
- 不改 core `SessionIO` 契约
- 不在 MessageList 取消 focusable（历史仍可 Tab 进入滚动）

---

## 4. 设计要点

### 4.1 API 前置

`@bindtty/interaction` 已有：

```ts
interaction.focus(target: string | MountedElementNode): InteractionResult
```

`createApp` 当前未必对外暴露 `focus(id)`。可选路径：

| 路径 | 说明 |
|------|------|
| A | bindtty `BindTTYApp` 增加 `focus(id: string)`，转调 interaction |
| B | dayloom `mountApp` 保留 interaction 句柄并导出 `focusInput()` |
| C | 临时：合成 Tab 直到命中目标（脆弱，不推荐） |

**推荐 A 或 B**；以 id 聚焦，与 `TEXTAREA_ID` / `dayloom-confirm` 对齐。

### 4.2 何时调用

在 UI 已挂载且 `inputMode` 切到 text/confirm **之后**的下一帧（或 `requestAnimationFrame` / `queueMicrotask` / runtime flush 后）：

```ts
// 伪代码
vm.beginInput(...) 之后
→ inputMode = 'text'
→ schedule(() => app.focus(TEXTAREA_ID))
```

注意：`beginInput` 在 ViewModel；`focus` 在 app 层。应用：

- `mountApp` 订阅 `inputMode`，变化时 focus；或
- `session-io` / vm 接受可选 `onInputPresented?: () => void` 回调

避免在 vnode 未注册 id 前 focus（首次 `show when={text}` 刚打开时）。

### 4.3 与 loading

`loadingLabel !== null` 时 Textarea `disabled` 但仍可 focusable。自动聚焦仍可，按键无效即可；或 loading 期间不 focus、结束后再 focus 一次。

### 4.4 连续 shell 提示

用户提交 → `clearInput` → 下一次 `beginInput` 再次自动 focus。覆盖「命令后焦点丢回 MessageList」的场景（与验收 §13 焦点恢复相关）。

---

## 5. 任务清单

- [ ] 确认 / 实现 dayloom 可调用的 `focus(id)`（app 或 bindtty 发版）
- [ ] `inputMode` → `text` 时 `focus(TEXTAREA_ID)`
- [ ] `inputMode` → `confirm` 时 `focus(CONFIRM_ID)`
- [ ] 防抖：同模式重复 set 不疯狂 focus
- [ ] 单测或 PTY：`beginInput` 后无需 Tab 即可输入字母
- [ ] 回归：Tab 仍可切到 MessageList；Shift+Tab 仍可用

---

## 6. 验收

1. `--no-auto-start` 启动后出现 shell 提示，**直接**输入 `/status` 有效（或仅需极少辅助，以产品决定为准）
2. confirm 弹出后直接按 `y`/`n` 有效
3. 用户主动 Tab 到消息区后，下一次 `beginInput` 仍把焦点拉回输入区（推荐行为，需在实现时写死）

---

## 7. 参考

| 路径 | 说明 |
|------|------|
| `packages/tui/src/components/constants.ts` | `TEXTAREA_ID` |
| `packages/tui/src/view-model.ts` | `beginInput` / `beginConfirm` |
| `packages/tui/src/app.tsx` | `mountApp` |
| `bindtty/packages/interaction/src/controller.ts` | `focus(target)` |
| `packages/tui/TODO.md` §0 | 问题背景 |

---

*独立跟踪「自动聚焦输入区」。*
