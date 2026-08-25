# Session Archive Retrieval MCP — Frozen Implementation Design

Status: **FROZEN FOR IMPLEMENTATION (v1)**  
Date: 2026-08-25  
Scope: `@dayloom/core` Session runtime, Archive V2 read projection, Promptpile/React MCP integration, agent prompts  
Non-goal: no modification to `lithdoo/promptpile` source or Promptpile package internals

Implementation compatibility revision (2026-08-25): the frozen Rust 0.4.3 CLI exposes
`--allow-write` and `--enable-roots` as presence-only enable flags; passing a literal
`false` is parsed as an allowed directory rather than a boolean value. The equivalent
fail-closed launch contract is therefore explicit `ALLOW_WRITE=false` and
`ENABLE_ROOTS=false` server environment plus omission of both enable flags. The server
working directory is the copied `archive-view`, so model-visible relative paths remain
inside the projection without revealing a physical Session path. This revision changes
only the executable spelling; provider, capabilities, defaults, containment, and security
semantics remain frozen and are verified by real packed/runtime tests.

Session authoring compatibility revision (2026-08-25):
`SESSION_MARKDOWN_DRAFT_SUBMIT_DESIGN_DRAFT.md` and the normative
`doc/contracts/SESSION_SUBMISSION_V1.md` introduce write-capable Draft and Candidate
servers as a separate Session File Runtime capability. This explicitly revises the
post-v1 exclusion in §16 without changing Archive Retrieval v1: the `archive` server,
pinned projection, five read tools, evidence rules, hook closure, Final guard and
publication authority remain exactly frozen. Write capability is never added to the
Archive root; it is confined to separate Core-owned workspace roots, namespaced tools
and operation-scoped policies. Any implementation that merely sets `ALLOW_WRITE=true`
on the Archive Retrieval server violates both frozen contracts.

This document is the implementation contract for the first Archive Retrieval release. It replaces the earlier exploratory draft semantics.

After this freeze, implementation may tune local mechanics only when behavior remains equivalent. Changes to the frozen dependencies, authority model, archive visibility, runtime ownership, model-visible capabilities, React loop policy, hook/result contract, final integrity guard, or lifecycle semantics require an explicit design revision rather than an ad-hoc implementation decision.

---

## 1. Frozen decisions

The v1 implementation MUST follow these decisions.

1. Every non-Init Session reasons against exactly one pinned `PublishedWorld` revision.
2. The model never sees the physical Archive V2 object/control store.
3. Core materializes a Session-scoped `archive-view` from verified documents in the pinned RootTree.
4. AI visibility is an explicit allowlist, not an implication of RootTree reachability.
5. The selected retrieval provider is exactly `@rustmcp/rust-mcp-filesystem@0.4.3`.
6. The Promptpile MCP bridge is exactly `promptpile-mcp@0.1.0-beta.3`.
7. Dayloom directly depends on `promptpile-protocol@0.1.0-beta.2` only through one Core artifact-contract adapter.
8. Core does not implement a second model tool-call protocol or MCP client.
9. `promptpile-mcp` owns MCP routing/execution; Core owns the Session lifecycle and integrity boundaries around it.
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
16. The hook converts all non-catastrophic MCP execution failures into complete explicit ToolResult evidence.
17. Before Final is allowed to start, Core independently verifies retrieval-runtime health and complete ToolCall/ToolResult closure for the current React work directory.
18. Settle remains deterministic Core behavior with no AI/MCP surface.
19. v1 keeps the current eager verified World context while MCP is introduced. Removing broad eager context is a later, independent optimization.
20. v1 materializes the archive view with ordinary file copies. Reflink/lazy projection is out of scope.
21. v1 exposes all Profile-valid, pinned `days/` documents that pass the AI-visible namespace policy.
22. Retrieval traces remain ephemeral Session runtime data; they are not added to durable World audit records in v1.
23. There is no runtime provider fallback. If the frozen dependency/platform Gate fails, release is blocked until the design is deliberately revised.
24. Runtime startup deadlines MUST be executable constraints, not documentation-only constants.
25. Session resource ownership and public Session state derive from one active aggregate plus one phase value; Core does not keep duplicate Session id/kind state.

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
Thought -> hook -> ToolResult -> Observe -> Check -> [Thought ...]
        |                                         |
        +-----------------------------------------+
                                                  v
                                           work.ready
                                                  |
                                                  v
                                  Core retrieval-integrity guard
                                  - runtime healthy
                                  - complete paired results
                                                  |
                                                  v
                                                Final
                                                  |
                                                  v
                                          Dayloom Core
                                          validate/publish
