# @dayloom/core

Dayloom 的 Archive V2 产品运行时，覆盖 Init、Planning、Play、Settle、Revise、Abandon、取消、Conversation 压缩及 Profile V1 原子发布。

```ts
import { createDayloomCore } from '@dayloom/core';

const core = await createDayloomCore({
  worldRoot: './world',
  llmConfigPath: './llm.toml',
});

const unsubscribe = core.subscribe((event) => {
  // 将 CoreEvent v1 投影到应用界面
});

await core.dispose();
unsubscribe();
```

主入口仅包含应用运行时。旧文件系统 World 的显式迁移从独立子路径导入：

```ts
import { migrateLegacyWorldProfileV1 } from '@dayloom/core/migration';
```

或使用 CLI：

```bash
dayloom-core archive migrate-world-profile-v1 --source ./old-world --target ./archive-v2-world
```

Core 固定使用 `promptpile-react@0.1.0-beta.5` 的 Process Pile v1。一步预算只由 CLI 参数 `--max-step 1` 提供；`final` 与 `max_step` 终止原因必须和 Check 决策严格一致。完整约束见仓库中的 `doc/contracts/CORE_RUNTIME_V1.md` 与 `doc/contracts/WORLD_PROFILE_V1.md`。
