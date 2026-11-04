---
'@memoriam/core': patch
---

`isPassageName` answers whether a name is a passage's, folded as `foldName` folds, in place of the copies of that check in the engine, the merge hook, the Drive adapter, conflict naming and titles.

Reading a passage file parses its frontmatter once, not twice (`readPassageMetadata`).
