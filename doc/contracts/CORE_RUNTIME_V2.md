# Core Runtime V2

**状态**：冻结契约  
**最后核对**：2026-08-27

## 1. Authority

每个 Draft identity slot 只有一个 Core-owned Aggregate Head：

```text
revision + draftHash + activeSession(sessionId, conversationId, pendingDraftSync)
```

Head 是唯一可变 authority pointer。Conversation revision 和 Markdown Draft snapshot 都是不可变目录。CAS 必须验证 revision 精确加一、所有引用存在、snapshot hash 正确，且同 runtime 并发 writer 只能成功一个。

## 2. 生命周期能力

public Session status 不增加 degraded 枚举。能力只由 Head、Session phase 和 active mutation 推导：pending 时 `send=false`、`submit=false`、`retryDraftSync=true`、`cancel=true`。

四类 Session 同时使用 Turn Coordinator V1 与 Submission V2；不存在 caller-selectable V1/V2 flag。普通 Session 生命周期不持有长驻 Draft file server，每个 AI Operation 自己创建最小权限 runtime 并在结束时关闭。

控制型 Operation 使用统一 sealed-control Final Gate；普通 Operation 不拥有该 Gate。Draft 工具按 read/write capability 分离，模型不可见的权限不依赖 after-hook 模拟。只有 Response Operation 可以发布用户可见 output delta。

## 3. 恢复

- 初始化持有 world writer lock 后读取 Head，不按 mtime、目录编号或内容猜测 authority。
- base 不匹配的 slot 原子移动到 stale；若 Published World 已含对应 Audit，则幂等完成 Draft archive。
- 删除所有未被 Head 引用的 snapshot、Conversation 和 transient artifact。
- pending Head 恢复为 ready + retry/cancel；Commit B 后缺失的 terminal record依据 Head 与 evidence 幂等补齐。
- Head JSON、引用或 hash 损坏必须初始化失败。
- ready cancel 先清空 Head，再把 Session 移入 `abandoned-sessions`；移动失败不得复活 Session。

## 4. Legacy migration

Legacy YAML Draft 只在初始化迁移模块中读取。迁移机械、无模型、保留原始 bytes/hash，先生成 Markdown snapshot 与 prepared meta，再以 Head revision 0 线性化；Head 成功后旧文件移入 `legacy-v1`。普通 start/send/submit 路径不存在旧可变 Draft writer或 YAML-driven submission。

## 5. Public events

Core 只生产 Operation/Turn Event V2 与 `state.changed`。TUI reducer 按 sessionId/groupId/operationId 过滤 stale 或 terminal 后事件。
