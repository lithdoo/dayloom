# Dayloom Draft V1 — Design Draft

Status: draft

## 1. Goal

`@dayloom/draft` is a deliberately thin Dayloom-specific wrapper around `promptpile-react`.

It does not define a new conversation runtime, session model, memory system, or agent protocol. Its job is to bind Dayloom-specific prompts and MCP policy to an existing Promptpile Conversation and forward one user turn into one Promptpile React run.

The intended shape is:

```text
user input
   ↓
@dayloom/draft
   ↓
Dayloom prompts + Dayloom MCP policy
   ↓
promptpile-react
   ↓
Promptpile Conversation + React output
```

The package should remain close to this model unless concrete product requirements force a deeper abstraction.

## 2. Core principles

1. One invocation is one React turn.
2. Conversation ownership belongs to Promptpile.
3. Draft ownership remains file-native and explicit in CLI arguments.
4. World access is read-only.
5. Draft access is read-write, constrained by the exact Draft input authority selected by the caller.
6. Dayloom injects business prompts and MCP policy, but does not redefine Promptpile orchestration.
7. Promptpile React stdout/stderr/output-format/exit semantics should be forwarded with as little translation as possible.
8. V1 should not introduce `DraftRuntime`, `DraftSession`, `ConversationManager`, `MemoryManager`, `TurnCoordinator`, or equivalent deep abstractions.

## 3. Proposed CLI surface

The initial command is a single-turn command. The Dayloom business command is an optional positional argument:

```text
dayloom-draft [command] [options]
```

Supported Draft-driven commands in V1:

```text
init
plan
play
revise
```

Commands such as `settle`, `abandon`, `status`, and `verify` are not Draft-generation commands and are out of scope for this package.

Example with an explicit command:

```bash
dayloom-draft play \
  --world ./world \
  --draft ./draft.md \
  --conversation ./conversation \
  --llm-config ./promptpile.toml \
  --message "今天先去找林" \
  --output-format stream-json
```

Example with command inference:

```bash
dayloom-draft \
  --world ./world \
  --draft ./draft.md \
  --conversation ./conversation \
  --llm-config ./promptpile.toml \
  --message "继续今天的行动"
```

Proposed arguments:

```text
[command]                     optional: init | plan | play | revise

--world <dir>                 required exactly once
--draft <file>                repeatable; one or more explicit Draft files
--draft-dir <dir>             one Draft directory; mutually exclusive with --draft
--conversation <dir>          required exactly once
--llm-config <file>           required exactly once
--message <text>              required exactly once for V1
--output-format <mode>        optional: text | stream-json; default text
--help
--version
```

`--draft` and `--draft-dir` mirror the existing `@dayloom/cli` Draft input surface.

The CLI should reject duplicate non-repeatable options and unknown arguments.

## 4. Command selection and World-state validation

The selected Dayloom command determines the business prompt and any command-specific MCP policy for the React turn.

### 4.1 Explicit command

If the caller supplies a command, it is authoritative user intent, but it must still be valid for the current World state.

Conceptually:

```text
explicit command
   ↓
classify current World
   ↓
compute available Draft-driven commands
   ↓
command available?
   ├─ yes → use it
   └─ no  → fail closed
```

The wrapper must not run a `play` Draft turn against a World that is not in a state where `play` is available, and must apply the same principle to `init`, `plan`, and `revise`.

### 4.2 Omitted command

If the caller omits the command, the package may infer it from the current World state only when exactly one Draft-driven command is available.

Rules:

```text
available Draft-driven commands = [exactly one]
→ infer that command

available Draft-driven commands = []
→ fail: current World state cannot start a Draft-driven command

available Draft-driven commands = [more than one]
→ fail: command is ambiguous; caller must specify it explicitly
```

The package must not silently choose a default when multiple business commands are valid.

Example:

```text
uninitialized World
→ available: init
→ infer init

planned World
→ available: play
→ infer play

idle World
→ available: plan, revise
→ ambiguous
→ require explicit command
```

The exact availability rules should reuse the existing Dayloom World classification / command-availability semantics rather than define a second state machine in `@dayloom/draft`.

### 4.3 Missing, uninitialized, valid, and invalid World

Command inference must distinguish at least these cases:

```text
missing/uninitialized World
valid World
invalid/corrupt World
```

A missing or uninitialized World may make `init` uniquely available.

An invalid or corrupt World must fail closed. It must not be treated as equivalent to an uninitialized World and must not be auto-inferred as `init`.

## 5. Draft input authority

V1 supports three forms of Draft input.

### 5.1 Single file

```bash
--draft ./draft.md
```

Authority:

```text
read:  ./draft.md
write: ./draft.md
```

### 5.2 Multiple explicit files

```bash
--draft ./intent.md \
--draft ./notes.md \
--draft ./constraints.md
```

`--draft` is repeatable.

Authority is the exact selected file set:

```text
read/write:
  ./intent.md
  ./notes.md
  ./constraints.md
```

Selecting files does not implicitly grant write access to sibling files in their parent directories.

### 5.3 Draft directory

```bash
--draft-dir ./draft
```

