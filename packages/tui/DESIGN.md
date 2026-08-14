# @dayloom/tui design

> Status: implemented
>
> Core2 acceptance baseline: `64dc4c5521c320db79859b91c1c15f6fcbdab503`

## Boundary

```text
@dayloom/core2 public contract
  → TUI-owned projection driver
  → ViewModel
  → existing BindTTY components
```

Core2 owns World/Session truth, capabilities, publication, active-agent cancellation and terminal business results. The driver owns Hub/Session projection, product vocabulary, one current presentation transcript, local status/help, selection, pending feedback and recent results. ViewModel/components own input history, focus, scroll and viewport layout.

Production creates exactly one Core through `createDayloomCore({ worldRoot, llmConfigPath })`. It imports only `@dayloom/core2`. Tests use a non-package-root seam accepting the exact `DayloomCore` interface; there is no backend abstraction or compatibility facade.

## Pages and temporal authority

There are only Hub and Session pages. `state.changed` synchronizes facts but never installs or removes a presentation page by itself. The Promise/CoreResult of `startSession`, `submit` or `cancel`, followed by a final `core.getState()`, owns the corresponding presentation boundary.

Every Session request carries its originating session id. Stale results and deltas cannot write into a newer presentation. A terminal failure may retain a presentation-only `failed` transcript after Core2 has terminalized its Session; dismissing that transcript is local and does not call `core.cancel()` or rewrite the failure as cancellation.

## Hub

Business legality comes only from `CoreState.capabilities`. TUI vocabulary maps `daily` to `startSession('planning')`. Stable order is:

```text
init → daily → revise → play → settle → abandon-day → status → help → quit
```

A pending Hub request freezes visible actions and selection until the Core call settles, preventing capability-transition flicker without becoming a second legality authority.

## Session and transcript

Ordinary ready text is appended locally once and sent through `core.send()` once. `output.delta` events for the current request aggregate into one streaming assistant message. Partial output is retained on failure.

Controls derive from Core capabilities plus the two presentation-only states:

```text
ready       input / submit / cancel from Core capabilities
running     only high-priority cancel
cancelling  disabled
submitting  disabled
failed      only local dismiss
```

Running `/exit` or `/cancel` marks local cancellation suppression before calling Core2. Interrupted send `CANCELLED` never creates a failure page; the cancel result owns the final transition. If cancel fails while the same Core Session remains active, suppression is undone and future deltas resume.

Only one transcript exists. It is discarded on terminal success/cancel, failed dismiss, new Session and dispose. Limits are 500 whole messages and 250,000 text characters; the current streaming message and newest message are never truncated.

## Resource closure

Driver dispose is idempotent: it stops emits, unsubscribes, clears transcript/presentation state, then awaits `core.dispose()`. Core2 owns child kill, provider drain, interrupt completion and runtime workspace removal. Diagnostics record state, ids, lengths and result codes, never full conversation text or secrets.
