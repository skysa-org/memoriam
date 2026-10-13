# Changesets

A changeset is a note saying what changed and how much. It is written with the change and merged
with it. `pnpm run changeset` asks which packages changed, how big the change is, and for a summary.
It then writes the changeset into this folder.

```
pnpm run changeset            # write one
pnpm run changeset:status     # what is pending, and what it would release
pnpm run changeset:version    # consume them: bump versions, write CHANGELOGs
```

## What is unusual here, and why

**One version for all packages.**
- `@memoriam/core` and `@memoriam/web` are `fixed` together, so they always carry the same number.
  `@memoriam/api` joins them when sync arrives.
- They are not separate libraries. They make up one app, and the shared number is what the
  `vX.Y.Z` tag names.

**Nothing is published.**
- Every package is `private`, and `changeset publish` is never run.
- The tag exists so that a deployed copy of the app can be traced to a commit.

**Versioning is a local step, not a bot.**
- Run `pnpm run changeset:version` by hand, review the result as a pull request, and merge it.
  Pushing that to `main` is what makes `.github/workflows/release.yml` create the tag.
- Changesets' "Version Packages" bot is not used. A pull request opened with `GITHUB_TOKEN` starts
  no workflows, so its CI would never run.
- The version pull request needs no changeset of its own. `changeset version` deletes every
  changeset it consumes. CI recognises a version pull request by its shape: nothing changed in a
  package except its `package.json` and its `CHANGELOG.md`.

## When to write one

Write one whenever a pull request changes anything under `apps/` or `packages/`. CI fails the pull
request without one.

Two kinds of pull request are exempt:
- the version pull request described above;
- a dependency bump, because Dependabot cannot write a changeset.

When a change does not affect the version (a test, a comment, a refactor nobody outside the
repository can observe), say so instead of inventing a bump:

```
pnpm run changeset --empty
```

## Which bump

- **patch**: a fix, or anything invisible from outside.
- **minor**: a feature, a new practice mode, a new setting with a default.
- **major**: anything people using the app must act on. For example, a passage-file layout that
  older builds can only open read-only.

No bump is licence to strand what people already have. Passages and progress written by any earlier
release must keep working after an update, both on the device and in exported or synced files. If a
change cannot read them as they are, it must ship with an upgrade path that carries them forward,
in the same release, and tested against data in the old format.

Write the summary for the people using the app: what changed for them, not which function was
renamed.
