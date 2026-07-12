# TODO：历史消息显示用户输入

> **状态**：已完成  
> **范围**：`@dayloom/tui`（`session-io` / `view-model` / `theme` / MessageList 展示）  
> **约束**：不修改既有 `TODO.md` / `packages/tui/TODO.md` / `TODO-message-list-focus.md` 正文；本文件独立跟踪  
> **日期**：2026-07  
> **相关**：[`TODO-message-list-focus.md`](./TODO-message-list-focus.md)（消息区标题获焦，正交）

---

## 1. 问题

用户在 Textarea **Ctrl+Enter 提交**后，输入只通过 `readInput` Promise 交给 core，**不会**写入 `messages` 历史。

现状（完成前）：

- `submitTextInput`：resolve + `clearInput`，无 `appendMessage`
- `createTuiSessionIO.readInput`：非空则 `return trimmed`，无 echo
- `TuiMessageRole` 仅有 `'output' | 'warn' | 'error' | 'system'`，无 `'user'`

对比 CLI：TTY 下会回显用户答案；TUI 无 stdout 回显，历史里通常只剩 `[OUT]` / `[ERR]`，对话感缺失。

---

## 2. 目标

1. 用户**成功提交非空输入**后，历史区出现一条用户消息
2. **不改变** core `SessionIO.readInput` 契约（仍返回 `trim()` 后的字符串）
3. 不在 core / `runGameShell` 里 echo（避免所有 IO 适配器被污染，且语义会变成 `output`）

---

## 3. 非目标

- 不把 `confirm` 的 Y/N 默认记进历史（二期可选 `system` 行）
- 不在 `onChange` / 未提交时写历史
- 不做聊天气泡 / 头像；沿用现有 `[TAG] text` 行布局
- 不解析 `/revise` 等命令（仍由 session loop → `SessionExit`）

---

## 4. 设计

### 4.1 挂点（推荐）

在 **`createTuiSessionIO.readInput`**、确认非空并即将 `return` 时写入：

```ts
const trimmed = text.trim();
if (trimmed !== '') {
  vm.appendMessage('user', trimmed);
  vm.setStickToBottom(true); // 可选，与 stream 跟底一致
  return trimmed;
}
```

| 挂点 | 说明 |
|------|------|
| **`readInput`（采用）** | 只记录真正交给 core 的输入；空输入 / emptyBehavior 取消不会误记 |
| `submitTextInput`（不采用） | 空串、未 trim、重试循环可能脏历史 |

### 4.2 数据模型

```ts
type TuiMessageRole = 'output' | 'warn' | 'error' | 'system' | 'user';
```

| 字段 | 规则 |
|------|------|
| `role` | `'user'` |
| `text` | 与返回给 core 的 **`trimmed` 同一字符串**（保留中间换行，去掉首尾空白） |
| `id` / `ts` | 沿用现有 `appendMessage` |

### 4.3 展示

与现有标签对齐：

```text
[YOU] /status
[OUT] Current: uninitialized
```

多行：

```text
[YOU] hello
world
```

| 项 | 建议 |
|----|------|
| `roleLabel('user')` | `'YOU '`（与 `OUT `/`ERR ` 尽量同宽） |
| `roleColor('user')` | `'green'`（或 `'cyan'`，与 output 白、error 红区分） |
| MessageList | 无需改结构；现有 `wrap="wrap"` 即可 |

可选增强（非 MVP）：正文前缀 prompt，如 `> /status`——MVP 只存 trimmed 正文。

### 4.4 行为矩阵

| 场景 | 是否写入 `[YOU]` |
|------|------------------|
| 非空提交（shell / daily / play…） | ✅ |
| 空输入 + `ignore` → `undefined` | ❌ |
| 空输入 + confirm 后退出 / 存草稿 | ❌ |
| 空输入 + confirm 否 → 再输有效内容 | ✅ 只记最终有效那次 |
| `/quit`、`/revise`、普通回复 | ✅ 一律 echo |
| loading / disabled 无法提交 | 无提交则无记录 |

提交顺序建议：

1. `appendMessage('user', trimmed)`
2. resolve Promise / 清输入区（现有 `submitTextInput` → `clearInput` 路径保持）
3. 跟底：`setStickToBottom(true)`（推荐）

---

## 5. 代码改动面

| 文件 | 改动 |
|------|------|
| `packages/tui/src/view-model.ts` | `TuiMessageRole` 增加 `'user'` |
| `packages/tui/src/theme.ts` | `roleLabel` / `roleColor` 补 `user` |
| `packages/tui/src/session-io.ts` | `readInput` 非空 return 前 `appendMessage('user', …)` |
| `packages/tui/test/session-io.test.js` | 断言历史含 user；空 ignore 无 user |
| （可选）`packages/tui/TODO.md` | **不强制**；本文件已独立跟踪 |

**禁止**：在 `@dayloom/core` 的 `runGameShell` / 各 session loop 里 `io.write(userInput)` 冒充用户消息。

---

## 6. 任务清单

- [x] `TuiMessageRole` + `theme` 支持 `'user'`
- [x] `readInput` 非空成功路径 echo 到 `messages`
- [x] （推荐）用户发言后 `setStickToBottom(true)`
- [x] 单测：提交 `/status` → 存在 `role==='user'` 且 `text==='/status'`
- [x] 单测：`emptyBehavior: 'ignore'` 空提交 → 无新 user 消息
- [x] 单测：多行 trim 后保留中间 `\n`
- [ ] 手工：提交后历史先 `[YOU]` 再 `[OUT]`；连续两条命令顺序正确

---

## 7. 验收标准

1. 输入 `/status` 提交 → 历史先出现 `[YOU] /status`，再出现 status 的 `[OUT] …`
2. 多行输入提交 → 历史保留换行（trim 后）
3. 空提交（ignore）→ 无新 `[YOU]`
4. 连续两条用户命令 → 两条 `[YOU]`，顺序正确
5. core / CLI 行为不变；仅 TUI 展示增强

---

## 8. 不要做

- 在 core 里 echo 用户输入
- 用 `system` / `output` 冒充用户
- 在 Textarea `onChange` 时写历史
- 为 echo 做「与后续 write 去重」（core 不会 echo 用户句）
- 默认把 confirm Y/N 写入历史（除非另开任务）

---

## 9. 参考

| 路径 | 说明 |
|------|------|
| `packages/tui/src/session-io.ts` | `readInput` 改造点 |
| `packages/tui/src/view-model.ts` | `appendMessage` / `TuiMessageRole` |
| `packages/tui/src/theme.ts` | 标签与颜色 |
| `packages/tui/src/components/message-list.tsx` | 展示（通常无需改布局） |
| `packages/cli/src/session-io/terminal-input.ts` | CLI TTY 回显对照 |

---

## 10. 完成定义

- [x] 非空用户提交稳定出现在历史，角色为 `user`
- [x] 空输入 / 取消路径不污染历史
- [x] 主题与单测齐全
- [x] 硬约束：业务逻辑仍只在 core；TUI 仅 IO 展示

---

*本文件独立于仓库根 `TODO.md` 与 `packages/tui/TODO.md`，专跟踪「历史显示用户输入」一项。*
