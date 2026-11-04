---
'@memoriam/core': patch
---

The provider stubs share one harness, and the contract suite registers every adapter from one table.

`FetchLike` and `parseRetryAfter` move into `providers/http.ts`, and the three adapters send their requests through one transport there (`createTransport`), in place of three copies of the bearer header, the error body's reading and the retry note.
