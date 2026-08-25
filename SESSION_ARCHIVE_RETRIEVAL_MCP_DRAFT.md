# Session Archive Retrieval MCP Draft

Status: Draft  
Date: 2026-08-25  
Scope: `@dayloom/core` Session runtime, Promptpile/React tool integration, Archive V2 read projection  
Non-goal: no modification to the `lithdoo/promptpile` repository or Promptpile package internals

## 1. Goal

Dayloom Sessions should allow the AI to inspect the current World archive on demand instead of requiring Core to eagerly inject most World documents into every Session context.

The first implementation will use a mature third-party filesystem/search MCP server and expose a deliberately small read-only retrieval surface to the model.

Required model capabilities:

- search file contents by literal keyword or regular expression;
- search files and paths by name/glob;
- list directories and inspect directory structure;
- read selected text file ranges without loading an entire large file.

The MCP path is retrieval only. It does not own Dayloom World semantics, validation, publication, mutation, Session state, or authority.

The design MUST integrate through Promptpile's existing public CLI/tool-artifact contracts. Dayloom MUST NOT add a second, competing tool-call protocol inside Core.

## 2. Core decisions

The first implementation adopts all of the following decisions:

1. Do not expose the physical Archive V2 storage root directly to the AI.
2. Each non-Init Session receives a Core-owned read-only logical archive view materialized from the Session's pinned `PublishedWorld`.
3. Use `@rustmcp/rust-mcp-filesystem` as the selected third-party retrieval MCP candidate, subject to the distribution/security Gate.
4. Use `promptpile-mcp` as the existing gateway/executor between Promptpile tool artifacts and the third-party MCP. Dayloom Core does not directly implement MCP tool-call replay.
5. Expose exactly five retrieval tools to Thought:
   - `list_directory`
   - `directory_tree`
   - `search_files`
   - `search_files_content`
   - `read_file_lines`
6. Generate the Promptpile `.tools.toml` from live MCP `tools/list` through `promptpile-mcp export-tools`; do not hand-maintain duplicate JSON schemas in Dayloom.
7. Keep MCP tools available to both ordinary `send()` and `submit()` React runs.
8. Increase the Core-owned React outer-loop safety limit from `max-step = 1` to `max-step = 10`.
9. Treat `10` as a hard safety ceiling, not a target iteration count. Check should normally terminate simple retrieval in roughly 1-4 steps.
10. Core owns the Session-level MCP gateway lifecycle separately from the foreground Promptpile/React child process.
11. No Promptpile source change is required for the first implementation.

## 3. Existing Promptpile integration seam

Promptpile already defines the tool-execution chain Dayloom needs:

```text
.tools.toml
    |
    v
promptpile
    |
    v
LLM tool_calls
    |
    v
[idx]assistant.calls.jsonl
    |
    v
executor
    |
    v
[idx]assistant.result.jsonl
    |
    v
next promptpile completion reads tool messages
```

The existing ownership split is useful and SHOULD be preserved:

```text
promptpile-protocol
  owns ToolCall/ToolResult artifact shapes

promptpile
  owns one model completion
  owns durable assistant/calls artifacts
  reads result artifacts into later tool messages

promptpile-mcp
  owns MCP stdio sessions
  owns the loopback gateway
  owns tool execution and result publication

promptpile-react
  owns Thought -> Observe -> Check -> Final orchestration

@dayloom/core
  owns World/Session lifecycle
  owns pinned archive-view
  owns runtime configuration and child lifecycles
  owns final submission validation/publication
```

`promptpile-react` already exposes the two required Thought seams:

```text
--tools-file
--after-hook-path
```

Thought reads tools and may create tool calls. Observe and Final explicitly disable general tools. Check uses only its own decision tool.

Therefore Dayloom SHOULD integrate archive retrieval through these existing surfaces rather than parsing `tool_calls` or constructing `tool` messages itself.

## 4. End-to-end runtime architecture

The intended runtime graph is:

```text
                         @dayloom/core
                              |
              +---------------+----------------+
              |                                |
              | Session authority              | AI orchestration
              |                                |
      pinned PublishedWorld              promptpile-react
              |                                |
              v                                v
        archive-view                     Thought + tools
              |                                |
              |                         calls artifact
              |                                |
              |                         after-hook
              |                                |
              |                         exec-calls
              |                                |
              +---- rust filesystem MCP <--- promptpile-mcp gateway
                                                   |
                                                   v
                                           result artifact
                                                   |
                                                   v
                                                Observe
                                                   |
                                                   v
                                                 Check
                                            /            \
                                      continue           stop
                                         |                |
                                         +--> Thought    Final
                                                          |
                                                          v
                                                   Dayloom Core
                                                          |
                                                submission parser
                                                semantic builder
                                                pinned-base check
                                                Archive publish
```

