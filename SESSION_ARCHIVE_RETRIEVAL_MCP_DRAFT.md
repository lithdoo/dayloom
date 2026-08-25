# Session Archive Retrieval MCP — Frozen Implementation Design

Status: **FROZEN FOR IMPLEMENTATION (v1)**  
Date: 2026-08-25  
Scope: `@dayloom/core` Session runtime, Archive V2 read projection, Promptpile/React MCP integration, agent prompts  
Non-goal: no modification to `lithdoo/promptpile` source or Promptpile package internals

This document is the implementation contract for the first Archive Retrieval release. It replaces the earlier exploratory draft semantics.

After this freeze, implementation may tune local mechanics only when behavior remains equivalent. Changes to the frozen dependencies, authority model, archive visibility, runtime ownership, model-visible capabilities, React loop policy, hook/result contract, or lifecycle semantics require an explicit design revision rather than an ad-hoc implementation decision.

---

## 1. Frozen decisions

The v1 implementation MUST follow these decisions.

1. Every non-Init Session reasons against exactly one pinned `PublishedWorld` revision.
2. The model never sees the physical Archive V2 object/control store.
3. Core materializes a Session-scoped `archive-view` from verified documents in the pinned RootTree.
4. AI visibility is an explicit allowlist, not an implication of RootTree reachability.
5. The selected retrieval provider is exactly `@rustmcp/rust-mcp-filesystem@0.4.3`.
6. The Promptpile MCP bridge is exactly `promptpile-mcp@0.1.0-beta.3`.
7. Dayloom directly depends on `promptpile-protocol@0.1.0-beta.2` only for the public ToolCall/ToolResult artifact contract used by the hook boundary.
8. Core does not implement a second model tool-call protocol or MCP client.
9. `promptpile-mcp` owns MCP routing/execution; Core owns the Session lifecycle around it.
10. The stable Dayloom retrieval capability contract is:
    - directory listing;
    - bounded directory-tree orientation;
    - file/path search;
    - text-content keyword/regex search;
    - bounded text-range read.
11. For the frozen Rust provider those capabilities bind exactly to:
    - `list_directory`;
    - `directory_tree`;
    - `search_files`;
    - `search_files_content`;
    - `read_file_lines`.
12. General retrieval tools are available only to React Thought.
13. Observe consolidates evidence, Check decides sufficiency, and Final remains tool-free.
14. `send()` and `submit()` use the same Session-pinned retrieval runtime.
15. `REACT_MAX_STEPS = 10`; ten is a hard safety ceiling, not a target.
16. Settle remains deterministic Core behavior with no AI/MCP surface.
17. v1 keeps the current eager verified World context while MCP is introduced. Removing broad eager context is a later, independent optimization.
18. v1 materializes the archive view with ordinary file copies. Reflink/lazy projection is out of scope.
19. v1 exposes all Profile-valid, pinned `days/` documents that pass the AI-visible namespace policy.
20. Retrieval traces remain ephemeral Session runtime data; they are not added to durable World audit records in v1.
21. There is no runtime provider fallback. If the frozen dependency/platform Gate fails, release is blocked until the design is deliberately revised.

The end-to-end path is:

```text
pinned PublishedWorld
        |
        v
verified AI-visible archive-view
        |
        v
promptpile-mcp gateway
        |
        v
rust-mcp-filesystem (read-only)
        |
        v
Thought -> Observe -> Check -> [Thought ...] -> Final
                                            |
                                            v
                                      Dayloom Core
                                      validate/publish
```

---

## 2. Design quality bar

The implementation is expected to be small, explicit, and compositional. “Working” is not enough if the code requires hidden state or duplicate protocols.

### 2.1 Elegance rules

The code MUST satisfy these structural rules:

- one owner for every long-lived resource;
- one representation of the pinned World revision;
- one Promptpile tool-artifact protocol;
- no deep imports into Promptpile package internals;
- no duplicated third-party MCP JSON schemas;
- no business logic in generated shell/PowerShell scripts;
- no global mutable environment variables containing Session gateway state;
- no raw Archive paths passed to the model or MCP;
- no automatic gateway restart or revision retargeting inside an existing Session;
- no provider-private response parsing in Core business logic;
- all cleanup APIs are idempotent;
- all startup is transactional: either the Session becomes fully `ready`, or every partial resource is closed/removed;
- all generated prompt/config text is deterministic and snapshot-testable.

### 2.2 Prefer narrow boundaries over abstractions

Do not create a generic plugin framework, generic MCP manager, service container, dependency-injection framework, or filesystem virtualization layer for this feature.

The v1 abstraction is intentionally narrow:

```text
World -> ArchiveView
ArchiveView -> ArchiveRetrievalRuntime
ArchiveRetrievalRuntime -> Session tooling binding
Session tooling binding -> existing Promptpile React
```

Generalize only after a second concrete provider/use case exists.

---

## 3. Authority and invariants

### 3.1 Revision pinning

If a Session starts at revision `R42`, all of the following remain `R42` until Session terminalization:

