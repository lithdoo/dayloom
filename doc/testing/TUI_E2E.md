# TUI 测试与验收

> **类型**：testing  
> **状态**：implemented  
> **最后核对**：2026-07

## 自动测试

在 Dayloom monorepo 根目录执行：

```bash
npm run test -w @dayloom/tui
```

该命令会先运行 TypeScript 构建，再以串行方式运行 `packages/tui/test/*.test.js`。串行是必要的，因为真实 PTY 测试会占用伪终端和进程级 I/O。

只验证构建：

```bash
npm run build -w @dayloom/core -w @dayloom/tui
```

## 当前测试覆盖

### Runtime driver 和 ViewModel

- package 公共导出；
- argv 可选 world root 与错误参数；
- Core availability 到 Hub action 的投影；
- 普通输入不结束 Session，`/submit` 显式提交；
- Session slash 指令拦截；
- Hub quit 到 app lifecycle 的传递；
- 意外 command 失败后清理 busy；
- streaming 时的输入可用性与滚动位置；
- AI 失败后 cancel recovery 提示；
- 输入历史与草稿恢复；
- Hub/Session 页面切换后 autofocus。

### 真实 PTY

- Hub 快捷键、resize 和 quit；
- 自然语言 init 的流式 assistant 消息与显式 submit；
- Session cancel 回 Hub 与焦点恢复；
- 部分 AI 失败的可见消息和取消；
- 无效 submit payload 保持 Session 并允许恢复。

PTY 测试通过可控 fake provider/Session 驱动真实终端渲染，不要求真实 API key。`node-pty` 是可选依赖；缺失时相关环境可能无法执行 PTY 覆盖。

## 手工 smoke checklist

在一个临时 World 上检查：

- [ ] 无参数启动使用当前目录，指定路径使用目标 World。
- [ ] Hub status/help 可切换，不修改 Core snapshot。
- [ ] Hub 只展示当前可用的业务 action。
- [ ] 进入 Session 后焦点在 Textarea，普通文本可发送。
- [ ] assistant delta 更新同一条消息，不按 chunk 新增行。
- [ ] `/status`、`/help`、`/revise` 在 Session 中只显示提示。
- [ ] `/submit` 成功后回 Hub，`/exit`/`/cancel` 取消后回 Hub。
- [ ] settle/abandon 执行时 HubSelect 隐藏，完成或失败后恢复。
- [ ] 长 world 路径、长 loading 文本和窄终端不使 chrome 换行。
- [ ] 终端 resize 后 MessageList 和 Textarea 高度正常。
- [ ] 手动上滚后 streaming 不强制拉回底部。
- [ ] `q` 和 `Ctrl+C` 正常恢复终端并退出。

## 变更验收原则

- 修改 Core event/command 适配时，同时更新 driver 单元测试和 Runtime driver 文档。
- 修改按键、焦点、页面或布局时，至少增加一条真实 PTY 回归。
- 修改可见交互时，同步更新 [TUI 使用指南](/guide/TUI)。
- 不以 snapshot 文本快照取代焦点、键盘和页面转移的真实 PTY 验证。
