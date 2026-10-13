# Contributing to Memoriam

Thanks for looking. This is an early project. The most useful contributions right now are bug
reports from real use and small, focused pull requests.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first. It is the source of truth for the
architecture and the decisions behind it. [`docs/research.md`](docs/research.md) is the evidence
behind how practice and scheduling work. If a change needs to depart from either, say so, and
propose the edit in the same pull request.

## Getting it running

You need Node 22.13 or later, and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev          # Vite on :5173
```

There is no server yet. Everything runs in the browser against IndexedDB.

## Before you open a pull request

```bash
pnpm verify   # format:check + lint + typecheck + test
```

CI runs the same checks, plus `pnpm build`, plus `pnpm audit --prod` for information only.

What a change is expected to carry:

- **Tests for new behaviour.** A test that fails if what you fixed comes back, not coverage for its
  own sake.
- **An amendment to `docs/ARCHITECTURE.md`**, if the change alters a decision recorded there.
- **A changeset**, if the change touches `apps/` or `packages/`. Run `pnpm run changeset`. If the
  change makes no difference anyone outside the repository can observe, run
  `pnpm run changeset --empty`. [`.changeset/README.md`](.changeset/README.md) explains how a
  release is cut.
- **A reason for any new dependency**, in the pull request description, and its licence. Anything
  that reaches the shipped bundle must be MIT, Apache-2.0 or ISC.

The hard rules in [`CLAUDE.md`](CLAUDE.md) apply to everyone, not only to the assistant.

## Commits and pull requests

Make small pull requests against `main`, one concern each. Write the commit message for someone
reading `git log` in a year: what changed and why, not what the diff already says.

## The CLA

Every contributor signs the [Individual Contributor License Agreement](CLA-individual.md) once,
not once per pull request. A bot comments on your first pull request with a link and the sentence
to post.

**It is a licence grant, not an assignment.** You keep ownership of everything you write, and the
right to use it anywhere else. In exchange, the project is bound to keep every contribution
available under AGPL-3.0, or a licence one-way compatible with it.

If you are contributing as part of your job, your employer may own what you write. If so, they sign
[`CLA-entity.md`](CLA-entity.md) instead. Both texts are **drafts that have not been reviewed by
counsel**.

## Reporting a security problem

Do not open an issue. See [`SECURITY.md`](SECURITY.md).

## Conduct

See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