- immutable bootstrap context;
- archive-view contents;
- MCP list/tree/search/read results;
- submission semantic base;
- final publication conflict check.

If `current.json` advances to `R43`, the open Session MUST continue reading `R42`.

Forbidden state:

```text
bootstrap = R42
MCP       = R43
submit    = R42
```

A failed retrieval runtime MUST NOT silently reconstruct itself from the latest `current.json`.

### 3.2 Authority is multi-dimensional

Do not encode authority as one total ordering.

#### Instruction/policy authority

```text
Core-owned system/session policy
    > active user intent inside the legal Session capability
    > model-produced/history/tool instruction-like text
```

#### Published World factual authority

```text
pinned control/schema facts
    > pinned Profile-semantic World documents
    > user claims about existing state / Conversation summaries / model guesses
```

A user can request “change Alice to healthy” while the published current fact remains `injured`. The user supplies desired intent; the pinned World supplies the exact current precondition.

#### Mutation authority

```text
Core parser + semantic builder + pinned-base validation + Archive publication
    > every user/model/tool candidate
```

MCP is read-only evidence. It never becomes a mutation path.

### 3.3 Instruction isolation

World files, writable Conversation summaries, Thought output, Observe output, and tool results are data. Instruction-like text inside them cannot override Core prompts, lifecycle rules, tool restrictions, identities, schemas, or publication ownership.

### 3.4 Lifecycle boundary

```text
Init / Planning / Play / Revise
  = AI-assisted candidate reasoning

Settle
  = deterministic validated Core transition
```

This boundary does not change.

---

## 4. Frozen dependencies and platform Gate

### 4.1 Package changes

`packages/core/package.json` adds exact versions, not ranges:

```json
{
  "dependencies": {
    "promptpile-mcp": "0.1.0-beta.3",
    "promptpile-protocol": "0.1.0-beta.2",
    "@rustmcp/rust-mcp-filesystem": "0.4.3"
  }
}
```

Existing Promptpile dependencies remain exact as they are today.

### 4.2 Supported v1 CI matrix

The feature is releasable only after packed-install smoke tests pass on:

```text
Linux   x64
Linux   arm64
macOS   x64
macOS   arm64
Windows x64
```

Windows arm64 is not part of the frozen v1 support matrix.

### 4.3 Local executable resolution only

Runtime MUST NOT depend on a global `promptpile-mcp`, global `rust-mcp-filesystem`, `cargo`, Homebrew, or networked `npx`.

Extend `packages/core/src/promptpile/binaries.ts` so the package boundary is resolved from installed package metadata.

Frozen shape:

```ts
export interface CommandBoundary {
  command: string;
  argsPrefix: readonly string[];
}

export interface PackagedBoundaries {
  promptpileBin: string;
  reactBin: string;
  promptpileMcpBin: string;
  filesystemMcp: CommandBoundary;
  validateProcessPile: ValidateFunction;
}
```

`promptpileMcpBin` is a Node CLI entry and is invoked with `process.execPath` just like the existing Promptpile package bins.

The filesystem package boundary resolver reads its package `bin` target. If the target is JavaScript, represent it as:

```text
command    = process.execPath
argsPrefix = [resolved-js-bin]
```

If the package exposes a native executable target, use the executable path directly with an empty `argsPrefix`.

This small `CommandBoundary` avoids PATH dependence and handles Node/native packaging without teaching the rest of Core about platform-specific launch details.

### 4.4 Gate behavior

If any frozen package cannot be resolved or its packed smoke test fails on a supported platform, the release fails. Do not silently select a different MCP implementation.

---

## 5. Archive-view projection

### 5.1 Visibility formula

Define one exported constant and one predicate in a new domain-side module:

```ts
export const AI_VISIBLE_WORLD_NAMESPACES_V1 = Object.freeze([
  'canon/',
  'state/',
  'characters/',
  'locations/',
  'arcs/',
  'memory/',
  'story-seeds/',
  'days/',
] as const);

export function isAiVisibleWorldPath(path: string): boolean;
```

An MCP-visible file is exactly:

```text
reachable from pinned RootTree
AND valid/readable under World Profile rules
AND matched by AI_VISIBLE_WORLD_NAMESPACES_V1
```

A future reachable namespace does not become visible automatically.

### 5.2 Module and API

Add:

```text
packages/core/src/world/archive-view.ts
```

Frozen public-to-Core API:

```ts
export interface ArchiveView {
  readonly root: string;
  readonly documentPaths: readonly string[];
}

export async function materializeArchiveView(input: {
  worldRoot: string;
  sessionRoot: string;
  world: PublishedWorld;
}): Promise<ArchiveView>;
```

Rules:

1. derive paths only from `world.tree`;
2. filter with the AI-visible predicate;
3. sort paths lexicographically for deterministic output;
4. read through existing verified Archive/Profile read helpers, never raw object-store traversal;
5. reject unsafe/non-regular/non-text material rather than guessing;
6. write ordinary copies under `<sessionRoot>/archive-view`;
7. preserve canonical logical paths;
8. never hard-link immutable Archive blobs;
9. file contents are UTF-8 bytes exactly corresponding to the verified pinned document;
10. on failure remove the incomplete archive-view before throwing.

