# TODO：beginInput / beginConfirm 后自动聚焦输入区

> **状态**：已完成  
> **范围**：`@dayloom/tui-old`（`app.tsx` / `components/text-input` / PTY 测试）  
> **约束**：独立跟踪，不改正文其它 `TODO*.md`（可交叉引用）  
> **日期**：2026-07；最后更新：2026-07-17  
> **相关**：[`TODO-message-list-focus.md`](./TODO-message-list-focus.md)、[`TODO-confirm-focus-chrome.md`](./TODO-confirm-focus-chrome.md)

---

## 1. 问题

`beginInput` / `beginConfirm` 出现后，bindtty 焦点常仍在 **MessageList**。用户直接打字无效，必须先 **Tab** 进入 Textarea / confirm。

`packages/tui-old/TODO.md` §0 已记录该限制；MVP 曾接受「手动 Tab」。体验上这是高频摩擦。

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

## 4. 当前前置状态

bindtty 侧前置已经完成，并已在 dayloom 依赖中更新到 `0.1.0-alpha.10`：

- `BindTTYApp.focus(target: string | MountedElementNode)`
- `BindTTYApp.getFocusedId()`
- `MountedElementApi.focus()`
- `MountedElementApi.isFocused()`

因此本 TODO 不需要继续改 bindtty，也不需要在 dayloom 里保留 interaction 句柄或合成 Tab。dayloom 只需要在 UI 装配层调用 app 级 focus。

## 5. 设计要点

### 5.1 落地点

推荐在 `packages/tui-old/src/app.tsx` 的 `mountApp` 中接入，而不是在 `view-model` 或 `session-io` 里直接访问 app：

- `view-model` 只表达 `inputMode` / `inputValue` / `confirmQuestion` 等状态
- `mountApp` 拥有 bindtty app 实例，适合把状态变化桥接到焦点行为
- `session-io` 仍只负责 SessionIO 协议，不承担 UI focus 细节

### 5.2 何时调用

在 UI 已挂载且 `inputMode` 切到 text/confirm **之后**的下一 microtask 调用 focus：

```ts
const unsubscribe = vm.inputMode.subscribe((mode) => {
  if (mode !== 'text' && mode !== 'confirm') return;
  queueMicrotask(() => {
    app.focus(mode === 'text' ? TEXTAREA_ID : CONFIRM_ID);
  });
});
```

不要同步 focus。`inputMode.set('text')` 后，`<show>` 分支里的 Textarea / ConfirmBox 需要经过 runtime flush 才会注册 id；同步 focus 存在找不到目标的风险。

### 5.3 与 loading

`loadingLabel !== null` 时 Textarea / confirm 可能 disabled。推荐策略：

- input/confirm 出现时仍自动 focus
- disabled 期间组件自身拒绝输入
- loading 结束不额外抢焦，除非仍处于当前 inputMode 且后续验证发现焦点会丢失

这样行为简单，也不会把 loading 状态和 focus 状态强绑定。

### 5.4 连续 shell 提示

用户提交后 `clearInput()` 会隐藏输入区；下一次 `beginInput()` 再次切到 `text`，应再次自动 focus。这个行为覆盖「用户主动 Tab 到 MessageList 后，下一次输入请求把焦点拉回输入区」的高频场景。

### 5.5 手动遍历

自动 focus 只在 `inputMode` 进入 `text` / `confirm` 时触发，不在每次 keystroke 或普通 render 后重复触发。因此用户仍然可以：

- Tab 到 MessageList 滚动历史
- Shift+Tab 返回其它焦点节点
- 在下一次 `beginInput` / `beginConfirm` 时被重新拉回当前输入目标

## 6. 任务清单

- [x] 确认 / 实现 dayloom 可调用的 `focus(id)`（bindtty `0.1.0-alpha.10` 已发布并接入）
- [x] `inputMode` → `text` 时 `focus(TEXTAREA_ID)`
- [x] `inputMode` → `confirm` 时 `focus(CONFIRM_ID)`
- [x] 防抖：同模式重复 set 不疯狂 focus
- [x] PTY：`beginInput` 后无需 Tab 即可输入 `/status`
- [x] PTY：confirm 出现后无需 Tab，直接 `y` / `n` 有效
- [x] 回归：Tab 仍可切到 MessageList；Shift+Tab 仍可用
- [x] 回归：用户 Tab 到 MessageList 后，下一次 `beginInput` 重新 focus Textarea

---

## 7. 验收

1. `--no-auto-start` 启动后出现 shell 提示，**直接**输入 `/status` 有效（或仅需极少辅助，以产品决定为准）
2. confirm 弹出后直接按 `y`/`n` 有效
3. 用户主动 Tab 到消息区后，下一次 `beginInput` 仍把焦点拉回输入区（推荐行为，需在实现时写死）
4. 不改变 MessageList 可聚焦和滚动能力
5. 不引入 inputMode 未变化时的重复 focus

---

## 8. 风险点

| 风险 | 规避 |
|------|------|
| 同步 focus 早于 `<show>` 分支 mount | 使用 `queueMicrotask` 后再 `app.focus(id)` |
| 测试继续先 Tab，掩盖自动聚焦失效 | 新增无需 Tab 的 PTY 用例 |
| loading 期间抢焦行为不一致 | 初版保持简单：出现 input/confirm 就 focus，disabled 由组件处理 |
| 在 VM 中引入 app 依赖 | 只在 `mountApp` 做桥接 |

---

## 9. 参考

| 路径 | 说明 |
|------|------|
| `packages/tui-old/src/components/constants.ts` | `TEXTAREA_ID` |
| `packages/tui-old/src/view-model.ts` | `beginInput` / `beginConfirm` |
| `packages/tui-old/src/app.tsx` | `mountApp` |
| `bindtty/packages/bindtty/src/app.ts` | `BindTTYApp.focus(target)` |
| `bindtty/packages/vnode/src/mounted/types.ts` | `MountedElementApi.focus()` |
| `packages/tui-old/TODO.md` §0 | 问题背景 |

---

*独立跟踪「自动聚焦输入区」。*
