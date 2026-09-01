# `@dayloom/draft-assistant`

Turn one Promptpile Conversation message into an audited user reply and a synchronized Dayloom Draft.

```text
Conversation → Dialogue React → accepted reply → Draft Sync React → Draft
```

The package never mutates or publishes a Dayloom Archive. Pass the resulting Draft to `@dayloom/cli` with `--check` or `--dry-run` before publication.

```text
dayloom-draft-assistant init \
  --draft premise.md \
  --conversation .conversation \
  --llm-config llm.toml \
  --message "Build a mystery setting"
```

`plan`, `play`, and `revise` additionally require `--world <archive>`. See [`doc/DESIGN_V1.md`](./doc/DESIGN_V1.md) for the complete authority and persistence contract.