```

---

## 2. Design quality bar

The implementation is expected to be small, explicit, and compositional. “Working” is not enough if the code requires hidden state, duplicate protocols, or best-effort invariants that are not actually enforceable.

### 2.1 Elegance rules

The code MUST satisfy these structural rules:

- one owner for every long-lived resource;
- one representation of the pinned World revision;
- one Promptpile ToolCall/ToolResult contract adapter;
- no deep imports into Promptpile package internals;
- no duplicated third-party MCP JSON schemas;
- no business logic in generated shell/PowerShell scripts;
- no global mutable environment variables containing Session gateway state;
- no raw Archive paths passed to the model or MCP;
- no automatic gateway restart or revision retargeting inside an existing Session;
- no provider-private response parsing in Core business logic;
- no two modules writing the same generated runtime file;
- all cleanup APIs are idempotent;
- all startup is transactional: either the Session becomes fully `ready`, or every partial resource is closed/removed;
- all declared timeouts are enforced by killable process/network boundaries;
- all generated Core prompt/config text is deterministic and snapshot-testable;
- every path from Thought tool calls to Final has a locally verifiable closure condition.

### 2.2 Prefer narrow boundaries over abstractions

Do not create a generic plugin framework, generic MCP manager, service container, dependency-injection framework, or filesystem virtualization layer for this feature.

The v1 abstraction is intentionally narrow:

```text
World
  -> ArchiveView
  -> ArchiveRetrievalRuntime
  -> SessionToolingBinding
  -> existing Promptpile React
```

The only shared protocol adapter is:

```text
Promptpile Tool Artifacts
  -> archive-retrieval-artifacts.ts
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

## 4. Frozen dependencies, architecture guard, and platform Gate

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

### 4.2 `promptpile-protocol` is one explicit contract seam

The current architecture guard forbids `promptpile-protocol` entirely. That rule MUST be refined as part of this implementation because v1 deliberately uses the package's public artifact parser as the single ToolCall/ToolResult contract source.

Add:

```text
packages/core/src/promptpile/archive-retrieval-artifacts.ts
```

Only this module may import the package root:

```ts
import { parseToolCallV1, parseToolResultLineV1 } from 'promptpile-protocol';
```

Rules:

- `promptpile-protocol/src/*` and `promptpile-protocol/dist/*` remain forbidden everywhere;
- package-root `promptpile-protocol` imports are forbidden outside `archive-retrieval-artifacts.ts`;
- no `promptpile`, `promptpile-react`, or `promptpile-mcp` internal module import becomes allowed;
- hook code and React guard reuse the artifact adapter rather than importing/reimplementing the protocol independently.

Update `packages/core/scripts/check-architecture.mjs` to enforce this exact exception. The architecture test is part of the contract, not a temporary bypass.

### 4.3 Supported v1 CI matrix

The feature is releasable only after packed-install smoke tests pass on:

```text
Linux   x64
Linux   arm64
macOS   x64
macOS   arm64
Windows x64
```

Windows arm64 is not part of the frozen v1 support matrix.

### 4.4 Local executable resolution only

Runtime MUST NOT depend on a global `promptpile-mcp`, global `rust-mcp-filesystem`, `cargo`, Homebrew, or networked `npx`.

Extend `packages/core/src/promptpile/binaries.ts` so package boundaries are resolved from installed package metadata.

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

### 4.5 Gate behavior

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

Frozen Core API:

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

Provider process configuration is frozen to read-only/no-roots mode:

```text
environment: ALLOW_WRITE=false
environment: ENABLE_ROOTS=false
cwd: <archive-view>
<archive-view>
```

Defense in depth is:

1. minimal archive projection;
2. provider read-only mode;
3. dynamic Roots disabled;
4. `promptpile-mcp` exact `allowed_tools` allowlist;
5. model sees only the exported five tools.

Do not maintain a brittle provider denylist of every non-Dayloom tool.

Core avoids symlinks in the projection. World document paths already pass Archive portability validation; escape/traversal/device/FIFO/socket behavior is additionally tested at the provider boundary.

---

## 6. Retrieval runtime

### 6.1 Module split

Add exactly these retrieval modules:

```text
packages/core/src/promptpile/archive-retrieval.ts
packages/core/src/promptpile/archive-retrieval-artifacts.ts
packages/core/src/promptpile/archive-retrieval-hook.ts
```

Responsibilities:

```text
archive-retrieval.ts
  Session service lifecycle
  gateway config/process/readiness/tool export
  tooling binding/trampoline generation

archive-retrieval-artifacts.ts
  sole Promptpile ToolCall/ToolResult contract adapter
  calls/result path derivation
  vector validation
  sanitization/synthetic results
  work-directory closure verification

archive-retrieval-hook.ts
  one Thought after-hook execution
  exact environment/path validation
  exec-calls invocation
  delegates artifact work to the adapter
```

World projection remains in `world/archive-view.ts`.

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
  assertReadyForFinal(workPath: string): void;
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

`assertReadyForFinal(workPath)` is synchronous and local. It:

1. calls `assertHealthy()`;
2. validates that `workPath` is the current Session work directory supplied by Process Pile;
3. verifies all first-level Thought `.calls.jsonl` artifacts in that work directory have complete, ordered, valid paired `.result.jsonl` vectors;
4. rechecks the frozen allowed tool names and ToolResult byte bound;
5. performs no MCP/network call and creates no result.

A work directory with no general ToolCalls passes.

Do not expose gateway child, token, port, or provider internals through `CoreSession`. They remain private runtime state.

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
- health is checked at foreground operation entry and again immediately before Final;
- Core does not need an asynchronous hidden state transition merely because the child exits while the Session is idle.

### 6.4 Frozen runtime constants

Put these in one location in `archive-retrieval.ts` and do not duplicate literals:

