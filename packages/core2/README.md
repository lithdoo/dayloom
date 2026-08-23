# @dayloom/core2

Archive V2-only Dayloom product lifecycle runtime. It classifies and validates the published World, owns Init, Planning, Play and Revise conversational Sessions (including ready and running cancellation), and publishes deterministic Settle and Abandon mutations. See the repository's `CORE2_FUNCTIONAL_COMPLETION_DRAFT.md` for the frozen contract.

Core2 now persists World Profile V1: canon, world/calendar/variable state, characters and relationships, locations and triggers, arcs, memory, story seeds, structured day events, settlement projections, visible Session audit, and typed revisions. Play records proposed facts; one atomic Settle commit applies validated patches and updates state, memory, timelines, summary, diary, settlement evidence, and the next-day seed.

Legacy filesystem Worlds migrate explicitly and read-only:

```sh
dayloom-core2 archive migrate-world-profile-v1 --source ./old-world --target ./archive-v2-world
```

The migration publishes one Profile V1 initial revision, writes `legacy/migration-report.json`, accounts for every portable UTF-8 source file exactly once, preserves unknown files, and validates the resulting Published World before returning success.

## Promptpile React boundary

Core2 pins `promptpile-react@0.1.0-beta.5` and exposes one `CoreEvent` v1 boundary. It consumes the ordered Process Pile v1 on FD3 and projects Thought, Observe, Check, and Final as live application events.

Create the runtime without a protocol selector:

```ts
const core = await createDayloomCore({
  worldRoot,
  llmConfigPath,
});
```

Every `send` or `submit` receives an independent `operationId`. Work events carry a temporary `workPath` for presentation only; Core2 never creates, reads, persists, or deletes that directory. Promptpile React owns it under its default cleanup lifecycle. The path may be displayed while the operation is live and must be considered expired at operation terminal.

Core2 owns the remaining integration invariants:

- immutable Dayloom context and writable Conversation remain the authoritative model layers;
- intermediate Thought, Observe, Check, and receipt artifacts remain React-owned temporary data;
- a shared, self-contained Observe handoff is the only per-invocation bridge into Final;
- Final never depends on raw Thought visibility and only a non-empty Final may complete a Core2 operation;
- the caller cannot configure `[promptpile-react]`, work paths, tools, or hooks; Core2 supplies an explicit empty Thought tool set;
- cancellation invalidates late event projection and waits for child plus FD3 drain;
- `output.completed` is emitted only after a valid Process Pile terminal, EOF, matching Final, and child exit 0;
- process text, IDs, and paths never enter Conversation, Archive, World, receipts, or exported transcript.

React terminal success, Core2 acceptance, submission validation, and World publication remain separate witnesses. Core2 does not parse Promptpile React's private Completion Receipt or inspect its temporary files.
