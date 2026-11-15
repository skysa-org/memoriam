---
'@memoriam/web': minor
---

The PWA build is the shared kit's `@skysa/pwa` 1.1.0: the brand plugin, the manifest, the service
worker's options and the size budget. What the app hands it of its own, its one route and its
default brand, is `apps/web/pwaApp.ts`. The built app is the same but for two routes the kit adds
to the service worker: same-origin `/api/` requests and the storage providers' are network-only,
so none of its caches can ever answer one. `MEMORIAM_BRAND` works as before, and set but empty it
now names no brand file, rather than the current folder. A brand file that built before builds
now, and one whose name or description has `&`, `<`, `>` or `"` in it reaches the page escaped
once, where it was escaped twice and showed `&amp;`. One the build refuses is refused in the kit's
words. The brand file's schema is unchanged, and is now the kit's: point your own brand file's
`$schema` at `apps/web/node_modules/@skysa/pwa/brand.schema.json` if your editor used it.
