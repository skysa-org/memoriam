---
'@memoriam/core': patch
---

The sync engine's tests share a kit, and the engine is split by concern into `sync/pull/` and `sync/push/`, with nothing it does changed.

A passage that has to step aside to a conflict name, and finds all hundred of its tries taken, now fails its operation, which is retried, as a collection already did. Before, it took the next name without checking it, which could put it on another passage's path.

A sync whose sign-in expires during the full re-read that replaces a stale position in the change feed now refreshes the sign-in and goes back to that re-read, and one whose position turns out stale on the retry after a refresh now re-reads. Before, either one ended the sync to be tried again later.
