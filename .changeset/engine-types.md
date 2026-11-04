---
'@memoriam/core': patch
'@memoriam/web': patch
---

`messageOf` comes from core, in place of the web app's copies of it.

The sync store no longer offers `fileByPath`, which nothing called, and the scan's reconcile takes its upload flag, unreadable files and file base from every caller rather than defaulting them.

The sync store's `applyPull` is `applyChanges`, since the push applies its own changes through it too.
