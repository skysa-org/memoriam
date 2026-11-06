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

The lint rule for `cell()` covers every package's source, and the rest of the web holds its changing values that way.

The shared building blocks of `components/` are in `components/ui/`, and the app's frame (the bar, the palette, the error, stale-tab and update screens) in `components/shell/`.

A command is not registered again for a new `run` on every render, so the palette is not told of a change that is none; it runs the latest `run`.

`useEscapeKey` replaces `useEscape`: it answers only an Escape nothing nearer has, and not one ending a composition.

The command palette closes on a press begun and let go on the page around it, as a dialog's way out, rather than on any press that starts there; it, the confirm and the name dialogs give the focus back through one `useFocusBack`.

The store's hooks read the database they are drawn over (`useDb`, `DatabaseProvider` in `store/database.tsx`) rather than taking one as an argument.

The screens read the database they are drawn over too, so a test can draw one over a database of its own.