v1 deliberately uses normal copies because the projection is Session-scoped, deterministic, cross-platform, and easy to test. Reflink/lazy optimization is deferred.

### 5.3 Filesystem containment

The provider root is exactly `<sessionRoot>/archive-view`.

Provider argv is frozen to read-only/no-roots mode:

```text
--allow-write false
--enable-roots false
<archive-view>
```

Do not maintain a brittle provider denylist of every non-Dayloom tool. Defense in depth is:

1. minimal archive projection;
2. provider read-only mode;
3. dynamic Roots disabled;
4. `promptpile-mcp` exact `allowed_tools` allowlist;
5. model sees only the exported five tools.

Core avoids symlinks in the projection. Escape/traversal/device/FIFO/socket behavior is tested at the provider boundary.

---

## 6. Retrieval runtime

### 6.1 Module split

Add exactly these runtime modules:

```text
packages/core/src/promptpile/archive-retrieval.ts
packages/core/src/promptpile/archive-retrieval-hook.ts
```

Responsibilities:

```text
archive-retrieval.ts
  lifecycle/config/gateway/tool export/trampoline generation

archive-retrieval-hook.ts
  one Thought after-hook execution
  ToolCall validation
  exec-calls invocation
  complete ToolResult publication/sanitization
```

Do not put World projection logic in either module; it belongs in `world/archive-view.ts`.

### 6.2 Runtime interface

Expose the smallest useful Session service:

```ts
export interface ArchiveRetrievalBinding {
  readonly toolsFile: string;
  readonly afterHookPath: string;
}

export interface ArchiveRetrievalRuntime {
  readonly binding: ArchiveRetrievalBinding;
  assertHealthy(): void;
  close(): Promise<void>;
}

export async function startArchiveRetrievalRuntime(input: {
  sessionId: string;
  sessionRoot: string;
  archiveView: ArchiveView;
  promptpileMcpBin: string;
  filesystemMcp: CommandBoundary;
  runner: ProcessRunner;
}): Promise<ArchiveRetrievalRuntime>;
```

Do not expose `gatewayChild`, token, port, or provider internals through `CoreSession`. They remain private implementation state of the runtime.

### 6.3 Runtime state machine

Internally the runtime has only:

```text
starting -> ready -> closing -> closed
     \        \
      -> failed <- unexpected gateway exit
```

Rules:

- only `ready` passes `assertHealthy()`;
- `close()` is idempotent from every state;
- no automatic restart;
- an unexpected gateway exit permanently marks this Session runtime `failed`;
- Core terminalizes the Session when a later foreground operation observes `failed`.

### 6.4 Frozen runtime constants

Put these in one location in `archive-retrieval.ts` and do not duplicate literals:

```ts
export const ARCHIVE_RETRIEVAL = Object.freeze({
  gatewayStartupTimeoutMs: 15_000,
  gatewayCloseGraceMs: 2_000,
  mcpInitTimeoutMs: 10_000,
  mcpListTimeoutMs: 10_000,
  toolCallTimeoutMs: 10_000,
  execRequestTimeoutMs: 25_000,
  retryMaxAttempts: 2,
  concurrency: 4,
  maxToolCallsPerThought: 4,
  maxToolResultLineBytes: 32 * 1024,
  portAttempts: 5,
});
```

`retryMaxAttempts = 2` means the initial attempt plus at most one retry.

Worst-case model-visible call count is therefore structurally bounded by:

```text
4 calls/Thought * 10 React steps = 40 calls/run
```

This is a ceiling, not an expected behavior target.

### 6.5 Session runtime files

Use deterministic paths:

```text
<session>/
  archive-view/
  retrieval/
    mcp.toml
    hook.json
    after-hook.sh      # POSIX
    after-hook.cmd     # Windows
  react/
    tools.toml
    ...existing prompt/config files
```

`mcp.toml` and `hook.json` contain the gateway token and MUST NOT be placed inside `archive-view`.

On POSIX create secret-bearing runtime files with owner-only permissions where supported. Never print the token in normal logs/events.

### 6.6 Gateway identity and port

`promptpile-mcp@0.1.0-beta.3` itself binds the gateway to `127.0.0.1`; Dayloom MUST rely on and test that frozen public behavior rather than invent an unsupported `[gateway].host` field.

Token generation:

```ts
randomBytes(32).toString('hex')
```

Port allocation algorithm:

1. bind a temporary Node server to `127.0.0.1:0`;
2. read the assigned ephemeral port;
3. close the temporary server;
4. launch `promptpile-mcp` on that port;
5. if startup fails because the port was raced, repeat up to `portAttempts`;
6. otherwise propagate the startup error.

The bearer token remains required even on loopback.

### 6.7 Frozen `mcp.toml`

Generate exactly the supported gateway fields:

