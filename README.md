# Memoriam

**Memoriam** helps you learn passages of text by heart (poems, speeches, scripture, creeds,
anything) and keep them learnt.

**How practice works.** You see one short chunk of a passage at a time and type the first letter
of each word. With each pass more of the words are hidden, until you recall the whole chunk from
nothing.

**How it schedules reviews.** Spaced repetition (FSRS) brings each chunk back just before you would
forget it.

**How it rewards practice.** Streaks forgive a missed day, and progress is shown as mastery and
memory health rather than points.

**How the method was chosen.** From research on how verbatim memory works: retrieval practice,
vanishing cues, chunking and sleep. [`docs/research.md`](docs/research.md) has the evidence and the
design decisions it led to.

**Where your data lives.**
- Everything is stored locally as markdown, and the app works fully offline.
- Each passage is a `.md` file, and its progress is kept in the file's own frontmatter. Your
  library stays readable and portable, and you can export it as a zip at any time.
- Optional sync to your own Dropbox, Google Drive or OneDrive is planned.

**How it is built.** A pnpm workspace:
- a Vite + React PWA;
- a framework-free core package holding the practice engine, the scheduler and the file format.

It is built on the foundations of skysa-notes. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is
the source of truth for the architecture.

Licensed under [AGPL-3.0](LICENSE).

## Development

Requires Node 22.13 or later and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev        # Vite on :5173, and the sync Worker on :8787 (docs/self-hosting.md)
pnpm verify     # format check, lint, typecheck, tests: run before every commit
pnpm build
```

## Contributing

Bug reports and small, focused pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md)
for how to get started. Contributors sign a [CLA](CLA-individual.md) once. It is a licence grant,
not an assignment: you keep ownership of your work. Security problems go through
[private reporting](SECURITY.md), never a public issue.
