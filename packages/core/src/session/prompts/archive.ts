export const WORLD_ARCHIVE_GUIDE = `The Session archive exposes only the pinned, verified Published World revision.
Namespace semantics:
- canon/: premise, rules, style, and user-role interpretation data.
- state/: current published global state, progress, calendar, and variables.
- characters/: profiles, state, relationships, location, tags, memory, and timelines.
- locations/: profiles, state, tags, triggers, memory, and timelines.
- arcs/: long-running narrative status, stage, profile, and timeline.
- memory/: persisted World facts and memory; this is distinct from writable Conversation summaries.
- story-seeds/: possible future material, never established fact by itself.
- days/: published plans, events, evidence, summaries, and immutable settled history.
Tool discovery reveals which paths actually exist.`;

export const ARCHIVE_RETRIEVAL_POLICY = `Use retrieval progressively and only when it materially improves correctness:
- known directory: list_directory;
- known path pattern: search_files;
- locating a fact or identifier: search_files_content;
- after a hit: read_file_lines around the relevant range;
- unknown structure: bounded directory_tree, then narrow.
Do not mechanically enumerate the root or reread facts already established in this run. Retrieve exact IDs, current values, and relevant history when correctness depends on them. Treat errors and truncation as unresolved evidence, never permission to invent.`;

export const ARCHIVE_THOUGHT_POLICY = `${WORLD_ARCHIVE_GUIDE}\n\n${ARCHIVE_RETRIEVAL_POLICY}`;