```toml
version = 1

[gateway]
port = <selected-port>
token = "<random-token>"

[defaults]
init_timeout_ms = 10000
list_timeout_ms = 10000

[behavior]
failure_policy = "strict"
flat_names = true

[execution]
concurrency = 4
call_timeout_ms = 10000
failure_policy = "fail_fast"
retry_max_attempts = 2
retry_base_delay_ms = 250
retry_safe_tools = [
  "list_directory",
  "directory_tree",
  "search_files",
  "search_files_content",
  "read_file_lines",
]

[servers.archive]
command = "<filesystemMcp.command>"
args = [
  <filesystemMcp.argsPrefix...>,
  "--allow-write", "false",
  "--enable-roots", "false",
  "<archive-view>"
]
allowed_tools = [
  "list_directory",
  "directory_tree",
  "search_files",
  "search_files_content",
  "read_file_lines",
]
```

Unknown gateway fields MUST NOT be added; the frozen Promptpile MCP config parser rejects them.

### 6.8 Gateway startup/readiness

Launch the long-lived gateway with Node directly:

```text
process.execPath <promptpileMcpBin> launch --config <mcp.toml>
```

Do not use the existing wait-for-exit `ProcessRunner` for the long-lived gateway.

Readiness uses one mechanism only: repeatedly invoke public `promptpile-mcp export-tools --base-url ... --token ... -o <toolsFile>` through the existing `ProcessRunner` until it succeeds or the startup deadline expires.

On success:

1. `react/tools.toml` exists;
2. parse it and verify that exactly the selected five provider tool names are exported;
3. only then mark runtime `ready`.

If the gateway child exits before readiness, fail immediately with a bounded stderr diagnostic.

### 6.9 Gateway shutdown

`close()`:

1. marks runtime `closing`;
2. sends graceful termination to the gateway;
3. waits up to `gatewayCloseGraceMs` for exit so `promptpile-mcp` can dispose the upstream MCP session;
4. force-kills only if still alive;
5. marks `closed` regardless of repeated `close()` calls.

Cleanup of Session files happens only after retrieval runtime close has completed.

---

## 7. Closed-loop after-hook contract

This is the most important implementation boundary after revision pinning.

### 7.1 Keep generated scripts stupid

Do not implement parsing, MCP execution, truncation, or error recovery in bash/PowerShell.

`archive-retrieval-hook.ts` compiles to a packaged Node program containing all behavior and unit-testable logic.

The Session generates only a tiny trampoline:

POSIX concept:

```sh
#!/bin/sh
exec "<process.execPath>" "<packaged-hook-runner.js>" "<session>/retrieval/hook.json"
```

Windows concept:

```bat
@echo off
"<process.execPath>" "<packaged-hook-runner.js>" "<session>\retrieval\hook.json"
exit /b %errorlevel%
```

The generator MUST correctly escape paths for the target shell. No Session business logic belongs in these files.

### 7.2 Hook configuration

`hook.json` is versioned:

```ts
interface ArchiveRetrievalHookConfigV1 {
  version: 1;
  promptpileMcpBin: string;
  baseUrl: string;
  token: string;
  execRequestTimeoutMs: number;
  maxToolCallsPerThought: number;
  maxToolResultLineBytes: number;
  allowedToolNames: readonly string[];
}
```

Validate this file strictly before doing work.

### 7.3 Exact input path

When `PROMPTPILE_HAS_TOOL_CALLS !== "1"`, exit successfully without work.

When it is `"1"`, use only:

```text
PROMPTPILE_ASSISTANT_CALL_FILE
```

Do not scan a directory and do not fall back to “latest” calls artifacts.

The path must be an absolute regular `.calls.jsonl` file inside the current Promptpile work directory.

### 7.4 ToolCall validation

Parse calls with the public `promptpile-protocol` ToolCall V1 contract.

Before execution enforce:

- at least one call;
- no more than `maxToolCallsPerThought` (4);
- unique call IDs;
- every function name is one of the frozen five exported tools;
- arguments remain opaque JSON strings for Promptpile/MCP to validate; Dayloom does not duplicate provider schemas.

If the model somehow emits too many calls or a non-allowed name, do not execute them. Publish one complete error ToolResult per call and return success so Observe receives explicit failure evidence.

### 7.5 Execution

Invoke the exact frozen public CLI:

```text
process.execPath <promptpileMcpBin>
  exec-calls
  --base-url <baseUrl>
  --token <token>
  --input <exact calls file>
  --timeout-ms <execRequestTimeoutMs>
```

The `--timeout-ms` spelling is part of `promptpile-mcp@0.1.0-beta.3` and is covered by packed integration tests.

### 7.6 The complete-result invariant

The hook owns this invariant:

> If `PROMPTPILE_HAS_TOOL_CALLS=1` and the Dayloom hook exits `0`, the paired result artifact contains exactly one valid ToolResult line for every ToolCall, in the same order.

This is the closed loop.

After `exec-calls` returns:

#### Success path

1. locate the paired `.result.jsonl` deterministically from the exact calls filename;
2. parse every line with the public ToolResult V1 contract;
3. verify IDs form a complete one-to-one ordered vector against the calls;
4. preserve unknown/extra Promptpile metadata fields;
5. enforce the serialized line byte limit;
6. atomically rewrite only if sanitization is needed;
7. exit `0`.

