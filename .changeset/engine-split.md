---
'@memoriam/core': patch
---

The sync engine's tests share a kit, and the engine is split by concern into `sync/pull/` and `sync/push/`, with nothing it does changed.

A passage that has to step aside to a conflict name, and finds all hundred of its tries taken, now fails its operation, which is retried, as a collection already did. Before, it took the next name without checking it, which could put it on another passage's path.