The third-party filesystem MCP is an implementation detail behind `promptpile-mcp`. The model sees tool definitions; Promptpile sees tool artifacts; Core sees only the React/Process Pile contract and Session-owned runtime resources.

## 5. Why the physical Archive root is not an AI search space

Archive V2 is an immutable object graph with one mutable current pointer. Physical file existence does not imply that a document is part of the current World.

The physical archive may contain:

- blobs reachable from the current commit;
- blobs reachable only from historical commits;
- unreferenced immutable objects;
- operation diagnostics;
- control-plane metadata;
- material that was valid in an older revision but is not current World state.

A generic keyword search over the physical root can therefore mix current facts with stale or unreachable content.

The MCP-visible view MUST contain only documents reachable through the RootTree pinned when the Session starts.

## 6. Revision pinning and MCP-visible logical view

The existing Session rule remains authoritative: one Session reasons against exactly one pinned World revision.

If a Session starts at revision `R42`, all of the following MUST refer to `R42`:

- immutable Session bootstrap context;
- MCP directory listing and tree views;
- MCP file/path search results;
- MCP content search results;
- MCP file reads;
- structured submission validation base;
- final publication conflict check.

A later publication of `R43` MUST NOT change what an already-open Session can read.

Forbidden mixed-revision state:

```text
immutable prompt facts = R42
MCP result             = R43
submission base        = R42
```

A Session that loses its pinned read view MUST fail closed rather than silently retargeting to the latest `current.json`.

For a published World, Core should materialize a Session-specific view such as:

```text
<runtime>/sessions/<session-id>/archive-view/
  canon/
  state/
  characters/
  locations/
  arcs/
  memory/
  story-seeds/
  days/
```

Logical paths SHOULD match World Profile document paths so the model sees stable domain paths instead of Archive object hashes.

The view MAY include all World documents reachable from the pinned RootTree, including historical day documents valid in that revision.

The view MUST NOT expose:

```text
current.json
commits/
objects/
operations/
publish locks
runtime internals
Session internals
Promptpile configuration
raw Archive control-plane metadata
```

If `worldId`, revision, phase, current day, or last settled day is useful, Core should expose it through immutable bootstrap context or a dedicated generated read-only metadata document.

### Materialization rules

The archive view is derived runtime state and is never a publication target.

Core MUST build it only from the already verified pinned `PublishedWorld` / RootTree.

Preferred order:

1. copy-on-write/reflink when supported and proven safe;
2. ordinary file copy;
3. another mechanism that cannot mutate Archive immutable blobs.

Do not hard-link MCP-visible files directly to immutable Archive blobs. A write bug against a hard link could corrupt the source blob.

The resulting view SHOULD be made read-only at the OS/filesystem permission layer in addition to MCP-level restrictions.

The view is deleted with the Session workspace.

## 7. Selected third-party MCP

### Decision

The selected first candidate is:

```text
@rustmcp/rust-mcp-filesystem
```

The server implementation is `rust-mcp-stack/rust-mcp-filesystem`.

Dayloom is a Node.js project, but the selected server is not an in-process native addon. It is an MCP child process launched behind `promptpile-mcp`, so the server implementation language does not couple Core business logic to Rust.

Runtime boundary:

```text
Dayloom Core / Node.js
      |
      | spawn promptpile-mcp
      v
promptpile-mcp
      |
      | stdio MCP
      v
rust-mcp-filesystem native executable
      |
      v
Session archive-view only
```

### Why this candidate is preferred

It matches Dayloom's retrieval model well:

- filesystem retrieval is its primary responsibility;
- it supports real file-content search, not path/glob search only;
- content search supports literal text and regular expressions;
- results provide path/location/excerpt evidence;
- it provides line-ranged reads;
- it supports directory listing, directory tree inspection, and file/path search;
- it is read-only by default unless write access is enabled;
- unnecessary tools can be disabled;
- normal retrieval does not require shell execution;
- content search is implemented in-process rather than requiring a separately installed `rg`;
- it has an npm distribution in addition to standalone/native channels.

### Why not Desktop Commander by default

Desktop Commander is more established and has strong search ergonomics, but it is intentionally a privileged local automation server with terminal/process, file mutation, and configuration mutation capabilities.

Dayloom needs only read-only World retrieval. Starting from a substantially broader authority surface would increase containment burden.

### Why not the official filesystem server alone

`@modelcontextprotocol/server-filesystem` is mature for file listing/reading, but its filesystem search is primarily path/glob oriented and does not independently satisfy Dayloom's required content-keyword search.

Combining it with a second content-search MCP would introduce two MCP lifecycles, two root configurations, two failure domains, and a combined namespace for one retrieval feature.

The single-server Rust design is preferred unless its distribution/security Gate fails.

## 8. Node.js distribution Gate

Using a Rust MCP server is acceptable because this is a process/protocol boundary rather than a Node native-addon ABI boundary.

