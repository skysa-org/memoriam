---
'@memoriam/api': minor
---

The Worker is now the shared kit's server, `@skysa/server` 1.1.0, behind this app's own entry. An
operator's own entry imports `createApp`, `parseEnv`, `envWarnings`, `misconfigured` and the
seams from `@memoriam/api`, and a `wrangler.toml` of their own points `migrations_dir` at
`node_modules/@skysa/server/migrations`. A database made by a Worker from before the kit is reset
onto the kit's migrations, as `docs/self-hosting.md`, "A database from before the kit", says:
every device connects again, and no passage is touched.
