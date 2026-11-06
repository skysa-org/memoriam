---
'@memoriam/core': patch
'@memoriam/web': patch
---

Drop U+0000 from a passage's words, title and source as it is saved or imported. A pasted or
imported NUL made the passage's file unreadable to every device that synced it.