```ts
export const ARCHIVE_RETRIEVAL = Object.freeze({
  gatewayStartupTimeoutMs: 15_000,
  readinessProbeTimeoutMs: 3_000,
  readinessProbeDelayMs: 200,
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

Structural model-visible result bound:

```text
32 KiB/result * 4 calls/Thought * 10 React steps
= at most 1.25 MiB serialized ToolResult data/run
```

The call-count ceiling is:

```text
4 calls/Thought * 10 React steps = 40 calls/run
```

These are hard ceilings, not expected behavior targets.

### 6.5 `ProcessRunner` timeout seam

The existing `ProcessRunner` cannot currently enforce the frozen 15-second readiness deadline because `promptpile-mcp export-tools` has a longer internal network timeout.

Extend the existing narrow runner contract:

```ts
export interface ProcessRunOptions {
  stdin?: string;
  onStdout?: (chunk: string) => void;
  onExtraPipe?: (chunk: string) => void;
  onChild?: (child: ChildProcess) => void;
  timeoutMs?: number;
}
```

Frozen timeout behavior:

- absent `timeoutMs` preserves current behavior;
- a positive timeout starts one timer after spawn;
- expiration kills the child and causes `run()` to reject with a bounded timeout error after child settlement;
- the timer is always cleared on normal/error close;
- callback-triggered failure and timeout cannot double-settle the run;
- this is a generic process-boundary primitive, not MCP-specific logic.

Readiness probes use `readinessProbeTimeoutMs`. Therefore the 60-second internal `export-tools` fetch timeout can never invalidate Dayloom's 15-second startup deadline.

### 6.6 Session runtime files and ownership

Use deterministic, non-overlapping paths:

```text
<session>/
  archive-view/                  # world/archive-view.ts owns
  retrieval/                     # ArchiveRetrievalRuntime owns
    mcp.toml
    hook.json
    tools.toml
    tools.candidate.toml         # startup-only, never model-visible
    after-hook.sh                # POSIX
    after-hook.cmd               # Windows
  react/                         # Session workspace owns
    thought.md
    observe.md
    final-send.md
    final-submit.md
    send.toml
    submit.toml
  context/
  conversation/
  compression/
```

For Init only, the workspace may create its existing empty `react/tools.toml`; no retrieval directory/runtime exists.

For non-Init Sessions, the workspace MUST NOT create or overwrite a tools file. It receives `retrieval/tools.toml` through `SessionToolingBinding`.

`mcp.toml` and `hook.json` contain the gateway token and MUST NOT be placed inside `archive-view`.

On POSIX create secret-bearing runtime files with owner-only permissions where supported. Never print the token in normal logs/events.

### 6.7 Gateway identity and port

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

### 6.8 Frozen `mcp.toml`

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
  "<archive-view>"
]
cwd = "<archive-view>"
allowed_tools = [
  "list_directory",
  "directory_tree",
  "search_files",
  "search_files_content",
  "read_file_lines",
]

[servers.archive.env]
ALLOW_WRITE = "false"
ENABLE_ROOTS = "false"
```

Unknown gateway fields MUST NOT be added; the frozen Promptpile MCP config parser rejects them.

### 6.9 Gateway startup/readiness is a real deadline

Launch the long-lived gateway with Node directly:

```text
process.execPath <promptpileMcpBin> launch --config <mcp.toml>
```

Do not use the wait-for-exit `ProcessRunner` for the long-lived gateway.

Define one monotonic startup deadline:

```text
start + gatewayStartupTimeoutMs
```

Until the deadline:

1. if the gateway child exits, fail immediately with bounded stderr;
2. remove any stale `retrieval/tools.candidate.toml`;
3. run the public CLI through `ProcessRunner` with `timeoutMs = readinessProbeTimeoutMs`:

```text
process.execPath <promptpileMcpBin>
  export-tools
  --base-url <baseUrl>
  --token <token>
  -o <retrieval/tools.candidate.toml>
```

4. if the probe times out/exits nonzero while the gateway remains alive, wait at most `readinessProbeDelayMs` without exceeding the overall deadline and retry;
5. if export succeeds, parse the candidate and verify **set equality** with the selected five tool names;
6. a successful export with a missing/extra/wrong selected tool is a terminal startup contract failure, not a retry condition;
7. atomically rename the validated candidate to `retrieval/tools.toml`;
8. only then mark runtime `ready`.

The candidate file is never referenced by React config and is removed during failure cleanup.

The overall wall-clock deadline, not the number of probes, is authoritative.

### 6.10 Gateway shutdown

`close()`:

1. marks runtime `closing`;
2. sends graceful termination to the gateway;
3. waits up to `gatewayCloseGraceMs` for exit so `promptpile-mcp` can dispose the upstream MCP session;
4. force-kills only if still alive;
5. marks `closed` regardless of repeated `close()` calls.

Cleanup of Session files happens only after retrieval runtime close has completed.

---

## 7. Promptpile Tool Artifact adapter and closed-loop hook

This is the most important implementation boundary after revision pinning.

### 7.1 One artifact adapter

`archive-retrieval-artifacts.ts` is the only Core module that knows the public Promptpile ToolCall/ToolResult V1 parser API.

It provides narrow helpers conceptually equivalent to:

```ts
readValidatedToolCalls(callsPath, policy)
pairedResultPath(callsPath)
readCompleteToolResultVector(calls, resultPath, policy)
writeSyntheticToolResultsAtomic(calls, resultPath, content)
sanitizeToolResultsAtomic(calls, resultPath, policy)
assertWorkRetrievalClosure(workPath, policy)
```