Dayloom SHOULD consume the npm distribution when practical so users do not need Rust or `cargo install`.

Conceptually:

```text
Dayloom npm installation
      |
      +-- installs promptpile-mcp
      +-- installs filesystem MCP distribution
      |
Dayloom Core
      |
      +-- resolves packaged CLI/binary entry points
      +-- generates Session MCP config
      +-- owns process lifecycle
      `-- terminates resources with Session/Core cleanup
```

Before the filesystem MCP becomes a required runtime dependency, CI MUST prove the npm/native distribution path on every platform Dayloom officially supports.

The Gate MUST verify at least:

- clean npm installation;
- deterministic executable resolution without pre-existing global PATH installation;
- MCP initialize handshake;
- `tools/list`;
- directory listing;
- content search against UTF-8 Markdown/YAML/JSON;
- ranged file reads;
- read-only enforcement;
- outside-root rejection;
- symlink escape rejection;
- process cleanup;
- supported Linux/macOS/Windows architecture behavior.

If the npm/native distribution fails this Gate, select a fallback rather than adding ad-hoc user installation instructions.

Preferred fallback order:

1. another mature single-server read-only filesystem/search MCP with equivalent capability and reliable Node-friendly distribution;
2. official filesystem MCP plus a mature dedicated content-search MCP;
3. a pure Node MCP only if it independently satisfies content search, sandboxing, ranged reads, and maintenance requirements.

The fallback MUST preserve the same Dayloom-facing retrieval contract.

## 9. `promptpile-mcp` as the Session gateway

Dayloom SHOULD add `promptpile-mcp` as a packaged runtime dependency and use only its public CLI.

Do not import `promptpile-mcp/src/*` or `dist/*` internals.

One non-Init Session owns one long-lived gateway process:

```text
Session start
    |
    v
promptpile-mcp launch --config <session>/mcp.toml
    |
    +-- opens one stdio session to rust-mcp-filesystem
    |
    +-- binds loopback gateway
    |
    `-- stays alive across send/send/submit
```

Each Thought tool execution uses a short-lived executor:

```text
Thought completes
    |
    v
after-hook
    |
    v
promptpile-mcp exec-calls
  --base-url <session gateway>
  --input "$PROMPTPILE_ASSISTANT_CALL_FILE"
```

The long-lived gateway prevents repeatedly starting the filesystem MCP for every individual tool call.

### Session gateway configuration

Core generates `mcp.toml`. Caller configuration MUST NOT control the MCP root, command, tool allowlist, gateway token, or execution policy.

Conceptual configuration:

```toml
version = 1

[gateway]
port = <core-selected-loopback-port>
token = "<random-session-secret>"

[behavior]
failure_policy = "strict"
flat_names = true

[execution]
concurrency = 4
call_timeout_ms = <bounded>
failure_policy = "fail_fast"
retry_max_attempts = 1
retry_safe_tools = [
  "list_directory",
  "directory_tree",
  "search_files",
  "search_files_content",
  "read_file_lines",
]

[servers.archive]
command = "<resolved-filesystem-mcp-executable>"
args = ["<server-specific-readonly-args>", "<archive-view>"]
allowed_tools = [
  "list_directory",
  "directory_tree",
  "search_files",
  "search_files_content",
  "read_file_lines",
]
```

Exact server arguments are fixed only after Gate A validates the selected package version.

The gateway MUST bind loopback only.

Core SHOULD generate a random bearer token even for loopback use so another local process cannot casually reuse a live Session gateway.

Because `promptpile-mcp launch` currently requires a concrete port, Core MUST own collision-safe loopback port allocation/retry before marking the Session ready.

## 10. Model-visible tool surface

The first implementation MUST expose exactly these five retrieval capabilities:

```text
list_directory
directory_tree
search_files
search_files_content
read_file_lines
```

### `list_directory`

Inspect one directory level when the model knows roughly where relevant data lives.

Examples:

```text
list_directory("characters")
list_directory("days/day7")
```

### `directory_tree`

Orient the model in an unfamiliar World/subtree without many sequential list calls.

Tree output MUST be bounded by depth and/or bytes.

### `search_files`

Search by file/path name or glob when the model knows document shape but not exact location.

Examples:

```text
find all summary.md documents
find files under characters/alice
find day plan documents
```

### `search_files_content`

Primary semantic retrieval tool.

Search textual World documents by literal keyword or regex and return useful evidence:

```text
file path
line number / position
matching excerpt
```

The model then selects relevant hits and calls `read_file_lines`.

### `read_file_lines`

Read a bounded line range around relevant evidence.

This is preferred over unrestricted whole-file reading because it keeps long timelines, diaries, and memory files from becoming accidental eager context.

For genuinely small files, full-file behavior may be permitted only under the global tool-response bound.

## 11. Tools intentionally not exposed

Dayloom MUST prevent the model from receiving every unnecessary MCP capability, including tools that can:

- write or edit files;
- create/move/rename/delete files or directories;
- execute shell commands or processes;
- alter MCP configuration;
- change allowed roots dynamically;
- access paths outside the Session archive view;
- mutate Archive publication state.

The first implementation also SHOULD NOT expose redundant convenience capabilities such as:

- separate whole-file read variants;
- `head_file` / `tail_file`;
- bulk/multiple-file reads;
- file metadata/size tools;
- directory-size tools;
- duplicate/empty-file discovery;
- media readers;
- archive/zip helpers.

Bulk reads are particularly undesirable:

```text
search -> 20 hits -> read 20 full files -> excessive context
```

The intended vocabulary stays simple:

```text
Need orientation?
  -> directory_tree / list_directory

Know a file/path pattern?
  -> search_files

Know a fact/keyword?
  -> search_files_content

Need source context?
  -> read_file_lines
```

Prompt instructions are not a security boundary. Tool allowlisting and filesystem containment MUST be enforced outside model instructions.

## 12. Tool schema export and naming

Dayloom SHOULD NOT hand-write `.tools.toml` schemas for the five MCP tools.

Session startup should perform:

```text
promptpile-mcp launch
        |
        v
upstream tools/list
        |
        v
allowed_tools filter
        |
        v
promptpile-mcp export-tools
        |
        v
<session>/react/tools.toml
```

This makes the live third-party tool schema the source of truth while Dayloom owns only the exact allowlist.

If any required allowed tool is missing from `tools/list`, Session startup MUST fail.

Use:

```toml
[behavior]
flat_names = true
```

because the first implementation has exactly one model-facing MCP server. The model should see:

```text
search_files_content
read_file_lines
```

instead of:

```text
mcp__archive__search_files_content
mcp__archive__read_file_lines
```

If future Sessions expose multiple MCP servers with colliding names, revisit namespacing then.

## 13. After-hook execution path

Core generates a Session-private, platform-appropriate after-hook.

The hook MUST use Promptpile's exact calls artifact path and MUST NOT scan or guess the latest Conversation index.

Required behavior:

```text
if PROMPTPILE_HAS_TOOL_CALLS != "1":
    exit 0

require PROMPTPILE_ASSISTANT_CALL_FILE

promptpile-mcp exec-calls
    --base-url <session gateway>
    --token <session token>
    --input "$PROMPTPILE_ASSISTANT_CALL_FILE"
```

Promptpile's physical-directory artifact pairing remains authoritative:

```text
<work>/[idx]assistant.calls.jsonl
<work>/[idx]assistant.result.jsonl
```

Calls and results MUST remain in the same physical Conversation directory and index. No cross-layer result discovery is allowed.

The hook and gateway credentials live outside `archive-view` and are not visible to the filesystem MCP/model.

## 14. React loop policy and `max-step`

### Current problem

Dayloom currently hardcodes:

```text
max-step = 1
```

That prevents adaptive retrieval.

A normal archive question often requires:

```text
Thought 1
  search_files_content("Alice Bob")
      |
      v
Observe 1
  discovers relevant paths/line hits
      |
      v
Check = continue
      |
      v
Thought 2
  read_file_lines(relevant paths/ranges)
      |
      v
Observe 2
  enough evidence
      |
      v
Check = stop
      |
      v
Final
```

With `max-step = 1`, the model can see the search hits in Observe but cannot run a second Thought to read the discovered sources.

### Decision: default safety cap = 10

The first implementation SHOULD set the Core-owned React limit to:

```text
REACT_MAX_STEPS = 10
```

Rationale:

- mainstream agent runtimes commonly use an explicit safety cap around autonomous tool/model loops;
- OpenAI Agents SDK currently uses `maxTurns = 10` by default;
- Anthropic's current agent-loop documentation also uses a 10-turn cap in a representative tool-loop example;
- a limit of 10 is high enough for multi-hop retrieval and recovery without making the loop unbounded.

However, a Dayloom React step is heavier than a simple one-model-call agent turn:

```text
one Dayloom step =
  Thought model call
  + tool execution, if any
  + Observe model call
  + Check model call
```

Therefore `10` is a hard ceiling, not an expected execution length.

Operational expectation:

```text
simple answer       1-2 steps
normal retrieval    2-4 steps
complex retrieval   4-7 steps
hard safety ceiling 10 steps
```

Check MUST continue to terminate as soon as the latest Observe is sufficient.

Do not disable the cap.

The `llmConfigPath` caller MUST NOT be allowed to arbitrarily raise this limit in the first implementation. It is a Core runtime policy.

The existing Dayloom Process Pile reducer is already structured around the runtime-reported `max_steps` and multiple step indices; implementation should remove the product-level fixed-one assumption and expand tests rather than introduce a new event protocol.

### Cost/latency guardrails

Because a 10-step ceiling can imply many model calls, the implementation SHOULD also measure and eventually bound:

- total React wall-clock duration;
- total tool-call count;
- total tool-result bytes;
- total model invocations/tokens where available.

These are operational budgets, not World-authority rules.

## 15. Thought, Observe, Check, and Final responsibilities

### Thought

Thought is the only general retrieval-tool phase.

It reads authoritative Conversation layers plus prior Session work, sees the five tools, and may create MCP calls.

Thought SHOULD use progressive retrieval:

```text
orient/search
  -> inspect hits
  -> bounded read
  -> refine only if needed
```

It SHOULD NOT dump the entire archive tree or broad file sets when a narrower query is possible.

### Observe

Observe reads authoritative Conversation plus the Session work directory, which contains prior Thought calls and MCP result artifacts.

Observe is responsible for converting raw retrieval evidence into a self-contained handoff for later phases.

It SHOULD preserve important provenance such as source path and relevant line/range when useful.

Suggested logical content:

```text
CONFIRMED FACTS
- ...

SOURCE EVIDENCE
- characters/alice/...
- days/day12/...

UNRESOLVED
- ...

NEXT RETRIEVAL
- ...
```

Observe has no general tools.

### Check

Check sees the Observe report and decides whether another outer step is needed.

Continue when, for example:

- search found promising paths but source content has not been read;
- retrieved evidence conflicts and needs another source;
- an exact entity/document ID is still unresolved;
- submit requires an exact current value that has not been verified.

Stop as soon as the Observe handoff is sufficient.

### Final

Final has no general retrieval tools and does not read hidden Thought work directly.

It relies on authoritative Conversation plus the latest successful Observe handoff.

Therefore Observe MUST carry forward any MCP-derived facts required by Final.

This keeps the user-visible/structured Final separated from hidden agent work.

## 16. `send()` and `submit()` integration

Both Dayloom paths SHOULD use the same Session retrieval runtime:

```text
sendConfig
submitConfig
  |
  +-- same tools.toml
  +-- same after-hook
  +-- same pinned archive-view
  `-- same Session promptpile-mcp gateway
```

The distinction remains in Final behavior:

```text
send
  -> conversational Final

submit
  -> structured submission Final
  -> Core parser
  -> semantic validation
  -> publication
```

Submission needs retrieval too, especially for:

- canonical entity IDs;
- exact current state values;
- plan/beat references;
- revise `expected` values;
- current relations/arc state;
- evidence needed to avoid stale semantic assumptions.

MCP access does not weaken submission authority. The model still proposes; Core still validates and publishes.

## 17. Session lifecycle

For `planning`, `play`, and `revise`:

```text
startSession(kind)
  |
  +-- pin current PublishedWorld
  |
  +-- create Session workspace
  |
  +-- materialize archive-view from pinned RootTree
  |
  +-- resolve promptpile-mcp packaged CLI
  |
  +-- resolve filesystem MCP packaged executable
  |
  +-- generate mcp.toml
  |
  +-- allocate loopback port + random gateway token
  |
  +-- launch promptpile-mcp
  |      `-- launches rust-mcp-filesystem against archive-view
  |
  +-- wait for gateway/tool discovery readiness
  |
  +-- export required allowed tools -> tools.toml
  |
  +-- generate Session after-hook
  |
  +-- generate send/submit React configs referencing tools + hook
  |
  +-- append immutable bootstrap context
  |
  `-- Session ready
```

An `init` Session has no published archive and MUST NOT expose archive retrieval unless a later design defines a separate draft-World view.

The gateway is Session-owned and remains alive across multiple sends until submit/cancel/terminalization/disposal.

## 18. Child process ownership and cancellation

Dayloom currently has a foreground `activeChild` concept used for transient operations such as Promptpile/React.

The long-lived MCP gateway MUST NOT be stored only in that same slot.

Use a separate Session-owned runtime object, conceptually:

```ts
interface ArchiveRetrievalSessionRuntime {
  sessionId: string;
  gatewayChild: ChildProcess;
  baseUrl: string;
  token: string;
  toolsPath: string;
  hookPath: string;

  close(): Promise<void>;
}
```

Core ownership:

```text
activeChild
  = current foreground append/compress/React operation
  = interruptible by operation cancel

archiveRetrieval
  = Session service
  = survives one send()
  = closed by Session terminalize/dispose
```

Cancellation of a running React operation should kill the foreground React child as today. Session terminalization then closes the MCP gateway and removes Session runtime state.

`dispose()` MUST close both foreground and Session-service children and remain idempotent.

Gateway child exit before terminalization marks retrieval unavailable; Core MUST NOT silently start a gateway against a different World revision.

## 19. Immutable bootstrap context after MCP introduction

MCP retrieval should reduce eager context injection, not eliminate the authoritative bootstrap layer.

Core should continue injecting the small set of facts required to orient every run without a tool call:

- World identity;
- pinned revision;
- Session kind;
- phase/current day/last settled day;
- current Play plan for Play;
- small canon/control facts proven economical to keep eager;
- explicit retrieval/authority rules.

Large collections should migrate toward on-demand retrieval:

- all character documents;
- all location documents;
- all arc documents;
- memory collections;
- story seeds;
- older day documents.

Migration SHOULD be incremental.

First implementation:

```text
existing safe bootstrap/eager context
+
MCP retrieval
```

After behavior/equivalence tests:

```text
smaller bootstrap
+
on-demand retrieval
```

Do not delete broad eager context in the same first patch that introduces MCP lifecycle unless tests prove the replacement behavior.

## 20. Authority model

MCP tool output is data, not instruction authority.

World documents returned by MCP are authoritative as pinned World facts only according to Dayloom World Profile semantics. Instruction-like text inside a World document remains document content and MUST NOT override Core-owned prompts, schemas, IDs, lifecycle rules, or publication ownership.

Authority order:

```text
Core-owned system/session policy
    > pinned Dayloom control facts and schemas
    > pinned World document facts retrieved through MCP
    > writable Conversation history and model-produced text
```

A World document containing `ignore previous instructions` is narrative/data content, not a system instruction.

## 21. Search behavior and output bounds

Preferred retrieval pattern:

```text
search_files_content(query)
        |
        v
path + line + excerpt
        |
        v
select relevant source
        |
        v
read_file_lines(path, nearby offset, bounded limit)
```

The model SHOULD narrow searches with path/glob filters when practical.

Binary/unrecognized content should be rejected or represented only through explicit metadata; retrieval is primarily for textual World Profile documents.

Dayloom MUST impose outer response bounds even if the third-party server has its own limits.

At minimum:

```text
tool call timeout
maximum returned bytes
maximum search matches/results
maximum directory-tree output
maximum line-read output
```

Initial values should be conservative and fixture-tested. Example starting points:

```text
search timeout:        a few seconds
search result count:   about 100 matches
single tool response:  tens of KiB, e.g. about 64 KiB
```

These are not protocol constants.

When truncation occurs, the model MUST be told explicitly:

```text
Results truncated. Narrow path, glob, query, or requested line range.
```

Silent truncation is not acceptable.

## 22. Path and sandbox rules

The MCP root is exactly the Session `archive-view`.

Effective policy MUST reject:

- `..` escape;
- absolute paths outside the view;
- symlinks escaping the view;
- special/device files;
- sockets/FIFOs;
- any path not materialized from the pinned RootTree or generated by Core as approved read-only metadata.

Core should avoid symlinks in the archive view entirely.

`rust-mcp-filesystem` MUST be launched in read-only mode.

Dynamic MCP Roots support SHOULD remain disabled so the model/client cannot retarget the Session server.

The configured MCP root is a defense layer in addition to Core's minimal Session-specific projection.

If platform testing reveals weaker path/symlink guarantees than required, the candidate fails the security Gate.

## 23. Failure semantics under the "no Promptpile modification" constraint

Retrieval failures do not mutate World state.

Expected classes:

- archive-view materialization failure;
- filesystem MCP executable cannot be resolved;
- `promptpile-mcp` executable cannot be resolved;
- gateway port/startup/readiness failure;
- upstream MCP initialize/tools-list failure;
- required allowed tool missing;
- invalid/out-of-sandbox path;
- tool timeout;
- response bound/truncation condition;
- gateway/upstream process exit;
- result publication/execution-claim failure.

### Startup

Session startup MUST be strict.

A non-Init Session MUST NOT become `ready` unless:

- archive-view exists and is valid;
- gateway is live;
- upstream MCP is connected;
- all five allowed tools were discovered;
- `tools.toml` was exported successfully.

Do not fall back to the physical Archive root.

### During a React run

There is an important existing Promptpile constraint:

- Promptpile root completion supports `--after-hook-failure error` and `--missing-tool-results error`;
- current `promptpile-react` exposes Thought `--tools-file` and `--after-hook-path`, but does not expose those two strict policy switches;
- React passes the shared configuration file as an LLM profile database to Promptpile rather than as Promptpile runtime policy.

Therefore Dayloom cannot assume that an after-hook infrastructure failure automatically makes the Thought subprocess nonzero without adding a new Promptpile surface.

For the first implementation, while Promptpile remains unchanged:

1. gateway/tool startup is fail-closed before Session readiness;
2. tool-level execution failures returned through normal result artifacts are treated as retrieval errors, not facts;
3. missing/failed retrieval must be reflected by Observe as unresolved;
4. prompts MUST forbid inventing missing file content;
5. Core publication validation remains unchanged, so retrieval failure cannot directly mutate/publish World state;
6. keep enough immutable/eager context during the initial migration that an infrastructure warning does not silently become an authority substitution.

If strict "after-hook failed => entire Thought must fail immediately" becomes a product requirement, implement it at a Dayloom-owned process boundary only if it can be made cross-platform and package-safe; otherwise it requires an explicit future Promptpile public-surface change and is outside this draft.

This limitation MUST be covered by tests and must not be hidden behind wording such as "fully fail-closed tool execution" until it is actually true.

## 24. Relationship to submission and publication

Archive Retrieval MCP is strictly read-only.

Existing write path remains:

```text
AI reasoning / MCP reads
        |
        v
structured submission candidate
        |
        v
Core parser + schema validation
        |
        v
semantic mutation builder
        |
        v
pinned-base conflict check
        |
        v
Archive publication
```

No MCP file edit may become an implicit World mutation.

Future AI-authored candidate-file workflows require a separate writable candidate workspace with explicit validation/publication semantics and are not part of this draft.

## 25. Dayloom package and code changes

Expected Core-only implementation surface:

| File/area | Change |
| --- | --- |
| `packages/core/package.json` | add `promptpile-mcp` and selected filesystem MCP runtime dependencies |
| `packages/core/src/promptpile/binaries.ts` | resolve packaged `promptpile-mcp` and filesystem MCP executable/package entry |
| new `packages/core/src/promptpile/archive-retrieval.ts` | Session gateway config, launch/readiness, tool export, hook generation, shutdown |
| Session workspace/common types | add archive-view/MCP config/tools/hook paths |
| `packages/core/src/promptpile/config.ts` | derive React config with Core-owned tools file + after-hook |
| `packages/core/src/promptpile/react-runner.ts` | replace fixed one-step policy with Core-owned `max-step = 10`; expand multi-step reducer tests |
| `packages/core/src/core.ts` | own Session retrieval service separately from foreground child; start/terminalize/dispose integration |
| lifecycle/play prompts | describe retrieval strategy and authority rules |
| Core tests/pack smoke | validate packed CLI resolution, lifecycle, multi-step retrieval, cleanup |

Promptpile packages remain external CLI dependencies. Do not deep-import their implementation files.

## 26. Implementation Gates

### Gate A - dependency/distribution validation

- verify `@rustmcp/rust-mcp-filesystem` provenance and npm/native behavior;
- select/pin exact tested version;
- test clean install;
- resolve executable locally, not from global PATH;
- test stdio initialize/tools-list/call lifecycle through `promptpile-mcp`;
- supported OS/architecture CI;
- verify read-only configuration;
- verify required five-tool allowlist;
- verify dynamic roots cannot retarget Session server;
- verify process cleanup.

Gate A failure selects a fallback MCP without weakening Sections 2-24.

### Gate B - archive-view projection

- materialize pinned RootTree into Session logical directory;
- preserve canonical World paths;
- exclude Archive control-plane/runtime paths;
- reject unsafe links/types;
- make view read-only;
- cleanup/integrity tests.

### Gate C - Session `promptpile-mcp` runtime

- add `ArchiveRetrievalSessionRuntime`;
- generate strict Session `mcp.toml`;
- select loopback port with collision retry;
- generate random token;
- launch one gateway;
- wait for readiness;
- export exact five tools;
- generate after-hook;
- keep gateway alive for Session;
- stop gateway on terminalize/dispose.

### Gate D - Promptpile/React integration

- `sendConfig` and `submitConfig` reference generated `tools.toml` and after-hook;
- set Core React max-step to 10;
- verify multi-step `search -> read -> refine` behavior;
- preserve Process Pile event validation and user-visible Final streaming;
- ensure Observe carries retrieved evidence into Final;
- do not add a second Core tool-call executor.

### Gate E - prompt/context adaptation

- teach Thought progressive retrieval;
- teach Observe evidence/provenance handoff;
- teach Check when to continue/stop;
- teach Final that retrieval work arrives via Observe;
- retain minimal authoritative bootstrap;
- reduce broad eager World injection only after equivalence tests.

### Gate F - limits and operational budgets

- deterministic per-tool timeout;
- search-result bound;
- tree-output bound;
- line-read/output byte bound;
- explicit truncation signal;
- measure worst-case 10-step model/tool cost;
- define telemetry needed to tune normal termination to 1-4 steps.

## 27. Tests

Add tests covering at least:

- npm-installed `promptpile-mcp` and filesystem MCP can be resolved;
- gateway starts on loopback and requires the Session token when configured;
- exact five read-only tools are exported;
- write/edit/process/config/root-retargeting tools are absent;
- missing required allowed tool fails Session startup;
- directory listing sees only pinned reachable documents;
- directory tree is bounded;
- path/file search finds expected documents;
- keyword and regex content search find matching content;
- content search returns usable path/line/excerpt evidence;
- ranged reads return exact pinned document text;
- search/read output limits are explicit;
- historical/unreachable blobs cannot appear;
- Archive control-plane files are inaccessible;
- traversal and symlink escape fail;
- Session pinned at `R42` keeps reading `R42` after World advances to `R43`;
- gateway survives multiple `send()` operations in one Session;
- after-hook uses exact `PROMPTPILE_ASSISTANT_CALL_FILE`, not directory guessing;
- result artifact becomes visible to the following Observe;
- two-step `search -> read` retrieval succeeds;
- 3+ step refine flow succeeds;
- Check can terminate before max-step;
- max-step 10 produces valid Process Pile sequence if actually reached;
- Final does not need direct tool access;
- submit can retrieve exact IDs/current values before structured Final;
- Session terminalization closes gateway and removes archive-view/runtime files;
- cancel/dispose do not confuse foreground child with Session gateway;
- MCP failure cannot partially publish/mutate World;
- existing submission conflict detection remains unchanged;
- current Promptpile after-hook warning limitation is covered explicitly;
- supported platform/architecture CI proves distribution reliability.

## 28. Acceptance criteria

This draft is implemented when all are true:

1. A non-Init Session starts one isolated Session-owned `promptpile-mcp` gateway against a pinned read-only archive view.
2. The gateway starts the selected third-party filesystem MCP through stdio.
3. The model sees exactly five retrieval tools.
4. Tool schemas are exported from live MCP discovery rather than duplicated in Dayloom.
5. The model can list directories and inspect a bounded tree.
6. The model can search file/path names.
7. The model can search contents by literal keyword and regex.
8. Search results provide enough source location/context to drive ranged reads.
9. The model can read bounded line ranges.
10. Calls execute through Promptpile calls/result artifacts and `promptpile-mcp exec-calls`.
11. The after-hook targets the exact calls artifact path.
12. Observe sees tool results and can hand them to Final.
13. React supports multi-step adaptive retrieval with a Core-owned safety cap of 10.
14. Check normally terminates before the cap when evidence is sufficient.
15. `send()` and `submit()` use the same pinned retrieval runtime.
16. The MCP-visible filesystem is derived only from the Session-pinned RootTree.
17. The view remains stable if `current.json` advances during the Session.
18. No write/edit/shell/process/config/root-retargeting tool is exposed.
19. MCP cannot access Archive control-plane paths or host paths outside the view.
20. MCP reads cannot mutate Archive blobs/candidate/published World state.
21. Search/tree/read calls have explicit timeout/output/result bounds.
22. Core remains the sole validator and publisher.
23. Gateway lifecycle is separate from foreground React child lifecycle.
24. Session cleanup/cancel/dispose behavior is deterministic and leak-free.
25. The npm/native distribution passes supported-platform CI.
26. Tests prove revision pinning, sandboxing, multi-step retrieval, lifecycle cleanup, distribution behavior, and the known Promptpile failure-policy boundary.
27. No Promptpile source modification is required.

## 29. Remaining open questions

The MCP implementation choice is no longer open for the first attempt: `@rustmcp/rust-mcp-filesystem` is selected subject to Gate A.

The Promptpile integration path is also fixed for the first implementation: `promptpile-react` Thought tools + after-hook + `promptpile-mcp` gateway/executor.

The React safety limit is fixed at `max-step = 10` for the first implementation; tuning should focus on earlier Check termination and operational budgets rather than raising the cap.

Remaining questions:

- exact filesystem MCP dependency version after Gate A;
- exact supported OS/architecture matrix;
- exact server-specific read-only argv/config;
- loopback port allocation/retry implementation;
- exact timeout/search-count/tree/byte limits;
- total tool-call/model-invocation operational budgets;
- whether canon remains eager after retrieval is stable;
- whether `days/` exposes all pinned historical day documents or a narrower policy;
- whether archive-view materialization is eager copy or future lazy verified projection;
- whether retrieval traces belong only in ephemeral diagnostics or durable audit;
- whether a future product requirement justifies adding a strict after-hook failure propagation surface to Promptpile.

Until these are resolved, the invariants, public Promptpile integration boundaries, selected tool contract, revision pinning, and Core-owned 10-step safety cap in this document are the implementation constraints.

## 30. External reference points for loop cap

The `max-step = 10` choice is a product/runtime safety baseline, not a claim that framework "turn" semantics are identical.

Reference points checked on 2026-08-25:

- OpenAI Agents SDK JavaScript documents `maxTurns = 10` as the default run safety limit.
- Anthropic's agent/tool-loop documentation uses `MAX_TURNS = 10` in a representative agent loop example.

Dayloom keeps the same order-of-magnitude safety ceiling while relying on Check to stop substantially earlier because each Dayloom outer step contains Thought, Observe, and Check model phases.
