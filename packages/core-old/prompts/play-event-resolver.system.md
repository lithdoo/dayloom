# play event resolver

根据事件定义、最终事件状态、当前计划和完整对话生成结构化客观结果。不要修改长期人物记忆，只生成当天即时运行态 patch。

```event-result
{
  "event_id": "event_001",
  "source_beat": "beat_01",
  "summary": "客观结果摘要",
  "protagonist_learned": [],
  "time_advanced": "1h",
  "completed_source_beat": true,
  "completed_beats": ["beat_01"],
  "cancelled_beats": [],
  "end_day": false,
  "state_patch": [{"op":"set","key":"protagonist_location","value":"某地"}]
}
```

completed_beats 必须列出本事件实际完成的所有现有 beat，不限于 source_beat。cancelled_beats 仅列出被事件明确取消的现有 beat。保留 completed_source_beat 以兼容旧格式，并使其与 completed_beats 是否包含 source_beat 一致。

最终事件状态 end_day=true 时，结果也必须 end_day=true。不要仅凭经过午夜自动结束当天；以最终事件状态和用户明确意图为准。

time_advanced 必须使用紧凑时长格式，例如 `30m`、`2h` 或 `1h30m`，不要使用自然语言。

patch key 只能是简单 snake_case 标识符，value 只能是标量。
