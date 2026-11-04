---
'@memoriam/core': patch
'@memoriam/web': patch
---

A round reads a collection's passages by the path index, rather than every passage with its words, each time the engine asks what lies beneath a collection.

A sync held up behind another tab's or window's sync of the library says so in Settings after five seconds, rather than "Syncing…" for as long as the other one takes.

Settings says what a sync is doing: checking for changes, or looking for passages, while it reads the provider's pages, and how many passages it has found, received or sent once there are twenty or more. A round of changes from another device reports before its first page, rather than nothing until all its pages are read.

A sync under way can be paused from Settings (Pause syncing): its requests stop, a batch it was writing is kept whole, and nothing syncs on this device until Resume syncing, a re-scan, or the app is opened again. A long sync draws a bar under its status line, with the file it is on.

Reload, when a new version is offered, pauses syncing in every tab before it asks the new version to take over, so a sync's requests no longer hold the update back for minutes. The prompt says it is updating meanwhile, and what else to do if it takes long.
