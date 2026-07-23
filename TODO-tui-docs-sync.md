# TODO：同步 tui 文档与已落地实现

> **状态**：已完成
> **范围**：文档 only（主要为 `packages/tui-old/TODO.md`；可选根 `TODO.md` / `README`）  
> **约束**：本文件跟踪「文档纠偏」；实施时可改上述文档，但勿与功能 TODO 混在一个 PR 叙述里亦可  
> **日期**：2026-07  
> **相关**：Phase A–D 已完成；功能缺口见其它 `TODO-*.md`

---

## 1. 问题

`packages/tui-old/TODO.md` **顶部状态**已写 Phase A–D 完成，但 **§0「次要问题」** 曾残留过时条目，易误导后续贡献者：

| §0 仍写着 | 实际 |
|-----------|------|
| Footer 与 Windows Ctrl+Z 不一致 | Phase D 已改为 Ctrl+Enter 文案；`multilineInputHint` 分平台 |
| Ctrl+C / Kitty ctrl+c 兼容性旧问题 | 已有 `isCtrlC`（含 Kitty `input:'c'+ctrl`）+ SIGINT |
| （隐含）输入获焦只能靠 inverse | Textarea 为 caret；消息区 inverse 问题另见 focus TODO |

同步前还存在：

- §13 部分项已勾，但「Shift+Tab / 连续命令后焦点恢复」仍空；目前已由 autofocus PTY 覆盖并勾选
- 根目录新增多份独立 TODO，**根 `TODO.md` / tui README 未索引**，发现成本高

---

## 2. 目标

1. §0 只保留 **仍然成立** 的限制  
2. 过时项改为「已修复」短注或删除，并指向代码  
3. 在 tui README 或本目录加 **独立 TODO 索引**（链到各 `TODO-*.md`）  
4. 不把未做功能写成已完成

---

## 3. 非目标

- 不在本任务实现 autofocus / 用户历史等功能  
- 不重写整份 `packages/tui-old/TODO.md` 实施史  

---

## 4. 建议修订内容

### 4.1 `packages/tui-old/TODO.md` §0

**删除或改写为已修复：**

- Footer Ctrl+Z → 注明已用 `tui.input.multilineHint` + `tui.footer.*`
- Ctrl+C / Kitty → 注明 `app.tsx` `isCtrlC` + `main.ts` SIGINT

**保留为仍有效：**

- stick-to-bottom 与手动上滚冲突（→ `TODO-stick-to-bottom-scroll.md`）
- Hub / Session 双页架构（→ `TODO-hub-session-pages.md`）
- `onKey: false` 踢出焦点环的坑（仍是编码约束）
- `hideCursor` + Textarea 自绘 caret（说明性，非 bug）
- 边框 / `CHROME_ROWS` 校准（仍可能需要）

### 4.2 §13 验收

将「Shift+Tab 与连续 shell 命令后的焦点恢复」标为已完成，并指向 autofocus 相关 PTY 覆盖。

```text
- [x] …（见 TODO-autofocus-input.md）
```

### 4.3 索引（推荐写在 `packages/tui-old/README.md` 或 dayloom 根短文件）

```markdown
## 开放体验 TODO

- TODO-message-list-focus.md
- TODO-user-message-history.md
- TODO-autofocus-input.md
- TODO-confirm-focus-chrome.md
- TODO-stick-to-bottom-scroll.md
- TODO-tui-docs-sync.md（本文件，完成后可归档）
```

### 4.4 根 `TODO.md` Phase 5

与 tui 状态对齐：已完成项保持；未完成项链到独立 TODO，避免重复空清单。

---

## 5. 任务清单

- [x] 修订 `packages/tui-old/TODO.md` §0（去过时、留真限制、加链接）
- [x] §13 焦点项指向 `TODO-autofocus-input.md` 并标为已完成
- [x] tui README 增加开放 TODO 索引
- [x] 快速扫根 `TODO.md` Phase 5/6 是否仍写过时句
- [x] 自检：全文搜索过期焦点 / 快捷键 / 版本描述，不再作为未修 bug 出现在 tui 文档里

---

## 6. 验收

1. 新同学只读 §0，不会认为 Ctrl+C / Ctrl+Enter 文案仍坏
2. 开放工作从索引 5 分钟内能点到对应 `TODO-*.md`  
3. 无「Phase D 完成」与「§0 仍列已修 bug」的矛盾  

---

## 7. 参考

| 路径 | 说明 |
|------|------|
| `packages/tui-old/TODO.md` | 主修订对象 |
| `packages/tui-old/src/app.tsx` | `isCtrlC` |
| `packages/tui-old/src/theme.ts` | multiline / footer i18n |
| `packages/tui-old/README.md` | 索引入口 |

---

*独立跟踪「文档与实现同步」。完成后可将本文件标为完成并移入 archive 或删除。*
