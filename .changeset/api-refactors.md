---
'@memoriam/api': patch
'@memoriam/core': patch
'@memoriam/web': patch
---

The three storage OAuth flows share their token request, ID-token reading, revoking and default token lifetime (`oauth/common.ts`), and the Dropbox module is only its adapter, as the other two are.

The API answers every refusal through `fail()`, which takes only a code from core's `API_ERROR_CODES`, and the app's refusals are checked against the same list. The app no longer reads `not_entitled`, which this server never sends.