#### Operational failure path

If `exec-calls` exits nonzero or no complete valid result vector exists:

1. do **not** retry outside `promptpile-mcp`;
2. because all allowed tools are read-only, treat execution status uncertainty as retrieval failure rather than a side-effect hazard;
3. atomically publish one synthetic ToolResult per call with content such as:

```text
[DAYLOOM_RETRIEVAL_ERROR]
Archive retrieval failed for this tool call. Treat the requested information as unresolved and do not invent it.
```

4. preserve the tool call ID and tool name;
5. exit `0` once the complete error vector is durable.

This converts normal gateway/MCP failures into explicit evidence that Observe can reason about, avoiding the current Promptpile after-hook warning gap without modifying Promptpile.

The hook exits nonzero only for catastrophic local failures where it cannot establish the complete-result invariant, for example:

- calls artifact cannot be parsed safely;
- paired result path cannot be derived;
- result artifact cannot be written atomically;
- hook configuration is invalid.

These cases may still be surfaced by Promptpile as after-hook warnings under its current public behavior; they are treated as infrastructure defects and covered by integration tests.

### 7.7 Result byte bound

Each serialized ToolResult JSONL line MUST be `<= 32 KiB` UTF-8 after sanitization.

When content is too large, preserve a bounded UTF-8 prefix and append:

```text
[DAYLOOM_TOOL_RESULT_TRUNCATED]
Result exceeded the Dayloom tool-result limit. Narrow the path, query, glob, or requested line range.
```

Truncation MUST preserve valid UTF-8 and a valid ToolResult artifact. Silent truncation is forbidden.

Do not parse provider-private search result schemas merely to count matches.

### 7.8 Atomic result publication

All Dayloom-created/rewritten result artifacts use:

```text
same-directory temporary file
-> fsync/close where practical
-> atomic rename over target
```

Never expose a partially written `.result.jsonl` to the next Promptpile phase.

---

## 8. Core Session integration

### 8.1 Aggregate Session ownership

Avoid parallel nullable fields that can drift apart.

Refactor the Core-owned active Session into one aggregate:

```ts
interface ActiveSessionRuntime {
  readonly workspace: CoreSession;
  readonly retrieval: ArchiveRetrievalRuntime | null;
}

private activeSession: ActiveSessionRuntime | null = null;
```

`retrieval === null` is valid only for Init.

`sessionStatus` may remain a separate projection used by public state/events, but resource ownership lives in the aggregate above.

Do not place the long-lived gateway in `activeChild`.

```text
activeChild
  = one transient foreground Promptpile/compress/React process

activeSession.retrieval
  = Session service surviving multiple foreground operations
```

### 8.2 Transactional `startSession`

For non-Init Sessions the exact sequence is:

```text
validate lifecycle availability
  -> allocate session id/root
  -> materialize pinned archive-view
  -> start ArchiveRetrievalRuntime
  -> create Session workspace/prompts using retrieval.binding
  -> write derived React configs
  -> append immutable bootstrap context
  -> install ActiveSessionRuntime
  -> project status=ready
```

Do not assign `this.activeSession` until every preceding step succeeds.

Failure unwind order:

```text
retrieval.close() if created
  -> remove session root
  -> leave Core with no active Session
```

This guarantees there is no externally observable half-ready Session.

### 8.3 Workspace tooling binding

Do not let `createSessionWorkspace()` always overwrite `react/tools.toml` with `tools = []`.

Introduce a narrow optional input:

```ts
export interface SessionToolingBinding {
  readonly toolsFile: string;
  readonly afterHookPath: string;
}
```

For Init:

- no binding;
- workspace writes its empty tools file;
- React config contains no after-hook.

For Planning/Play/Revise:

- retrieval runtime owns the exported tools file;
- workspace reuses that exact path;
- derived React config sets both `tools_file` and `after_hook`.

`readCallerConfig()` continues forbidding caller control over `tools_file` and `after_hook`.

### 8.4 `writeDerivedConfigs`

Refactor the function around a typed path object rather than adding loose positional fields.

Conceptual frozen shape:

```ts
interface DerivedReactPaths {
  thoughtPrompt: string;
  observePrompt: string;
  toolsFile: string;
  afterHookPath?: string;
  sendFinalPrompt: string;
  submitFinalPrompt: string;
  sendConfig: string;
  submitConfig: string;
  summaryConfig: string;
}
```

The derived `[promptpile-react]` table:

```ts
{
  tools_file,
  thought_prompt,
  observe_prompt,
  final_prompt,
  ...(afterHookPath ? { after_hook: afterHookPath } : {})
}
```

No caller-provided value can override these Core-owned fields.

### 8.5 Foreground `send()` / `submit()`

Before starting append/compress/React for a non-Init Session:

```ts
activeSession.retrieval?.assertHealthy();
```

If unhealthy:

- map to `AGENT_FAILED`;
- terminalize the Session;
- do not attempt transparent gateway restart.