Authority:

```text
read/write: ./draft/**
```

The exact create/delete policy can be constrained by the MCP tool surface. The important V1 rule is that the selected directory is the Draft capability boundary.

### 5.4 Mutual exclusion

The two input forms are mutually exclusive:

```text
one or more --draft
OR
one --draft-dir
```

They must not be supplied together.

At least one Draft input form is required.

## 6. World authority

`--world <dir>` identifies the Dayloom World available to the agent and is also the source used for command validation/inference.

World access presented to the React agent is strictly read-only.

The React agent may inspect the World to understand current canon, control state, plans, entities, and other relevant context, but it must not modify the World.

This restriction must be enforced at the actual MCP/tool boundary rather than only through prompting.

Conceptually:

```text
World  → RO
Draft  → RW
```

## 7. Conversation ownership

`--conversation <dir>` points to the Promptpile Conversation used for the turn.

`@dayloom/draft` does not define another conversation representation and should not duplicate Promptpile conversation state.

Repeated invocations against the same Conversation continue the same interaction:

```bash
dayloom-draft play ... --conversation ./conversation --message "先调查酒馆"

dayloom-draft play ... --conversation ./conversation --message "还是先不要找老板"
```

The Conversation directory remains Promptpile-native and may later use Promptpile compression, archive search, fork, and related lifecycle tooling without requiring a Dayloom-specific conversation format.

## 8. User message

`--message <text>` supplies the user message for this React turn.

V1 treats one invocation as exactly one user-message turn, so exactly one message is required.

The initial implementation may pass this message into Promptpile React through the most direct supported input path. Supporting stdin or message-file input can be added later if a concrete need appears; those forms are not part of the initial V1 CLI contract yet.

## 9. Promptpile React integration

The central implementation should be close to a parameterized `promptpile-react` invocation.

The wrapper should provide:

- the resolved Dayloom command;
- Dayloom Thought prompt;
- Dayloom Observe prompt;
- Dayloom Check prompt;
- Dayloom Final prompt;
- MCP configuration/tool surface for World and Draft;
- the caller-provided Conversation directory;
- the caller-provided LLM configuration;
- the caller-provided user message;
- the requested Promptpile React output format.

Conceptually:

```text
parse arguments
   ↓
classify World
   ↓
validate or infer command
   ↓
validate paths and Draft authority
   ↓
launch/configure Dayloom MCP services
   ↓
prepare command-specific Dayloom React prompts
   ↓
invoke promptpile-react
   ↓
forward output
   ↓
return React exit status
```

No independent Dayloom agent loop should sit around React in V1.

## 10. React turn behavior

A single invocation corresponds to one Promptpile React session for the supplied user message.

Expected business behavior:

```text
User message
   ↓
Thought
  - understand the latest user intent
  - inspect World when needed
  - inspect existing Draft when needed
  - update Draft through allowed tools
   ↓
Observe
  - assess whether this turn's Draft work is complete
   ↓
Check
  - continue or stop according to React semantics
   ↓
Final
  - produce the user-facing reply
```

The Dayloom wrapper should rely on Promptpile React for Thought/Observe/Check/Final orchestration rather than recreating it.

## 11. MCP composition

V1 needs two logical capabilities.

### World MCP

Read-only tools only.

Typical capabilities may include:

```text
list_directory
read file content
search files/content
directory tree
```

No write/delete/mutation tool should be exported.

### Draft MCP

Read-write tools constrained to the selected Draft authority.

For explicit-file mode, writes are limited to the selected files.

For directory mode, writes are limited to the selected subtree.

The exact upstream MCP implementation is an implementation detail. The externally important contract is the capability boundary.

## 12. Command-specific business prompt responsibility

The core value of this package is Dayloom-specific policy, not generic agent runtime infrastructure.

The resolved command selects the relevant Dayloom business prompt set.

For example:

```text
init
  - World may be missing/uninitialized
  - build initial Draft intent for World creation

plan
  - inspect current World read-only
  - focus on next-day planning intent

play
  - inspect current World and current plan read-only
  - focus on current-day action/play intent

revise
  - inspect existing long-term World read-only
  - focus on requested revision intent
```

The prompts should establish rules such as:

- Draft is semantic input for later Dayloom CLI execution;
- Draft is not a World mutation DSL;
- current World may be inspected but not modified;
- user intent should be reflected in Draft content;
- superseded or rejected intent should not remain authoritative merely because it appeared earlier in the conversation;
- the model must not treat its own suggestions as user-confirmed intent;
- Final should be natural user-facing conversation rather than an internal Draft dump.

The exact prompt content is intentionally left open in this design draft.

## 13. Output format and stream ownership

V1 should use the Promptpile React term `--output-format` rather than introduce a separate Dayloom `--pipe` abstraction.

Supported initial values:

```bash
--output-format text
--output-format stream-json
```

Default:

```text
text
```

The option should map as directly as possible to Promptpile React's native output-format behavior.

For `stream-json`:

```text
stdout = Promptpile React Agent Event Protocol v1 JSONL
stderr = human diagnostics / child stderr
exit status = Promptpile React execution result
```

