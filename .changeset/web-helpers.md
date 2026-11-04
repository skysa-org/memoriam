---
'@memoriam/web': patch
---

The stale tab, the install prompt and the command registry tell their listeners through one emitter and store (`store/emitter.ts`), in place of a listener set written out in each.

`hooks/useLatest.ts` holds the last value rendered in a ref, for the command and key hooks that follow.
