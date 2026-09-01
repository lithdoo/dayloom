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

## Output and completion

Dialogue always runs internally as Promptpile React `stream-json`:

- `--output-format terminal` prints only the approved Final reply;
- `--output-format stream-json` forwards the native Agent Event JSONL;
- Draft Sync output remains private and never enters stdout.

Exit code 0 means Dialogue and Draft Sync both completed and the granted Draft authority contains at least one non-empty, valid UTF-8 artifact. A prose-only Sync or a missing Draft fails closed with `DRAFT_SYNC_FAILED`.

## Package boundary

The runtime does not depend on sibling product packages `@dayloom/draft` or `@dayloom/cli`. The package resolves Promptpile binaries from its own dependency tree and exposes one runtime API:

```js
import { executeDraftAssistantV1 } from '@dayloom/draft-assistant';
```

## Diagnostics

React subprocesses run inside operation-local phase directories. `PROMPTPILE_DUMP_LLM=1` therefore writes request/response diagnostics outside the caller's working directory and normal execution cleans them up. Set `PROMPTPILE_REACT_DEBUG=1` to preserve the complete successful or failed operation directory; its path is written to stderr.
