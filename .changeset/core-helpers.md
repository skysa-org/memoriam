---
'@memoriam/core': patch
---

`isPassageName` answers whether a name is a passage's, folded as `foldName` folds, in place of the copies of that check in the engine, the merge hook, the Drive adapter, conflict naming and titles.

Reading a passage file parses its frontmatter once, not twice (`readPassageMetadata`).

Core reads JSON from outside through one `parseJson` and `isJsonObject`/`asObject` (`src/json.ts`), in place of the hand-rolled try/catch parses in the marker and the three provider adapters.

Core's naming rules move into `names/` (fold, bytes, extension, slug and conflict names), below `markdown/`, `providers/` and `sync/`, with lint rules that keep them there.

Split core's frontmatter module into `markdown/frontmatter/` (split, read and write), with an index exporting the same names.
