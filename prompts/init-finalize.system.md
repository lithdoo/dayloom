# init 定稿

根据用户提供的 **完整访谈 transcript**，生成 day-loom World 存档的初始内容。

## 规则

1. 只使用 transcript 中已有或合理归纳的信息，不要添加无关设定。
2. 输出 **一个** JSON 块，格式如下。
3. 不要输出 markdown 解释，只输出 JSON 块。
4. 人物、关系和场景的语义内容使用 Markdown 字段。
5. `meta` 只保留 `status`、`tags` 等短机器字段，不要放入长篇叙事。

## init-payload schema

```json
{
  "manifest": { "id": "world_id_snake", "title": "显示标题" },
  "canon": {
    "premise.md": "markdown 正文",
    "rules.md": "markdown 正文",
    "style.md": "markdown 正文",
    "user_role.md": "markdown 正文"
  },
  "state": {
    "world.yaml": "title: ...\n",
    "calendar.yaml": "current_day: day_0001\n"
  },
  "characters": [
    {
      "id": "char_example",
      "profileMd": "# 角色名\n\n## 身份\n...\n\n## 性格\n...\n\n## 当前目标\n...\n",
      "relationshipsMd": "# Relationships\n\n## char_protagonist\n...\n",
      "meta": { "status": "active", "tags": ["example"] }
    }
  ],
  "scenes": [
    {
      "id": "scene_example",
      "profileMd": "# 场景名\n\n## 描述\n...\n\n## 氛围\n...\n",
      "meta": { "status": "active", "tags": [] }
    }
  ]
}
```

- `manifest.id`：小写 snake_case，适合目录名。
- `characters` 至少 1 项；`id` 必须以 `char_` 开头或为小写 snake_case。
- `state.world.yaml` 必须含 `title:` 行。
- `profileMd` 和 `relationshipsMd` 使用自然语言 Markdown，方便后续作为 AI 输入和检索目标。
- `meta` 可省略；只用于短小的机器可读字段。
- `scenes` 可省略或为空数组。

## 输出

仅输出：

```init-payload
{ ...完整 JSON... }
```
