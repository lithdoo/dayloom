# @dayloom/draft

Thin Dayloom-specific wrapper around Promptpile React for interactive Draft editing:

```text
@dayloom/draft
=
promptpile-react
+ Dayloom command policy
+ Dayloom business prompts
+ Dayloom MCP authority wiring
```

V1 is a single-turn primitive. It does not own Conversation, Session, or Agent Runtime state. See [`doc/DESIGN_DRAFT_V1.md`](./doc/DESIGN_DRAFT_V1.md).

## CLI

```bash
dayloom-draft [init|plan|play|revise] \
  --world <dir> \
  --draft <file> \
  --conversation <dir> \
  --llm-config <file> \
  --message <text> \
  --output-format terminal|stream-json
```

`--draft` may be repeated. `--draft-dir` is the mutually exclusive subtree form. Command is optional and is inferred only when exactly one of `init|plan|play|revise` is available for the current World.

World is mounted read-only. Draft write authority is exactly the `--draft` file set or the `--draft-dir` subtree. Generated Draft files are ordinary files and can be passed to `@dayloom/cli` without conversion.
