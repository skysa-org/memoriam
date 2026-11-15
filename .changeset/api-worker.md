---
'@memoriam/api': minor
'@memoriam/web': patch
---

Add `apps/api`, the Worker that connects storage: OAuth for Dropbox, OneDrive and Google Drive,
per-connection credentials kept only as their SHA-256, provider tokens minted for the web app, and
the list of devices holding a connection, any of which can be signed out. It is the shared kit's
server, `@skysa/server` 1.1.0, behind this app's own entry, which runs no WebDAV and, by default, no
change relay or entitlement policy. An operator's own entry imports `createApp`, `parseEnv`,
`envWarnings`, `misconfigured` and the rate-limit seam from `@memoriam/api`, and a `wrangler.toml`
of their own points `migrations_dir` at `node_modules/@skysa/server/migrations`. A database made by
a Worker built from `main` before the server was the kit's is reset onto the kit's migrations, as
`docs/self-hosting.md`, "A database from before the kit", says. In development, Vite now passes
`/api` to `wrangler dev`.