It may inspect raw JSON objects only to preserve unknown Promptpile metadata while validating required base fields through `promptpile-protocol`.

It MUST NOT understand Rust MCP provider-private response schemas.

### 7.2 Keep generated scripts stupid

Do not implement parsing, MCP execution, truncation, or error recovery in bash/PowerShell.

`archive-retrieval-hook.ts` compiles to a packaged Node program containing the unit-testable hook flow.

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

### 7.3 Hook configuration

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

### 7.4 Exact input path and containment

When `PROMPTPILE_HAS_TOOL_CALLS !== "1"`, exit successfully without work.

When it is `"1"`, require both:

```text
PROMPTPILE_ASSISTANT_CALL_FILE
PROMPTPILE_OUTPUT_DIRECTORY
```

Use only `PROMPTPILE_ASSISTANT_CALL_FILE`; never scan for the latest calls file.

Validation:

- calls path is absolute;
- output directory is absolute;
- calls path is a regular `.calls.jsonl` file;
- after realpath/normalization, the calls file is first-level inside `PROMPTPILE_OUTPUT_DIRECTORY`;
- the paired result path is derived from that exact basename in the same directory.

Do not fall back to `PROMPTPILE_CALLS_FILE` or a guessed index.

### 7.5 ToolCall validation

Use the artifact adapter before execution.

Enforce:

- at least one call;
- no more than `maxToolCallsPerThought` (4);
- unique call IDs;
- every function name is one of the frozen five exported tools;
- arguments remain opaque JSON strings for Promptpile/MCP to validate; Dayloom does not duplicate provider schemas.

If the model emits too many calls or a non-allowed name, do not execute any call from that batch. Publish one complete error ToolResult per call and return success so Observe receives explicit failure evidence.

Malformed calls that cannot be represented safely by the public ToolCall contract are catastrophic local input failure and therefore cannot satisfy the complete-vector invariant.

### 7.6 Execution

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

Do not add an outer semantic retry. `promptpile-mcp` owns the one frozen retry for retry-safe read-only tools.

### 7.7 Complete-result invariant

The hook owns this invariant:

> If `PROMPTPILE_HAS_TOOL_CALLS=1` and the Dayloom hook exits `0`, the paired result artifact contains exactly one valid ToolResult line for every ToolCall, in the same order.

After `exec-calls` returns:

#### Success path

1. derive the paired `.result.jsonl` from the exact calls filename;
2. validate every line with the artifact adapter;
3. verify IDs form a complete one-to-one ordered vector against the calls;
4. preserve unknown/extra Promptpile metadata fields;
5. enforce the serialized line byte limit;
6. atomically rewrite only if sanitization is needed;
7. exit `0`.

#### Operational failure path

If `exec-calls` exits nonzero or no complete valid result vector exists:

1. do **not** retry outside `promptpile-mcp`;
2. because all allowed tools are read-only, treat execution uncertainty as retrieval failure rather than a side-effect hazard;
3. atomically publish one synthetic ToolResult per valid parsed call with content such as:

```text
[DAYLOOM_RETRIEVAL_ERROR]
Archive retrieval failed for this tool call. Treat the requested information as unresolved and do not invent it.
```

4. preserve call ID and tool name;
5. exit `0` once the complete error vector is durable.

This turns normal gateway/MCP failure into explicit evidence for Observe/Check.

The hook exits nonzero only when it cannot establish the complete-result invariant, for example:

- calls artifact cannot be parsed under the public contract;
- output-directory/calls containment is invalid;
- paired result path cannot be derived;
- result artifact cannot be written atomically;
- hook configuration is invalid.

A nonzero hook is **not** itself considered sufficient fail-closed propagation because Promptpile may surface it as a warning. The independent Core pre-Final guard in Section 8 closes this catastrophic path.

### 7.8 Result byte bound

Each serialized ToolResult JSONL line MUST be `<= 32 KiB` UTF-8 after sanitization.

When content is too large, preserve a bounded UTF-8 prefix and append:

```text
[DAYLOOM_TOOL_RESULT_TRUNCATED]
Result exceeded the Dayloom tool-result limit. Narrow the path, query, glob, or requested line range.
```

Truncation MUST preserve valid UTF-8 and a valid ToolResult artifact. Silent truncation is forbidden.

If immutable structural fields themselves make a valid line impossible within the bound, treat the artifact as invalid rather than silently violating the bound.

### 7.9 Atomic result publication

All Dayloom-created/rewritten result artifacts use:

```text
same-directory temporary file
-> fsync/close where practical
-> atomic rename over target
```

Never expose a partially written `.result.jsonl` to the next Promptpile phase.

---

## 8. React pre-Final retrieval-integrity guard

The hook closes normal tool execution outcomes. Core independently closes the entire React retrieval chain before Final.

### 8.1 Why this guard exists

Promptpile's current public after-hook policy may allow a catastrophic nonzero hook to be recorded as warning rather than terminate the whole React run. Dayloom MUST NOT rely on that behavior for integrity.

The guard is not a second tool executor. It performs only local verification.

### 8.2 `runReact` seam

Add one narrow optional callback:

```ts
export interface RunReactInput {
  // existing fields...
  assertBeforeFinal?: (workPath: string) => void;
}
```

The Process Pile reducer invokes it exactly when a valid `work.ready` event is consumed, **after** validating work id/path/phase order but **before**:

- transitioning to `final-or-terminal`;
- projecting `work.completed`;
- accepting `phase.started(final)`.

Conceptually:

```ts
if (event.type === 'work.ready') {
  validateWorkReadyEvent(event);
  input.assertBeforeFinal?.(event.work_path!);
  markReadyForFinal();
  observer?.workCompleted?.(event.work_path!);
}
```

If the callback throws, the existing extra-pipe callback failure path kills the React child and rejects the run before Final output starts.

### 8.3 Core binding

For non-Init Sessions:

```ts
assertBeforeFinal: (workPath) => activeSession.retrieval!.assertReadyForFinal(workPath)
```

For Init it is absent.

`assertReadyForFinal` passes when either:

- no Thought ToolCalls exist; or
- every Thought calls artifact has a valid complete paired result vector, including legitimate synthetic `[DAYLOOM_RETRIEVAL_ERROR]` results.

It fails when:

- the runtime is already `failed/closing/closed`;
- a calls artifact is malformed;
- a result artifact is missing/malformed/incomplete/out of order;
- a call uses a non-allowed tool;
- a result violates the frozen serialized byte bound.

Failure maps through the normal agent failure path to `AGENT_FAILED`; Final and submission publication do not begin.

This establishes the stronger invariant:

> No retrieval-enabled React run may enter Final unless all model-visible Thought ToolCalls in that work are locally closed by valid ToolResults and the Session retrieval runtime is healthy at the Final boundary.

---

## 9. Core Session integration

### 9.1 One ownership aggregate and one phase value

Do not keep parallel `session`, retrieval, and `{id, kind, status}` records that can drift.

Frozen Core-owned shape:

```ts
interface ActiveSessionRuntime {
  readonly workspace: CoreSession;
  readonly retrieval: ArchiveRetrievalRuntime | null;
}

private activeSession: ActiveSessionRuntime | null = null;
private sessionPhase: CoreSessionStatus | null = null;
```

Invariant:

```text
activeSession === null  <=>  sessionPhase === null
```

`retrieval === null` is valid only for Init.

Public `CoreState.session` is always derived:

```ts
activeSession && sessionPhase
  ? {
      id: activeSession.workspace.id,
      kind: activeSession.workspace.kind,
      status: sessionPhase,
    }
  : null
```

Do not store Session id/kind a second time in a mutable `sessionStatus` field.

Do not place the long-lived gateway in `activeChild`.

```text
activeChild
  = one transient foreground Promptpile/compress/React process

activeSession.retrieval
  = Session service surviving multiple foreground operations
```

### 9.2 Transactional `startSession`

For non-Init Sessions the exact sequence is:

```text
validate lifecycle availability
  -> allocate session id/root
  -> materialize pinned archive-view
  -> start ArchiveRetrievalRuntime
       -> owns retrieval/* including final tools.toml
  -> create Session workspace/prompts using retrieval.binding
       -> owns react/context/conversation/compression
  -> write derived React configs
  -> append immutable bootstrap context
  -> install ActiveSessionRuntime
  -> set sessionPhase=ready
```

The retrieval runtime and workspace no longer initialize the same tools file or generated directory content.

Do not assign `this.activeSession` or `this.sessionPhase` until every preceding step succeeds.

Failure unwind order:

```text
retrieval.close() if created
  -> remove session root
  -> leave Core with activeSession=null, sessionPhase=null
```

This guarantees there is no externally observable half-ready Session.

### 9.3 Workspace tooling binding

Introduce:

```ts
export interface SessionToolingBinding {
  readonly toolsFile: string;
  readonly afterHookPath: string;
}
```

For Init:

- no binding;
- workspace may write its empty `react/tools.toml`;
- React config contains no after-hook;
- no retrieval runtime exists.

For Planning/Play/Revise:

- retrieval runtime owns `retrieval/tools.toml`;
- workspace does not write a tools file;
- derived React config points to `binding.toolsFile` and `binding.afterHookPath`.

`readCallerConfig()` continues forbidding caller control over `tools_file` and `after_hook`.

### 9.4 `writeDerivedConfigs`

Refactor around a typed path object:

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

### 9.5 Foreground `send()` / `submit()`

Before append/compress/React for a non-Init Session:

```ts
activeSession.retrieval!.assertHealthy();
```

Then pass the same runtime's `assertReadyForFinal` into `runReact` as Section 8 describes.

If entry health fails:

- map to `AGENT_FAILED`;
- terminalize the Session;
- do not attempt transparent restart.

During React, normal retrieval execution failures remain ToolResult data and may be handled by Observe/Check. Only integrity/runtime failure blocks Final.

### 9.6 Terminalization

`terminalize()` operates on the aggregate and is the only normal Session resource teardown path.

Frozen order:

```text
detach activeSession + sessionPhase from externally available Core state
  -> wait for current foreground operation according to existing cancel semantics
  -> retrieval.close()
  -> remove Session root
```

The detached aggregate is held locally until teardown completes.

If both close and filesystem cleanup fail, retain the first error as primary and attach/log bounded secondary diagnostics; do not skip later cleanup attempts.

