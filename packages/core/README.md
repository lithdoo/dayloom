# @dayloom/core

Dayloom 的 Archive V2 产品运行时，覆盖 Init、Planning、Play、Settle、Revise、Abandon、取消、Conversation 压缩和 World Profile V1 原子发布。

```ts
import { createDayloomCore } from '@dayloom/core';

const core = await createDayloomCore({
  worldRoot: './world',
  llmConfigPath: './llm.toml',
  // 可选；默认是 <worldRoot>/.dayloom-runtime
  runtimeRoot: './runtime',
});

const unsubscribe = core.subscribe((event) => {
  // 将 CoreEvent 投影到应用界面
});

await core.dispose();
unsubscribe();
```

## Session 提交模型

四类 Session 使用统一的持久 Draft 与 Candidate 流水线：

```text
对话 -> Draft
提交 -> lint -> ID 分配 -> AI 转换 -> 程序校验
     -> 最多 3 轮修复 -> advisory 审查 -> diff -> 原子发布
     -> 审计 + Draft 归档 + transient 清理
```

对话 Final 只回答用户，不承载发布 JSON。Draft 保存在 `runtimeRoot/drafts`，Core 重启后可恢复；Candidate 和模型工作目录位于当前实例的 `transient`，成功、失败或取消后清理。一个规范化 World 同时只允许一个 Core 写实例。

失败结果可能携带结构化 `diagnostics`，主要提交错误码为 `DRAFT_INVALID`、`CONVERSION_FAILED`、`CANDIDATE_INVALID` 和 `WORLD_CONFLICT`。提交失败后 Session 回到 `ready`，保留 Draft，不修改可见 World。

## 中文提示词导出

所有模型提示词集中在 `src/session/prompts/`，并通过独立子路径导出：

```ts
import {
  INIT_THOUGHT_PROMPT,
  PLAY_SEND_FINAL_PROMPT,
  CONVERSION_THOUGHT_PROMPT,
  REVIEW_PROMPT,
} from '@dayloom/core/prompts';
```

完整冻结契约见 `doc/contracts/SESSION_SUBMISSION_V1.md`、`doc/contracts/CORE_RUNTIME_V1.md` 和 `doc/contracts/WORLD_PROFILE_V1.md`。