During a React run, normal retrieval failures are converted into ToolResult error data by the hook and therefore flow through Observe/Check normally.

### 8.6 Terminalization

`terminalize()` operates on the aggregate and is the only normal Session resource teardown path.

Frozen order:

```text
detach activeSession/status from externally available Core state
  -> wait for current foreground operation according to existing cancel semantics
  -> retrieval.close()
  -> remove Session root
```

If both close and filesystem cleanup fail, retain the first error as primary and attach/log bounded secondary diagnostics; do not skip later cleanup attempts.

### 8.7 Dispose

`dispose()` remains idempotent.

It must:

1. mark Core disposed;
2. kill current foreground child according to existing semantics;
3. wait for in-flight foreground operation/cancel settlement;
4. close the active Session retrieval runtime if any;
5. remove the Core runtime root;
6. never emit events after disposal.

---

## 9. Error model

Do not add a large new public error taxonomy.

Add one internal error class:

```ts
class ArchiveRetrievalError extends Error {
  constructor(
    readonly stage: 'projection' | 'startup' | 'tools' | 'hook' | 'runtime',
    message: string,
    options?: ErrorOptions,
  ) { ... }
}
```

Core maps retrieval infrastructure failures to the already-existing public `AGENT_FAILED` result where the failure occurs during Session start/send/submit.

Dependency resolution failure during `createDayloomCore()` remains `CoreInitializationError('INTERNAL_ERROR', ...)` because the packaged runtime itself is incomplete.

Tool-level retrieval failures are not Core operation errors; they are ToolResult evidence and become `[RETRIEVAL_STATUS] blocked/needs-more` in Observe.

Do not call `recoverWorldState()` merely because read-only MCP failed. World state was not mutated.

---

## 10. React loop and Process Pile

### 10.1 Max steps

Change exactly:

```ts
const REACT_MAX_STEPS = 10;
```

The existing reducer is already written around runtime `max_steps` and multiple step indices; extend tests rather than redesigning the Process Pile protocol.

The caller cannot override this v1 limit.

Expected operation:

```text
simple/no retrieval  1-2 steps
normal retrieval     2-4 steps
complex retrieval    4-7 steps
hard ceiling         10 steps
```

### 10.2 Check termination

Check continues only when all are true:

1. a material question remains unresolved;
2. currently available retrieval can probably answer it;
3. the answer would materially improve Final/submission correctness.

Stop when evidence is sufficient, uncertainty is immaterial, user clarification is required, retrieval is blocked, or another call would just reconfirm known information.

Prefer stopping over redundant confirmation.

---

## 11. Prompt implementation

### 11.1 Code organization

Use:

```text
packages/core/src/session/prompts/
  common.ts
  archive.ts
  init.ts
  planning.ts
  play.ts
  revise.ts
  observe.ts
  final.ts
```

Concrete Promptpile files remain the existing:

```text
react/thought.md
react/observe.md
react/final-send.md
react/final-submit.md
```

The refactor is internal to Core.

### 11.2 Composition

Thought is built from:

```text
DAYLOOM_AGENT_POLICY
+ WORLD_ARCHIVE_GUIDE (non-Init only)
+ SESSION_ROLE
+ THOUGHT/RETRIEVAL_POLICY
```

Observe is one shared retrieval-aware handoff prompt.

Final combines the relevant Session role constraints with either ordinary-send or submit output contract.

All builders are pure deterministic functions/constant composition; no filesystem or runtime state lookup occurs while building prompt text.

### 11.3 Session roles

Frozen roles:

```text
Init     = Collaborative World Designer
Planning = Day Planner for one pinned target Day
Play     = Interactive Narrative Runtime for the pinned plan
Revise   = Semantic World Editor
Settle   = no agent
```

### 11.4 Namespace guide

Prompt teaches semantics, never the current dynamic tree:

- `canon/`: premise/rules/style/user role interpretation data;
- `state/`: current global published state/progress/variables;
- `characters/`: character profile/state/relationships/location/tags;
- `locations/`: location profile/status/tags/triggers;
- `arcs/`: long-running narrative status/stage;
- `memory/`: pinned persisted World facts/memory, distinct from Conversation summaries;
- `story-seeds/`: possible future narrative material, not established fact;
- `days/`: published plans/events/evidence/summaries; settled history is immutable and current plan is authoritative for Play.

MCP reveals what files actually exist.

### 11.5 Retrieval policy

Teach one progressive policy:

```text
known directory      -> list_directory
known path pattern   -> search_files
need to locate fact  -> search_files_content
found a hit          -> read_file_lines around the hit
unknown structure    -> bounded directory_tree, then narrow
```

Do not mechanically enumerate the root. Do not reread facts already established in the current React run. Retrieve exact IDs/current values/history when correctness depends on them.

### 11.6 Observe contract

Use exactly these sections:

