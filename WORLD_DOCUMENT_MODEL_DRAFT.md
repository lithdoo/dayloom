# Dayloom World V2 Phase 1 文档入口

> 状态：Superseded / Navigation only  
> 日期：2026-08-13  
> 原文档：`WORLD_DOCUMENT_MODEL_DRAFT.md`  
> 说明：原单体 Phase 1 设计已经拆分为两个可独立实施和验收的 Implementation Freeze 文档；本文件不再定义任何规范或实现事实。

## 1. 当前 Phase 1 authority

Phase 1 现在分成两个顺序明确的子阶段：

```text
Phase 1A
ARCHIVE_PROTOCOL_PACKAGE_DRAFT.md
@dayloom/archive-protocol
        ↓
Phase 1B
DAYLOOM_ARCHIVE_PROTOCOL_ADAPTATION_DRAFT.md
@dayloom/core direct consumer
```

### Phase 1A — Archive Protocol Package

见：`ARCHIVE_PROTOCOL_PACKAGE_DRAFT.md`

负责：

```text
Archive V2 disk/data contract
path identity
canonical tree/hash
manifest/current/commit
staging/operation shapes
strict parser/validator
pure overlay/diff/recovery classification
conformance fixtures
```

明确不负责：

```text
filesystem
locks/OCC
atomic publication execution
Dayloom gameplay/runtime
```

### Phase 1B — Dayloom Core Adaptation

见：`DAYLOOM_ARCHIVE_PROTOCOL_ADAPTATION_DRAFT.md`

负责：

```text
@dayloom/core → @dayloom/archive-protocol
filesystem Archive runtime
operation workspace
publish lock/OCC
atomic current publication
inspect/GC execution
World Profile
mutation policy
Published phase → Runtime phase projection
V1 → V2 cutover
```

本阶段明确**不创建 `@dayloom/archive` package**。

---

## 2. Phase 1 完成条件

只有两份实施文档都达到 Freeze，Phase 1 才完成：

```text
Protocol meaning stable
+
Core runtime conforms to Protocol
+
V1 canonical Archive model removed
+
publication/recovery evidence green
=
Document-native World V2 Freeze
```

---

## 3. 后续阶段依赖

现有 Phase 2 / Phase 3 文档仍可把本文件当作 Phase 1 导航入口，但其真实前置条件是：

```text
ARCHIVE_PROTOCOL_PACKAGE_DRAFT.md
AND
DAYLOOM_ARCHIVE_PROTOCOL_ADAPTATION_DRAFT.md
```

然后：

```text
Phase 2
PERSISTENT_CONVERSATION_COMPRESSION_DRAFT.md
        ↓
Phase 3
PROMPTPILE_AGENT_RUNTIME_DRAFT.md
```

---

## 4. Governance

本文件只是兼容旧链接的导航 stub，不是第三份 authority。

禁止在这里继续增加：

- Archive Protocol schema；
- Core transaction design；
- World Profile；
- implementation checklist；
- future feature design。

Phase 1 实施完成并把后续文档引用迁移到两份新 authority 后，应删除本导航文件。
