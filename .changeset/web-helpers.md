---
'@memoriam/api': patch
'@memoriam/core': patch
'@memoriam/web': patch
---

The stale tab, the install prompt and the command registry tell their listeners through one emitter and store (`store/emitter.ts`), in place of a listener set written out in each.

`hooks/useLatest.ts` holds the last value rendered in a ref, for the command and key hooks that follow.

The store's transaction scopes are named once in `store/scopes.ts`: the writers' tables, the sync store's (`libraryTables`) and letting go of a connection (`connectionTables`).

A connection's rows are read through one `rowsOf` (`store/rows.ts`).

Whether a row is live or a tombstone is asked by name (`store/rowStates.ts`), not by its flag.

The store names its key types (`FileKey`, `FolderKey`) and the connection a call is about (`ConnectionScope`) once, and the sync store reads a passage's or file's queued ops through the queue's own `opsFor` and `opsForFile`.

`@memoriam/core` offers `cell()`, the one way to hold a value that changes where the lint rules refuse `let`, and core holds its own that way.

The web's sync/ and the API hold their changing values in `cell()` too, and the lint rule covers them.
