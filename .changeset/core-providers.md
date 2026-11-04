---
'@memoriam/core': patch
---

The provider stubs share one harness, and the contract suite registers every adapter from one table.

`FetchLike` and `parseRetryAfter` move into `providers/http.ts`, and the three adapters send their requests through one transport there (`createTransport`), in place of three copies of the bearer header, the error body's reading and the retry note.

The adapters share their contract glue in `providers/adapter.ts`: one options type, the marker written once, `read` over `readBytes`, the root's guard and entry, and `isSelf`.

The Dropbox adapter refuses the root as the other adapters do: a passage or file written at `''`, or a move onto it, is a `NotFoundError` rather than Dropbox's own 400, and `createFolder('')` answers the app folder instead of failing.

OneDrive and Drive share their cursor's envelope and its reading (`treeCursorBase`, `readTreeCursor`, `applyAll` in `idTree.ts`). The cursors keep their shape, so every stored one reads as before.

An answer a provider should not have given (an item with no id, a file with no version, a page with neither link) is a `ProviderResponseError`, still retried and counted as before, and a rate limit reads the same from every provider: who, the status, and how long it asked us to wait.

The Google Drive adapter is split into `providers/gdrive/` by concern (wire, root, upload, cursor, duplicates), with nothing it does changed.

No adapter, nor the in-memory fake, deletes or moves the app's own folder, whether it is named by its path or by its id: each refuses with a `NotFoundError`. Google Drive would otherwise have trashed the folder and everything in it. A provider's success answer that is not a JSON object is a `ProviderResponseError` naming the provider, not a `SyntaxError` or a `TypeError`, and Dropbox's rate-limit error says what Dropbox called it, as the other two do.
