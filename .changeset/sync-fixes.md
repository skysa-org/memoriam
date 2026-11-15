---
'@memoriam/core': patch
'@memoriam/web': patch
---

A round reads a collection's passages by the path index, rather than every passage with its words, each time the engine asks what lies beneath a collection.

A sync held up behind another tab's or window's sync of the library says so in Settings after five seconds, rather than "Syncing…" for as long as the other one takes.

Settings says what a sync is doing: checking for changes, or looking for passages, while it reads the provider's pages, and how many passages it has found, received or sent once there are twenty or more. A round of changes from another device reports before its first page, rather than nothing until all its pages are read.

A sync under way can be paused from Settings (Pause syncing): its requests stop, a batch it was writing is kept whole, and nothing syncs on this device until Resume syncing, a re-scan, or the app is opened again. A long sync draws a bar under its status line, with the file it is on.

Reload, when a new version is offered, pauses syncing in every tab before it asks the new version to take over, so a sync's requests no longer hold the update back for minutes. The prompt says it is updating meanwhile, and what else to do if it takes long.

Google Drive lists the folders new to a round four at a time, rather than one after another, so a round after collections moved on another device reaches its passages sooner.

On Google Drive, a collection moved, renamed or deleted on one device no longer stays behind as an empty collection on the others, nor comes back after a re-scan: the folder it leaves is marked as left (`StorageProvider.leaveFolder`) and hidden while it holds nothing the app can see, with nothing in it touched.

Google Drive reads the whole library again when its change feed runs longer than that would take, rather than paging through other apps' hidden changes for minutes, and confirms the app's folder once a round rather than before every page. A passage deleted here is never taken over by another device's file at its name, which a re-scan could do, and its delete then sent for that file.

No adapter, nor the fake, leaves the app's own folder (`leaveFolder`), by its path or its id: it would hide the folder from the app that owns it.

Settings says a connection needs connecting again, and offers Connect again, for every problem that answers (the server or the provider wanting the account asked again, or a credential that reaches nothing), not only one, and draws that sentence in the colour of an error.
