---
'@memoriam/api': minor
'@memoriam/web': patch
---

Add `apps/api`, the Worker that connects storage: OAuth for Dropbox, OneDrive and Google Drive,
per-connection credentials kept only as their SHA-256, provider tokens minted for the web app, and
the list of devices holding a connection, any of which can be signed out. It is the shared kit's
server (`@skysa/server`) behind this app's own entry, which runs no change relay, connect gate or
entitlement policy, and no WebDAV. In development, Vite now passes `/api` to `wrangler dev`.
