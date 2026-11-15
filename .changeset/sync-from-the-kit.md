---
'@memoriam/core': minor
'@memoriam/web': minor
---

Sync is the shared kit's 1.1.0: the provider adapters, the marker and the naming rules
(`@skysa/storage`), the engine (`@skysa/sync`), and the API client, the credentials, the tokens and
the scheduler (`@skysa/client`). What the app hands them of its own is its folder
(`MEMORIAM_FOLDER`), its passages (`PASSAGE_FORMAT`), the hidden paths it syncs (`syncsHidden`),
the merge that keeps practice made on two devices, the sync lock's name, and its database through
`apps/web/src/sync/dexiePorts.ts`. A library syncs as before: the same folder, marker and Google
Drive tags, the same files and conflict names, the same lock and the same database on the device,
so nothing on a provider or a device changes. Core no longer offers what moved: the apps take it
from the kit, and `@memoriam/core/testing` is gone, since the test doubles are the kit's.

One thing a device does differently: Reload asks the app's other tabs to pause syncing over the
kit's channel, `skysa-update`, where builds before this one used `memoriam-update`. A tab still
on one of those is not asked, and can hold the new build back for up to five minutes, as a tab of
an older build always could.
