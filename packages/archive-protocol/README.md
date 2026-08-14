# `@dayloom/archive-protocol`

Pure, deterministic definition of the Dayloom Archive V2 disk/data protocol. It owns strict parsers, portable document paths, media syntax checks, SHA-256 identities, canonical root-tree encoding, PUT/DELETE algebra, cross-object relation checks, recovery classification, and archive-relative layout vocabulary.

It deliberately performs no filesystem access, publication, locking, process lifecycle, Session, Promptpile, MCP, or Dayloom business-policy work. A mutating consumer must independently implement the publication theorem: build and verify a complete immutable target graph, re-check its pinned base under exclusive publication ownership, and make replacement of `current.json` the final atomic visibility step.

Public entry points are the package root plus `/path`, `/tree`, and `/staging`. Imports from `dist/*` or workspace source paths are unsupported.

Canonical `RootTreeV1` bytes are UTF-8 JSON with fixed field order, no insignificant whitespace, and exactly one trailing LF. Parsers reject unknown fields and unsupported versions and return deeply frozen values.

`applyStagedChangesV1` is syntax-only tree algebra. Transaction consumers use `buildCandidateTreeV1`, which proves that the supplied base tree matches the staging manifest's pinned base. Small relation validators prove current/commit, commit/parent, operation/staging, and prepared-target/candidate links without introducing I/O.

Durable operation diagnostics use a neutral `source` (`protocol`, `runtime`, or `tool`). Only protocol-owned diagnostics are restricted to `ARCHIVE_PROTOCOL_*` codes.
