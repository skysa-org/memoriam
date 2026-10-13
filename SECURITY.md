# Security policy

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's **private vulnerability reporting** on this repository:
[Security → Report a vulnerability](https://github.com/skysa-org/memoriam/security/advisories/new).
It creates a private advisory that only the maintainers can see.

If that page says reporting is not enabled, open an issue saying only *"I have a security report
and private reporting is off"*. Put no detail of the problem in it, and you will be given somewhere
private to send it.

Please include, as far as you can:

- what an attacker gets, in one sentence
- the steps to reproduce it, or a proof of concept
- which version or commit you tested

This is a small project with one maintainer. You will usually get an acknowledgement within a week.
That is an expectation, not a promise. A timeline for the fix is agreed in the advisory thread.

You are welcome to disclose publicly once a fix has shipped or after 90 days, whichever is sooner.

## Supported versions

Releases are tagged `vX.Y.Z`. Fixes land on `main` and go out in the next tag. The latest release
and `main` are supported; older releases are not.

## What is in scope

This repository: `apps/web` (the PWA) and `packages/core`.

Especially worth looking at:

- **The content security policy.** `script-src 'self'` with nothing inline is a hard requirement
  (`docs/ARCHITECTURE.md` §9). A way around it is a finding even without a script injection to go
  with it.
- **Anything that sends a passage or its progress off the device.** Until sync arrives, nothing
  does. Any path that does is a bug, whether or not it is exploitable.
- **Imported files.** A zip or markdown file from elsewhere is untrusted input. Anything that turns
  one into script, or into a write outside the library, is a finding.

## What is out of scope

- **Anything that needs the user's device already unlocked.** Passages are stored in IndexedDB as
  plain text, because the app works offline. That is the product, not a bug.
- **Missing headers with no way to exploit them**, scanner output pasted without a scenario, and
  reports about dependencies that do not reach the shipped bundle.