```text
[SESSION]
[USER_INTENT]
[RETRIEVAL_STATUS]
[AUTHORITATIVE_FACTS]
[RETRIEVAL_EVIDENCE]
[EXACT_IDS]
[DECISIONS]
[CONSTRAINTS]
[UNRESOLVED]
[NEXT_RETRIEVAL]
[FINAL_CONTRACT]
```

`RETRIEVAL_STATUS` is exactly one of:

```text
sufficient
needs-more
blocked
```

Tool error/truncation markers are evidence of incomplete retrieval, never World facts.

### 11.7 Final discipline

```text
Thought = investigate/retrieve
Observe = consolidate evidence/unresolved state
Check   = decide sufficiency
Final   = render
```

Final never receives general tools and never solves a fact marked unresolved by inventing it.

### 11.8 v1 eager-context decision

Do not remove or shrink the current `VERIFIED_WORLD_DOCUMENTS` injection in the same implementation.

This v1 change is retrieval-enablement, not context-removal.

Once the frozen implementation passes behavior tests, broad eager context reduction can be proposed separately with its own equivalence measurements.

---

## 12. Implementation sequence

Implement in this order so every merge step has a closed testable boundary.

### Step 1 — package boundaries

- add exact dependencies;
- extend packaged binary resolution;
- add packed smoke tests for all frozen package bins/commands.

Exit criterion: Core can resolve all boundaries locally with no PATH/network assumptions.

### Step 2 — archive projection

- add `world/archive-view.ts`;
- add deterministic projection/path/containment tests.

Exit criterion: fixture World produces exactly the expected copied visible tree and never exposes control/private/unreachable paths.

### Step 3 — retrieval runtime

- add gateway config, port/token, launch/readiness, live tool export, state machine, idempotent close.

Exit criterion: a test Session can start one gateway, discover exactly five tools, survive multiple checks, and close with no child leak.

### Step 4 — closed-loop hook

- add packaged Node hook runner;
- add POSIX/Windows trampoline generation;
- add call-count/name validation, `exec-calls`, complete error-vector fallback, byte sanitizer, atomic result writes.

Exit criterion: for every non-catastrophic execution outcome, `HAS_TOOL_CALLS=1 + hook exit 0` implies a complete valid ToolResult vector.

### Step 5 — Session workspace/config binding

- introduce `SessionToolingBinding`;
- stop overwriting exported tools for non-Init Sessions;
- set `after_hook` only for retrieval-enabled Sessions;
- keep Init tool-free.

Exit criterion: generated send/submit configs point to the same Session tools/hook and caller config cannot override them.

### Step 6 — Core ownership refactor

- replace split Session/retrieval ownership with `ActiveSessionRuntime`;
- transactional start;
- health assertion before foreground agent work;
- ordered terminalize/dispose.

Exit criterion: every start/cancel/submit/failure path leaves either one valid active aggregate or no active Session, never half-owned resources.

### Step 7 — React + prompts

- set max steps to 10;
- refactor prompt components;
- add Observe/Check retrieval behavior.

Exit criterion: Process Pile tests cover 1, 2, 4, and 10-step valid sequences and prompt snapshots are stable.

### Step 8 — end-to-end/pack CI

- run real Promptpile -> `promptpile-mcp` -> Rust MCP -> result artifact -> Observe -> Final flows;
- run supported platform packed-install smoke matrix.

Exit criterion: all frozen acceptance criteria below pass from packed artifacts, not only monorepo source paths.

Do not begin eager-context reduction as part of these steps.

---

## 13. Required tests

### 13.1 Archive/security

MUST test:

- only allowlisted namespaces appear;
- unreachable blobs never appear;
- control-plane paths never appear;
- canonical logical paths are preserved;
- copies equal verified pinned bytes;
- hardlinks are not used;
- traversal/absolute escape fails;
- symlink escape fails;
- provider is read-only and Roots cannot retarget it;
- Session pinned to R42 still reads R42 after current becomes R43.

### 13.2 Dependency/runtime

MUST test:

- exact local package versions resolve;
- no global PATH dependency;
- gateway token is required;
- loopback binding only;
- port race retry;
- strict startup on missing provider/tool;
- exact five tools exported;
- unexpected gateway exit marks runtime failed;
- close is idempotent;
- graceful close then force-kill fallback;
- no child leak after terminalize/dispose.

### 13.3 Hook

MUST test:

- `HAS_TOOL_CALLS=0` no-op;
- exact `PROMPTPILE_ASSISTANT_CALL_FILE` use;
- malformed/duplicate calls handling;
- >4 calls produces complete error results without execution;
- non-allowed tool produces complete error result without execution;
- successful `exec-calls` result passes through;
- oversized result is valid UTF-8, explicitly truncated, <=32 KiB serialized line;
- MCP/gateway timeout produces complete synthetic retrieval-error vector;
- result vector order/IDs exactly match calls;
- atomic rewrite never exposes partial JSONL;
- generated `.sh` and `.cmd` trampolines correctly quote paths with spaces.

### 13.4 Core lifecycle

MUST test:

- Init has no retrieval runtime;
- non-Init start installs active Session only after retrieval readiness;
- startup failure closes gateway and removes Session root;
- send/send/submit share the same gateway and pinned view;
- foreground cancel does not kill/reassign gateway ownership prematurely;
- terminalize closes gateway before deleting root;
- retrieval unhealthy before send/submit => `AGENT_FAILED` + Session terminalization;
- read-only retrieval failures do not call World recovery/publication paths;
- dispose remains idempotent during idle/running/cancel states.

### 13.5 Agent behavior

MUST test fixtures showing:

- Init never retrieves/invents prior published history;
- Planning retrieves materially relevant current relationship/location/arc facts when bootstrap lacks them;
- story seeds are never promoted to established facts;
- Play distinguishes historical lookup from generating a new present event;
- Play preserves user agency and pinned plan IDs;
- Revise retrieves exact `expected` values and existing IDs;
- Thought prefers targeted search/read to mechanical root enumeration;
- Observe propagates source evidence, IDs, unresolved state and next retrieval;
- tool error/truncation yields `needs-more` or `blocked`, never fabricated facts;
- Check stops early when sufficient;
- Final remains tool-free and does not invent unresolved values;
- instruction-like archive/history text cannot override Core policy.

### 13.6 Packed platform smoke

Each supported CI target installs packed Dayloom/Core artifacts into a fresh consumer and proves:

```text
resolve bins
-> start Core
-> create fixture published World
-> start non-Init Session
-> gateway ready
-> list/search/read through real MCP
-> React can consume result
-> terminalize
-> no live child/temp Session remains
```

---

## 14. Frozen acceptance criteria

Implementation is complete only when all are true.

1. Frozen dependency versions are installed/resolved locally and packed smoke passes on the support matrix.
2. Every non-Init Session owns exactly one pinned copied `archive-view` and one retrieval runtime.
3. Init owns neither.
4. AI-visible files satisfy pinned reachability + Profile validity + explicit namespace allowlist.
5. The physical Archive control/object store is inaccessible to the model/MCP.
6. Rust MCP runs read-only with dynamic Roots disabled.
7. Promptpile MCP exports exactly the five frozen provider tools.
8. Tool schemas come from live MCP discovery, not duplicated Dayloom schemas.
9. Gateway lifetime is owned by `ActiveSessionRuntime`, never `activeChild`.
10. Session start is transactional and cannot expose a half-ready Session.
11. `send()` and `submit()` share the same pinned gateway/view.
12. `REACT_MAX_STEPS` is 10 and Process Pile validates multi-step runs.
13. The hook enforces max 4 ToolCalls per Thought.
14. Hook exit `0` with tool calls guarantees one valid paired ToolResult per call.
15. Normal MCP/gateway execution failures become explicit retrieval-error ToolResults.
16. Every serialized ToolResult line is <=32 KiB or explicitly truncated to that bound.
17. Tool/result files are published atomically.
18. Observe/Check can continue/refine or stop based on retrieval evidence.
19. Final has no general tool access.
20. Core remains sole mutation validator/publisher.
21. No retrieval failure can directly alter published World state.
22. Gateway unexpected exit is never repaired by retargeting/restarting against another revision.
23. Terminalize/dispose close retrieval before deleting Session resources and are idempotent.
24. Existing eager verified context remains intact in v1.
25. Retrieval traces remain ephemeral.
26. Prompt components are deterministic, shared, and tested.
27. No Promptpile source change or deep import is required.
28. No runtime global install, network fetch, Cargo, shell search path, or provider fallback is required.

When these criteria pass, this design is considered implemented. Remaining ideas below are explicitly post-v1 and do not block the frozen implementation.

---

## 15. Post-v1 ideas — not implementation blockers

The following are intentionally excluded from v1:

- reducing/removing broad eager `VERIFIED_WORLD_DOCUMENTS` injection;
- lazy/reflink archive-view projection;
- narrower historical-day visibility policies;
- durable retrieval audit traces;
- dynamic provider selection/fallback;
- multiple MCP providers in one Session;
- changing the five retrieval capability contract;
- caller-configurable max-step/tool budgets;
- Promptpile changes for globally fatal after-hook propagation;
- write-capable MCP or candidate-file editing.

Each requires a separate design change after production behavior is measured.

---

## Appendix A — Why the frozen provider is acceptable

`@rustmcp/rust-mcp-filesystem@0.4.3` provides the required listing/path search/content search/ranged read capabilities, is read-only by default, supports explicit `--allow-write false`, keeps dynamic Roots disabled by default and exposes CLI control for them, and is distributed as an npm convenience package around the Rust binary.

The v1 design does not trust provider defaults alone: the provider is explicitly launched read-only/no-roots, rooted only at the copied Session projection, and sits behind the exact `promptpile-mcp` tool allowlist.

## Appendix B — Why `max-step = 10`

Ten is a hard agent-loop safety ceiling. It is intentionally generous enough for multi-hop `search -> read -> refine` while Check is instructed and tested to stop much earlier.

A Dayloom outer step is heavier than a simple framework turn because it contains Thought, optional tool execution, Observe and Check. Operational tuning should improve early stopping rather than raise the frozen cap.