### 9.7 Dispose

`dispose()` remains idempotent.

It must:

1. mark Core disposed;
2. kill current foreground child according to existing semantics;
3. wait for in-flight foreground operation/cancel settlement;
4. detach and close the active Session retrieval runtime if any;
5. remove the Core runtime root;
6. never emit events after disposal.

---

## 10. Error model

Do not add a large new public error taxonomy.

Add one internal error class:

```ts
class ArchiveRetrievalError extends Error {
  constructor(
    readonly stage:
      | 'projection'
      | 'startup'
      | 'tools'
      | 'hook'
      | 'artifacts'
      | 'runtime',
    message: string,
    options?: ErrorOptions,
  ) { ... }
}
```

Core maps retrieval infrastructure/integrity failures to the existing public `AGENT_FAILED` result when they occur during Session start/send/submit.

Dependency resolution failure during `createDayloomCore()` remains `CoreInitializationError('INTERNAL_ERROR', ...)` because the packaged runtime itself is incomplete.

Tool-level retrieval failures are not Core operation errors; they are complete ToolResult evidence and become `[RETRIEVAL_STATUS] blocked/needs-more` in Observe.

Do not call `recoverWorldState()` merely because read-only retrieval failed. World state was not mutated.

---

## 11. React loop and Process Pile

### 11.1 Max steps

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

### 11.2 Check termination

Check continues only when all are true:

1. a material question remains unresolved;
2. currently available retrieval can probably answer it;
3. the answer would materially improve Final/submission correctness.

Stop when evidence is sufficient, uncertainty is immaterial, user clarification is required, retrieval is blocked, or another call would just reconfirm known information.

Prefer stopping over redundant confirmation.

### 11.3 Final boundary ordering

The frozen ordering is:

```text
last Check completed
  -> work.ready validated
  -> Core assertBeforeFinal
  -> work.completed projection
  -> Final started/output streaming
```

No `output.started` or `output.delta` may be projected before the retrieval-integrity guard passes.

---

## 12. Prompt implementation

### 12.1 Code organization

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

Concrete Promptpile files remain:

```text
react/thought.md
react/observe.md
react/final-send.md
react/final-submit.md
```

The refactor is internal to Core.

### 12.2 Composition

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

### 12.3 Session roles

Frozen roles:

```text
Init     = Collaborative World Designer
Planning = Day Planner for one pinned target Day
Play     = Interactive Narrative Runtime for the pinned plan
Revise   = Semantic World Editor
Settle   = no agent
```

### 12.4 Namespace guide

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

### 12.5 Retrieval policy

Teach one progressive policy:

```text
known directory      -> list_directory
known path pattern   -> search_files
need to locate fact  -> search_files_content
found a hit          -> read_file_lines around the hit
unknown structure    -> bounded directory_tree, then narrow
```

Do not mechanically enumerate the root. Do not reread facts already established in the current React run. Retrieve exact IDs/current values/history when correctness depends on them.

### 12.6 Observe contract

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

### 12.7 Final discipline

```text
Thought = investigate/retrieve
Observe = consolidate evidence/unresolved state
Check   = decide sufficiency
Final   = render
```

Final never receives general tools and never solves a fact marked unresolved by inventing it.

### 12.8 v1 eager-context decision

Do not remove or shrink the current `VERIFIED_WORLD_DOCUMENTS` injection in the same implementation.

This v1 change is retrieval-enablement, not context-removal.

Once the frozen implementation passes behavior tests, broad eager context reduction can be proposed separately with its own equivalence measurements.

---

## 13. Implementation sequence

Implement in this order so every merge step has one closed, testable boundary.

### Step 1 — package/process boundaries and architecture guard

- add exact dependencies;
- extend packaged binary resolution;
- add `ProcessRunner.timeoutMs` with deterministic kill/settlement tests;
- change architecture guard so only `archive-retrieval-artifacts.ts` may import package-root `promptpile-protocol`;
- keep all Promptpile deep imports forbidden;
- add packed smoke tests for frozen package bins/commands.

Exit criterion: Core resolves all boundaries locally, declared process timeouts are enforceable, and architecture guard expresses the intended single protocol seam.

### Step 2 — archive projection

- add `world/archive-view.ts`;
- add deterministic projection/path/containment tests.

Exit criterion: fixture World produces exactly the expected copied visible tree and never exposes control/private/unreachable paths.

### Step 3 — artifact adapter

- add `archive-retrieval-artifacts.ts`;
- implement calls/result pairing, vector validation, byte sanitization, synthetic result writing, atomic publication, and work-directory closure verification.

Exit criterion: one module can prove or reject Promptpile Tool Artifact closure without MCP/provider knowledge.

### Step 4 — retrieval runtime

- add gateway config, port/token, long-lived launch, real startup deadline, candidate tool export, exact set validation, state machine, tooling binding, idempotent close.

Exit criterion: one runtime starts within the frozen deadline, publishes `retrieval/tools.toml` only after validation, survives repeated health checks, and closes with no child leak.

### Step 5 — closed-loop hook

- add packaged Node hook runner;
- add POSIX/Windows trampoline generation;
- use exact environment containment;
- add call-count/name validation, `exec-calls`, complete error-vector fallback via artifact adapter.

