---
'@memoriam/core': patch
'@memoriam/web': patch
---

The app's refusals are checked against core's `API_ERROR_CODES`, every one a code the server
answers with. The app no longer reads `not_entitled`, which this app's server never sends.
