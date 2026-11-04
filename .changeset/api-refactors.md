---
'@memoriam/api': patch
'@memoriam/core': patch
'@memoriam/web': patch
---

The three storage OAuth flows share their token request, ID-token reading, revoking and default token lifetime (`oauth/common.ts`), and the Dropbox module is only its adapter, as the other two are.

The API answers every refusal through `fail()`, which takes only a code from core's `API_ERROR_CODES`, and the app's refusals are checked against the same list. The app no longer reads `not_entitled`, which this server never sends.

The OAuth callback sends the browser back to the app, as a failed connect, where it used to answer in raw JSON: a provider the deployment does not offer or has turned off, a callback with neither a code nor an error, and a throttled callback.

JSON the API reads from outside its own code is checked against a schema rather than cast: provider token responses (a field of the wrong kind is dropped, a lifetime sent as a numeric string is read as a number, and an access token that is not a string fails the exchange), ID-token claims, Dropbox's account answer, the signed flow cookies and the stored OAuth secret.

Each API route that acts on a connection checks the device's credential itself, and the routes get the app's configuration and keys from `createApp` rather than from the request. A request under `/api/connection` for a path or method that is not a route now answers 404 `not_found` rather than 401. A second Worker entry with middleware of its own that read the app's configuration or keys from the request (`c.get('config')` and the like) reads them from what it passed to `createApp`.
