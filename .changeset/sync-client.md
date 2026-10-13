---
'@memoriam/web': minor
---

Add the sync client: credentials kept in a new `credentials` table, provider tokens minted by
`apps/api`, the typed API client, provider requests with deadlines, and the sync scheduler,
started at boot and idle while the library is bound to nothing. A pass's writes are pushed with
the next sync or when the page is hidden, rather than two seconds after every pass.
