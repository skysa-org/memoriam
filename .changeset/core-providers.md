---
'@memoriam/core': patch
---

The provider stubs share one harness, and the contract suite registers every adapter from one table.

`FetchLike` and `parseRetryAfter` move into `providers/http.ts`, and the three adapters send their requests through one transport there (`createTransport`), in place of three copies of the bearer header, the error body's reading and the retry note.

The adapters share their contract glue in `providers/adapter.ts`: one options type, the marker written once, `read` over `readBytes`, the root's guard and entry, and `isSelf`.

The Dropbox adapter refuses the root as the other adapters do: a passage or file written at `''`, or a move onto it, is a `NotFoundError` rather than Dropbox's own 400, and `createFolder('')` answers the app folder instead of failing.

OneDrive and Drive share their cursor's envelope and its reading (`treeCursorBase`, `readTreeCursor`, `applyAll` in `idTree.ts`). The cursors keep their shape, so every stored one reads as before.
