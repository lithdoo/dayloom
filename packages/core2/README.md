# @dayloom/core2

Archive V2-only Dayloom product lifecycle runtime. It classifies and validates the published World, owns Init, Planning, Play and Revise conversational Sessions (including ready and running cancellation), and publishes deterministic Settle and Abandon mutations. See the repository's `CORE2_FUNCTIONAL_COMPLETION_DRAFT.md` for the frozen contract.

## Promptpile React boundary

Core2 pins `promptpile-react@0.1.0-beta.4` and owns the complete integration topology for every conversational Session:

- immutable Dayloom context and writable Conversation remain the authoritative model layers;
- intermediate Thought, Observe, Check, and receipt artifacts stay inside a Session-owned `react-work` root;
- a shared, self-contained Observe handoff is the only per-invocation bridge into Final;
- Final never depends on raw Thought visibility and only a non-empty Final may complete a Core2 operation;
- the caller cannot configure `[promptpile-react]`, work paths, tools, or hooks; Core2 supplies an explicit empty Thought tool set;
- cancellation waits for the active child/operation to settle before terminal Session cleanup removes the enclosing work root.

React terminal success, Core2 acceptance, submission validation, and World publication are separate witnesses. Core2 consumes only Agent Event v1 and does not parse Promptpile React's private Completion Receipt.