Exit criterion: every non-catastrophic execution outcome satisfies `HAS_TOOL_CALLS=1 + hook exit 0 => complete valid ToolResult vector`.

### Step 6 — Session workspace/config ownership

- introduce `SessionToolingBinding`;
- keep non-Init tools under `retrieval/` only;
- ensure workspace never overwrites them;
- set `after_hook` only for retrieval-enabled Sessions;
- keep Init tool-free.

Exit criterion: retrieval and workspace own disjoint generated files; send/submit configs point to the same Session tools/hook and caller config cannot override them.

### Step 7 — Core aggregate ownership + React integrity guard

- replace duplicate Session state with `ActiveSessionRuntime + sessionPhase`;
- transactional start;
- health assertion before foreground agent work;
- add `RunReactInput.assertBeforeFinal` at validated `work.ready`;
- bind it to `retrieval.assertReadyForFinal`;
- ordered terminalize/dispose.

Exit criterion: every start/cancel/send/submit/failure path leaves either one valid active aggregate or none, and no retrieval-enabled Final can start with an unhealthy runtime or open ToolCall vector.

### Step 8 — React loop + prompts

- set max steps to 10;
- refactor prompt components;
- add Observe/Check retrieval behavior;
- extend Process Pile tests to 1, 2, 4, and 10-step valid sequences plus pre-Final guard failure.

Exit criterion: prompt snapshots are stable and the agent loop stops/refines correctly without bypassing Final integrity.

### Step 9 — end-to-end/pack CI

- run real Promptpile -> `promptpile-mcp` -> Rust MCP -> ToolResult -> Observe -> Check -> Core guard -> Final flows;
- run supported platform packed-install smoke matrix.

Exit criterion: all frozen acceptance criteria below pass from packed artifacts, not only monorepo source paths.

Do not begin eager-context reduction as part of these steps.

---

## 14. Required tests

### 14.1 Archive/security

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

### 14.2 Dependency/process/runtime

MUST test:

- exact local package versions resolve;
- no global PATH dependency;
- architecture guard permits package-root `promptpile-protocol` only in `archive-retrieval-artifacts.ts`;
- protocol deep imports remain rejected;
- `ProcessRunner.timeoutMs` kills and rejects a hung child exactly once;
- callback failure/timeout/normal close cannot double-settle;
- gateway token is required;
- loopback binding only;
- port race retry;
- gateway startup cannot exceed the 15-second deadline merely because an export probe hangs;
- timed-out export probe does not kill the gateway child;
- successful candidate export with wrong/missing tool set fails immediately;
- final tools file is atomically installed only after exact five-tool validation;
- unexpected gateway exit marks runtime failed;
- close is idempotent;
- graceful close then force-kill fallback;
- no child leak after terminalize/dispose.

### 14.3 Artifact adapter/hook

MUST test:

- `HAS_TOOL_CALLS=0` no-op;
- exact `PROMPTPILE_ASSISTANT_CALL_FILE` use;
- calls file must be first-level inside `PROMPTPILE_OUTPUT_DIRECTORY`;
- malformed/duplicate calls handling;
- >4 calls produces complete error results without execution;
- non-allowed tool produces complete error results without execution;
- successful `exec-calls` result passes through;
- oversized result is valid UTF-8, explicitly truncated, <=32 KiB serialized line;
- MCP/gateway timeout produces complete synthetic retrieval-error vector;
- result vector order/IDs exactly match calls;
- extra Promptpile result metadata is preserved when valid;
- atomic rewrite never exposes partial JSONL;
- work closure accepts no-call work;
- work closure accepts complete synthetic retrieval-error vectors;
- work closure rejects missing/malformed/incomplete/out-of-order result vectors;
- generated `.sh` and `.cmd` trampolines correctly quote paths with spaces.

### 14.4 Core lifecycle and pre-Final guard

MUST test:

- Init has no retrieval runtime and no pre-Final retrieval guard;
- non-Init start installs active Session only after retrieval readiness;
- startup failure closes gateway and removes Session root;
- non-Init retrieval owns `retrieval/tools.toml`; workspace does not overwrite/create a competing `react/tools.toml`;
- send/send/submit share the same gateway and pinned view;
- public Session id/kind derive from `activeSession.workspace`, not duplicated mutable state;
- `activeSession === null <=> sessionPhase === null` on every lifecycle path;
- foreground cancel does not kill/reassign gateway ownership prematurely;
- terminalize closes gateway before deleting root;
- retrieval unhealthy before send/submit => `AGENT_FAILED` + Session terminalization;
- valid `work.ready` with missing result artifact causes React failure before `output.started`;
- catastrophic nonzero hook followed by missing results cannot enter Final;
- valid synthetic retrieval-error results pass the pre-Final guard;
- runtime failed before `work.ready` blocks Final;
- read-only retrieval failures do not call World recovery/publication paths;
- dispose remains idempotent during idle/running/cancel states.

### 14.5 Agent behavior

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

### 14.6 Packed platform smoke

Each supported CI target installs packed Dayloom/Core artifacts into a fresh consumer and proves:

```text
resolve bins
-> start Core
-> create fixture published World
-> start non-Init Session
-> gateway ready within deadline
-> exactly five tools atomically bound
-> list/search/read through real MCP
-> complete ToolResult vector
-> Observe/Check consume evidence
-> Core pre-Final guard passes
-> Final
-> terminalize
-> no live child/temp Session remains
```

