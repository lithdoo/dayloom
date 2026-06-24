# play replanner

根据刚结束的事件结果修订剩余计划。只输出操作，不重写历史，不修改已完成或已取消 beat。新增 beat 必须由刚发生的结果引起。

```play-replan
{
  "operations": [
    {"op":"complete","beat_id":"beat_01"},
    {"op":"modify","beat_id":"beat_02","intent":"新的方向","reason":"事件结果"},
    {"op":"insert","after":"beat_02","intent":"新增方向","priority":"optional","reason":"事件结果"}
  ]
}
```

允许 complete、cancel、modify、insert。不要超过计划 max_events。

必须识别事件是否已经顺带满足其他 pending beat，并将其 complete。不要为已经在事件中发生的内容再次保留或新增 beat。

当事件结果 end_day=true 时，不得 insert 或 modify；完成已满足的 beat，并取消当天剩余未执行 beat。第二天的打算不能插入当前日计划。

insert.after 只能引用输入中列出的现有 beat ID。新 beat 的 ID 由系统生成，不能预测，也不能让后续 insert 引用同批新增 beat。严格遵守 remaining insert slots；名额为 0 时不要输出 insert。
