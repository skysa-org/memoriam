---
'@memoriam/core': patch
'@memoriam/web': patch
---

`messageOf` comes from core, in place of the web app's copies of it.

The sync store no longer offers `fileByPath`, which nothing called, and the scan's reconcile takes its upload flag, unreadable files and file base from every caller rather than defaulting them.

The sync store's `applyPull` is `applyChanges`, since the push applies its own changes through it too.

What a sync change is about (a passage, a collection, a file), whether it puts it at a path and whether it binds it to a remote file is read off its kind, in one table (`CHANGE_KINDS`), rather than off which fields it happens to carry.

A queued change this version cannot read, such as one written by a newer version, is now kept and reported as stuck, rather than sent as a passage's edit.

The engine tests make their provider, store and engine per test (`syncWorld`), and are split by concern into `tests/sync/engine/`.