Also include one packed failure smoke where the hook cannot establish results and prove no Final output/publication occurs.

---

## 15. Frozen acceptance criteria

Implementation is complete only when all are true.

1. Frozen dependency versions are installed/resolved locally and packed smoke passes on the support matrix.
2. `promptpile-protocol` has exactly one allowed Core package-root import seam and no Promptpile deep import exists.
3. Every declared ProcessRunner readiness timeout is actually kill-enforced.
4. Gateway readiness is bounded by the 15-second wall-clock deadline independent of `export-tools` internal timeout.
5. Every non-Init Session owns exactly one pinned copied `archive-view` and one retrieval runtime.
6. Init owns neither.
7. AI-visible files satisfy pinned reachability + Profile validity + explicit namespace allowlist.
8. The physical Archive control/object store is inaccessible to the model/MCP.
9. Rust MCP runs read-only with dynamic Roots disabled.
10. Promptpile MCP exports exactly the five frozen provider tools.
11. `retrieval/tools.toml` becomes active only after exact-set validation and atomic publication.
12. Tool schemas come from live MCP discovery, not duplicated Dayloom schemas.
13. Retrieval runtime and Session workspace own disjoint generated runtime files.
14. Gateway lifetime is owned by `ActiveSessionRuntime`, never `activeChild`.
15. Public Session id/kind are derived from the active workspace; only Session phase is separately mutable.
16. Session start is transactional and cannot expose a half-ready Session.
17. `send()` and `submit()` share the same pinned gateway/view.
18. `REACT_MAX_STEPS` is 10 and Process Pile validates multi-step runs.
19. The hook enforces max 4 ToolCalls per Thought.
20. Hook exit `0` with tool calls guarantees one valid paired ToolResult per call.
21. Normal MCP/gateway execution failures become explicit retrieval-error ToolResults.
22. Every serialized ToolResult line is <=32 KiB or explicitly truncated to that bound.
23. Tool/result files are published atomically.
24. The pre-Final Core guard verifies runtime health and complete Tool Artifact closure at `work.ready`.
25. Catastrophic hook failure or incomplete artifacts cannot reach `output.started`, Final, or submission publication.
26. Valid synthetic retrieval-error vectors are allowed through the guard so Observe/Final can report unresolved information normally.
27. Observe/Check can continue/refine or stop based on retrieval evidence.
28. Final has no general tool access.
29. Core remains sole mutation validator/publisher.
30. No retrieval failure can directly alter published World state.
31. Gateway unexpected exit is never repaired by retargeting/restarting against another revision.
32. Terminalize/dispose close retrieval before deleting Session resources and are idempotent.
33. Existing eager verified context remains intact in v1.
34. Retrieval traces remain ephemeral.
35. Prompt components are deterministic, shared, and tested.
36. No Promptpile source change is required.
37. No runtime global install, network fetch, Cargo, shell search path, or provider fallback is required.
38. All supported packed-platform success and catastrophic-hook failure smoke tests pass.

When these criteria pass, the retrieval feature is considered fully closed for v1 implementation.

---

## 16. Post-v1 ideas — not implementation blockers

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
- write-capable MCP or candidate-file editing inside Archive Retrieval v1. The later,
  explicitly revised Session File Runtime contract may mount separate write-capable
  Draft/Candidate roots; it MUST NOT make the pinned Archive root writable.

Each requires a separate design change after production behavior is measured.

---

## Appendix A — Why the frozen provider is acceptable

`@rustmcp/rust-mcp-filesystem@0.4.3` provides the required listing/path search/content search/ranged read capabilities, is read-only by default, keeps dynamic Roots disabled by default, exposes presence-only CLI flags to enable those capabilities, and is distributed as an npm convenience package around the Rust binary. Dayloom explicitly pins both corresponding environment values to `false` and omits the enable flags.

The v1 design does not trust provider defaults alone: the provider is explicitly launched read-only/no-roots, rooted only at the copied Session projection, and sits behind the exact `promptpile-mcp` tool allowlist.

## Appendix B — Why `max-step = 10`

Ten is a hard agent-loop safety ceiling. It is intentionally generous enough for multi-hop `search -> read -> refine` while Check is instructed and tested to stop much earlier.

A Dayloom outer step is heavier than a simple framework turn because it contains Thought, optional tool execution, Observe and Check. Operational tuning should improve early stopping rather than raise the frozen cap.

## Appendix C — Closed-loop proof sketch

For a retrieval-enabled React run:

1. the Session begins from one pinned `PublishedWorld`;
2. Core exposes only a verified copied projection of that revision;
3. Thought can emit only the five exported read-only tools;
4. the hook either publishes a complete valid result vector or fails nonzero;
5. normal MCP failures are converted into complete explicit error vectors;
6. regardless of hook exit handling, Process Pile cannot enter Final until Core's `work.ready` guard independently proves runtime health and complete artifact closure;
7. Final is tool-free;
8. submit output is still only a candidate and must pass existing Core parser/semantic/pinned-base publication checks.

Therefore there is no successful path from model retrieval to Final/publication that bypasses pinned revision, tool-result closure, or Core mutation authority.
