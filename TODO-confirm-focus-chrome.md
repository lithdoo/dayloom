# TODO：Confirm 框获焦视觉反馈

> **状态**：已完成（自动聚焦联动见 `TODO-autofocus-input.md`）  
> **范围**：`@dayloom/tui` `text-input.tsx` ConfirmBox；可选 i18n  
> **约束**：独立跟踪，不改正文其它 `TODO*.md`  
> **日期**：2026-07  
> **相关**：[`TODO-autofocus-input.md`](./TODO-autofocus-input.md)、[`TODO-message-list-focus.md`](./TODO-message-list-focus.md)

---

## 1. 问题

`inputMode === 'confirm'` 时渲染 `ConfirmBox`（Y/N/Enter）。用户 Tab 到该框或自动聚焦后：

- 可能出现 **整区默认 inverse**（难读），或  
- **几乎无反馈**（与消息区获焦问题同类）

与 Textarea「局部 caret、内容区不整片反色」、消息区「标题获焦」策略不一致。

现状（简化）：

```tsx
<box id="dayloom-confirm" onKey={onKey}>
  <vstack>
    <text value={confirmQuestion} />
    <text value={t('tui.input.confirmHint')} color="gray" />
  </vstack>
</box>
```

未设 `focusStyle="none"`，也无独立「确认标题」获焦态。

---

## 2. 目标

1. Confirm **内容区不整片反色**（`focusStyle="none"`）
2. 用 **标题行 / 问题行样式** 表达获焦（与 MessageList 标题方案同语言：cyan + bold）
3. 未获焦时仍可读（gray 标题 + 正常问题文案）
4. 保持 Y / N / Enter 键语义不变

---

## 3. 非目标

- 不改 `emptyBehavior` 业务分支
- 不把 Y/N 默认写入消息历史（见 `TODO-user-message-history.md`）
- 不做鼠标点击

---

## 4. UI 设计

```text
ConfirmBox (focusable box, focusStyle="none")
└─ vstack
   ├─ 标题行：未获焦 "Confirm" / 获焦 "Confirm  Y/N"（cyan+bold）
   ├─ 问题正文：confirmQuestion（wrap）
   └─ 提示行：tui.input.confirmHint（gray）
```

| 状态 | 标题 en | 标题 zh | 样式 |
|------|---------|---------|------|
| 未获焦 | `Confirm` | `确认` | `color="gray"` |
| 获焦 | `Confirm  Y/N` | `确认  Y/N` | `color="cyan"` + `bold` |

i18n 建议：

```text
tui.confirm.title
tui.confirm.titleFocused
```

（`tui.input.confirmHint` 已存在，可保留。）

---

## 5. 实现要点

```tsx
const focused = createSignal(false);

<box
  id="dayloom-confirm"
  focusable={true}          // 显式；需在焦点环内
  focusStyle="none"
  onFocusChange={(e) => focused.set(e.focused)}
  onKey={onKey}
>
  ...
</box>
```

注意：

- Confirm 仅在 `show when={confirm}` 时挂载；与 autofocus TODO 配合时 id 必须稳定存在后再 `focus`
- `disabled`（loading）时：onKey 内部 return false；标题可 dim
- 不要 `onKey={disabled ? false : handler}`（会踢出焦点环）

---

## 6. 任务清单

- [x] Confirm 根 box：`focusStyle="none"` + `onFocusChange`
- [x] 标题行 + i18n `tui.confirm.title` / `titleFocused`
- [x] 单测：focus true/false 切换标题文案或颜色 binding
- [x] PTY：弹出 confirm 后无需 Tab 即可 Y/N（见 `TODO-autofocus-input.md`）

可选手工视觉验收：Tab 到 confirm → 标题高亮、正文不反色；Y/N 仍可用。

---

## 7. 验收

1. [x] Confirm 获焦：标题 cyan/bold，问题与 hint **不**整片 inverse  
2. [x] Confirm 失焦（焦点在 MessageList）：标题回 gray，仍显示问题  
3. [x] Y / N / Enter 行为与现网一致  

---

## 8. 参考

| 路径 | 说明 |
|------|------|
| `packages/tui/src/components/text-input.tsx` | `ConfirmBox` |
| `packages/core/src/i18n/messages.ts` | 新增文案键 |
| `TODO-message-list-focus.md` | 标题获焦模式对照 |

---

*独立跟踪「Confirm 获焦 chrome」。*