No separate `--channel` argument is needed in V1 because Promptpile React already owns and defines stdout/stderr channel semantics for its machine-readable stream.

V1 should avoid:

- defining a Dayloom output channel abstraction;
- renaming React events;
- wrapping every event in a Dayloom envelope;
- parsing and serializing output unnecessarily;
- changing stdout/stderr ownership without a concrete requirement.

This allows a future TUI to consume the Promptpile React stream directly through this thin Dayloom command.

## 14. LLM configuration

`--llm-config <file>` is the Promptpile/Promptpile React configuration supplied by the caller.

Dayloom should not introduce a separate provider/model configuration layer in V1.

Provider profiles, model selection, base URLs, API key environment variables, temperatures, and other model-specific options remain Promptpile configuration concerns.

## 15. CLI validation summary

The initial V1 parser should enforce the following surface-level rules:

```text
command
  optional positional
  allowed: init | plan | play | revise
  if provided: must be valid for current World state
  if omitted: infer only when exactly one Draft-driven command is available

--world
  required exactly once

--draft
  repeatable
  one or more when file mode is selected

--draft-dir
  at most once
  mutually exclusive with --draft

Draft input
  exactly one of:
    one or more --draft
    one --draft-dir

--conversation
  required exactly once

--llm-config
  required exactly once

--message
  required exactly once

--output-format
  optional
  values: text | stream-json
  default: text
```

Unknown arguments, duplicate non-repeatable arguments, invalid values, invalid World state, invalid Draft authority, or ambiguous command inference should fail before starting Promptpile React.

## 16. Relationship with @dayloom/cli

`@dayloom/draft` and `@dayloom/cli` intentionally have opposite authority over the same boundary.

```text
@dayloom/draft
  World → read-only
  Draft → read-write

@dayloom/cli
  Draft → read-only semantic input
  World workspace → controlled mutation
```

A Draft produced or edited by this package should be directly reusable as input to the existing CLI.

Examples:

```bash
dayloom-draft play \
  --world ./world \
  --draft ./intent.md \
  --draft ./constraints.md \
  --conversation ./conversation \
  --llm-config ./promptpile.toml \
  --message "不要主动攻击守卫"
```

Then:

```bash
dayloom play ./world \
  --draft ./intent.md \
  --draft ./constraints.md \
  --llm-config ./promptpile.toml
```

Or directory mode:

```bash
dayloom-draft \
  --world ./world \
  --draft-dir ./draft \
  --conversation ./conversation \
  --llm-config ./promptpile.toml \
  --message "继续完善今天的行动意图"

# command may be inferred as play when play is uniquely available
# later

dayloom play ./world \
  --draft-dir ./draft \
  --llm-config ./promptpile.toml
```

There should be no Draft format conversion step between the two packages.

## 17. Promptpile ecosystem compatibility

V1 does not need to wrap every Promptpile package, but its thin architecture should remain compatible with them.

In particular:

- `promptpile-react` remains the agent loop;
- `promptpile-mcp` can provide tool execution/gateway composition;
- `promptpile-compress` may maintain a long Conversation independently;
- `promptpile-compress-grep-search` may expose archived Conversation history when needed;
- `promptpile-fork` may snapshot or branch a Conversation directly;
- `promptpile-protocol` remains the stable protocol surface when Dayloom must interpret a public Promptpile artifact.

These capabilities should not be hidden behind new Dayloom equivalents unless a real business requirement appears.

## 18. Non-goals for V1

V1 explicitly does not introduce:

- a Dayloom-owned Conversation protocol;
- a Dayloom Session database;
- persistent Draft revision/CAS machinery;
- a second agent orchestration engine;
- a generic memory abstraction;
- a custom event protocol;
- a custom stdout/stderr channel abstraction;
- a Draft-to-World converter;
- World publication;
- settle logic;
- conversation branching abstractions;
- automatic Draft schema design;
- TUI behavior.

Those concerns either already belong to Promptpile / `@dayloom/cli` or should be added only after concrete requirements appear.

## 19. Initial implementation shape

The implementation should stay small. A likely initial layout is:

```text
packages/draft/
  package.json
  README.md
  doc/
    DESIGN_DRAFT_V1.md
  src/
    main.ts
    argv.ts
    react.ts
    mcp.ts
    prompts/
      init/
      plan/
      play/
      revise/
```

Prompt files may later be split into Thought/Observe/Check/Final files per command if that proves clearer. This layout is illustrative, not a requirement. If the implementation can remain simpler, fewer files are preferred.

## 20. V1 summary

The intended primitive is:

```text
@dayloom/draft
=
promptpile-react
+ Dayloom command resolution
+ Dayloom business prompts
+ Dayloom MCP authority wiring
```

The command accepts an existing Promptpile Conversation, a read-only World, and either explicit Draft files or a Draft directory. It validates or infers one Draft-driven Dayloom command, runs one React turn for one user message, and forwards React output with minimal abstraction.

The package should remain low-level, file-native, explicit, and composable so a future TUI can build on it without inheriting another heavyweight core runtime.
