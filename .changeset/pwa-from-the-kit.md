---
'@memoriam/web': minor
---

The PWA build is the shared kit's `@skysa/pwa` 1.1.0: the brand plugin, the manifest, the service
worker's options and the size budget. What the app hands it of its own, its one route and its
default brand, is `apps/web/pwaApp.ts`. The built app is the same but for one rule the kit adds:
the service worker marks `/api` and the storage providers' requests network-only, so none of its
caches can ever answer one. `MEMORIAM_BRAND` works as before, and a brand file that built before
builds now; one that does not is refused in the kit's words. The brand file's schema is unchanged,
and is now the kit's: point your own brand file's `$schema` at
`apps/web/node_modules/@skysa/pwa/brand.schema.json` if your editor used it.
