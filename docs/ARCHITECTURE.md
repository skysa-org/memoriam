# Memoriam: architecture

This is the design record, and the source of truth for what Memoriam is built from and why. If a
change departs from it, the same pull request amends it. `docs/research.md` holds the evidence
behind the practice and scheduling decisions; this file says how they are built.

Memoriam is built on the foundations of skysa-notes (same organisation, same licence). It uses
skysa-notes' stack, conventions and much of its shell code, ported selectively. Where a section
says "as skysa-notes", that project's `docs/ARCHITECTURE.md` has the longer reasoning.

---

## 1. Decisions

| Topic | Decision |
|---|---|
| What it is | A local-first PWA for learning passages of text by heart (poems, speeches, scripture, creeds, anything) and keeping them learnt |
| Core interaction | Show one short chunk. The user types the first letter of each word. Words are hidden progressively across levels until the chunk is recalled from nothing |
| Stack | As skysa-notes: a pnpm monorepo (`apps/web`, `packages/core`, and `apps/api` once sync arrives), strict TypeScript, its functional ESLint rules, Vite + React + TanStack Router + Dexie + vite-plugin-pwa, zod, Vitest, changesets |
| Storage | The markdown string is the only source of truth, held byte for byte in IndexedDB. Real `.md` files exist in zip exports, and on a storage provider once sync arrives |
| Progress | Stored in each passage's own frontmatter, in a `progress:` map with one entry per chunk (§3). Daily activity and badges live in hidden `.memoriam/activity-YYYY.md` files |
| Phasing | Phase 1: a complete app on one device, with export and import. Phase 2: optional sync to Dropbox, Google Drive or OneDrive, through skysa-notes' engine and Worker (§10) |
| Grading | Fully automatic, from misses, hints and hesitations. The user does not grade themselves |
| A wrong key | Shows the correct word at once, in red. The user then types its letter, and it counts as one miss |
| Rewards | Moderate, and informational rather than controlling (`docs/research.md` §5): a forgiving streak, mastery and memory health per passage, a due queue, an activity heat map, milestone badges |
| Licence | AGPL-3.0-only, with a CLA (§13) |

## 2. Content

**Any text.** A passage has a title, an optional source or reference ("Psalm 23, ESV", "Hamlet
III.i"), optional tags, and a body.

**Structure is kept.** Line breaks and stanzas are kept, because they are part of what is learnt.

**Words.** A word is a run of letters, marks and digits. An apostrophe between letters
(`don’t`, `shepherd’s`) or a point or comma between digits (`3.14`, `1,000`) holds it together. A
hyphen parts two words: `well-known` is typed `w`, `k`. Everything else (spaces, quotes, dashes,
punctuation) is shown and never typed. A word's key is its first letter or digit, lowercased,
without accents, and folded (`ß` is `s`, `æ` is `a`, `ς` is `σ`, Hebrew final forms are their
letters).

**Words are found by a fixed regular expression over Unicode properties, not by
`Intl.Segmenter`.** Chunk keys are hashes of the words, and `chunker` promises that the same text
is cut into the same chunks on every device, now and later. `Intl.Segmenter` is each engine's ICU,
and engines differ in version and tailoring: the same line could be split two ways on two devices,
and each would orphan the other's progress. A property escape answers the same wherever the
character is assigned.

**Scripts.** Any script whose words are typed letter by letter works: Latin, Greek, Cyrillic,
Hebrew, Arabic and others. Chinese, Japanese, Korean, Thai, Lao, Khmer, Myanmar and Tibetan are
typed through an input method that composes characters, and have no first letter to type. Their
words are shown as text between the words that are typed. They are not supported in v1, and the
editor says so when a passage has none of the words it can practise.

## 3. Files

**Layout.** The library has the same layout whether it is a zip export or a provider's app
folder:

```
Psalms/                       collections are folders
  Psalm 23.md                 one passage per file
Poems/
  Ozymandias.md
.memoriam/                    the app's own files: hidden, but exported and synced
  activity-2026.md
.memoriam-app.json            the marker, once sync arrives
```

**A passage file:**

```markdown
---
id: 01JAB3K7Q2
title: Psalm 23
source: Psalm 23 (ESV)
tags: [scripture]
created: 2026-10-13T14:00:00Z
updated: 2026-10-13T14:00:00Z
chunker: 1
progress:
  k3fq9ma: { level: 5, due: 2026-10-20, stability: 6.21, difficulty: 4.1, reps: 3, lapses: 0, reviewed: 2026-10-13T14:03:02Z, misses: "0,0,2,0,1" }
  p8dz2ve: { level: 3, reviewed: 2026-10-13T14:05:00Z }
---

The Lord is my shepherd; I shall not want.
He makes me lie down in green pastures.
```

**The body is plain text, not markdown:**
- A blank line separates sections: stanzas or paragraphs.
- A line starting with `#` labels a section and is not practised.
- `*emphasis*`, `**emphasis**` and `_emphasis_` markers are kept in the file but are neither
  shown nor typed. A run of `*` or `_` with a space or the line's edge on both sides is not a
  marker, and is shown: the `* * *` that parts two stanzas.

**Chunk keys:**
- 7 characters of base32 from a synchronous 53-bit hash (cyrb53) of the chunk's normalised words.
  The alphabet is Crockford's, lowercased, so no `i`, `l`, `o` or `u` to misread.
- A key always starts with a letter, so YAML never reads it as a number.
- A repeated chunk, such as a refrain, gets an occurrence suffix: `k3fq9ma.2`.

**`chunker: 1`.** This pins the chunking algorithm a passage was first split with. Every chunker
version stays in the code as a frozen pure function. A better chunker can then never change an
existing passage's keys and orphan its progress.

**Chunker 1** cuts each section on its own, so a chunk never crosses a blank line or a label. It
picks the cheapest cutting of the section by dynamic programming:
- Each chunk costs `((words − 20) / 10)²`: twenty words is best, ten to thirty is good, and more
  than 45 is never allowed.
- Each cut costs by what it ends on. A line end that is also a sentence end costs nothing. A line
  end at a clause costs 0.5, and a bare line end or a sentence end mid-line costs 1.5. A clause mark
  mid-line (`,` `;` `:` a dash, a spaced hyphen) costs 3. A cut with no pause costs 8, and is
  there only for a line too long to be one chunk.
- Ties go to the shorter chunk.

Its output on four fixtures (Psalm 23, Sonnet 18, the Gettysburg Address, "Hope is the thing with
feathers") is pinned in `packages/core/tests/passage/chunk.test.ts`. A change there is a new
chunker, not a fix.

**The `progress` map:**
- One flow-style line per chunk, in passage order.
- Floats are rounded to two places, and the rounded value in the file is the truth, so devices
  agree.
- `misses` counts misses per word, comma-separated.
- Read leniently, since any tool may have edited the file:
  - a field the app does not recognise as its own (a newer build's) is kept;
  - a field of the wrong shape (`level: 9`) is passed over, and the next pass rewrites it;
  - an entry that is not a mapping is kept as it is.

**Writes:**
- A completed pass rewrites only the `progress` block. Every other byte stays the same, including
  `updated`, comments, and keys the app does not know.
- Editing the text remaps progress in the same write. A new chunk inherits an old one's progress
  when it is at the same position and shares 60% or more of its words; misses are aligned word by
  word. Anything else starts fresh.
- An editor outside the app (Obsidian, a provider's web page) can leave keys that no longer match
  any chunk. Within each gap between keys that still match, those keys are paired with unmatched
  chunks by order, where the counts agree. Otherwise they are dropped on the next write.
- A passage cut by a chunker this build does not have keeps its `progress` as it is through an
  edit: its keys are not this build's to work out.
- If a passage's YAML cannot be edited safely (it fails to parse, or an anchor sits on a key the
  write would change), recording a pass refuses and says so. It never drops the pass silently. An
  edit to the words or details refuses the same way, rather than write new words over progress
  it could not carry to them.

**`activity-YYYY.md`.** Its frontmatter has two maps:
- `days`, keyed `YYYY-MM-DD~<deviceId>`, giving `{ words, passes, reviews, ms }`;
- `badges`, giving the date each was earned.

Each day key has exactly one writing device, so two devices' copies can be merged exactly (§10).

## 4. Practice

**The fade ladder.** Hiding adapts per chunk (`docs/research.md` §2.1):

| Level | What the user sees |
|---|---|
| L0 | Every word visible; type the first letters to copy it |
| L1 | About 25% of words hidden, shown as placeholders of their length |
| L2 | About 50% hidden, alternating complementary halves on each pass |
| L3 | About 75% hidden |
| L4 | Every word hidden, with placeholders |
| L5 | Bare: no placeholders, only a line of context before the chunk (or the title, for the first chunk) |

**Which words are hidden:**
- Words are rotated so that every word is hidden within a few passes.
- Words recalled last time are more likely to be hidden.
- A missed word is shown on the next pass and hidden again on the pass after.
- At L1 and L2, no more than 2–3 hidden words in a row.
- The random choice is seeded, so a pass can be replayed exactly.

**Moving between levels:**

| A pass | Then |
|---|---|
| At least 90% correct, no hints | Up one level |
| 100% correct at a fluent pace | Up two |
| 70–89% correct | The same level again, with the missed words shown once |
| Below 70% | Down one level |

A chunk is learnt after one clean pass at L5. Practice of it stops for the session there.

**Typing.** One hidden `<input>` takes the keystrokes. It works out what was typed by comparing
the input's value before and after, respecting composition, and ignores the 229 keydowns that
Android keyboards send. A pure reducer (`practice/typing.ts`) turns each character plus a time
into the next state:
- A correct first letter reveals the word.
- A wrong one shows the correct word in red. The user must then type its letter, and it is one
  miss however many keys follow.
- A slip onto an adjacent key, on a touch keyboard, is shown the same way but logged as a slip,
  not a miss.
- About 5 seconds idle shows a faint outline of the word, then the word itself. Either counts as a
  miss.
- A hesitation is a gap longer than max(2 s, 2.5× the user's median time per word).

**First letters.** A word's first letter is its first letter or digit, case-folded and with
diacritics removed. Ligatures (æ, œ) and ß are folded, final sigma and Hebrew final forms are
normalised. Punctuation and symbols are never typed.

**After a pass,** the user repairs only the lines that had misses, until each is clean once.

## 5. Scheduling

**One FSRS card per chunk.** ts-fsrs, FSRS-6:
- short-term steps off, because the fade ladder does first learning;
- fuzz on, so reviews do not bunch up;
- desired retention 0.90 by default, with presets of 0.85, 0.90 and 0.95;
- longest interval 365 days.

A chunk gets its card when it is learnt. Its first review is the next day.

**Reviews:**
- A passage's due chunks are run together, with one line of context before the first.
- Each chunk is still graded separately, and reviewed at most once a day.
- A lapse drops the chunk to L3 and relearns it.

**Grades** (`docs/research.md` §3.7):

| Grade | When |
|---|---|
| Again | Any hint; more than ~15% of words missed (2 or more on a chunk under 10 words); or the chunk was abandoned |
| Hard | 1 miss (up to ~10%); or no misses but 2 or more hesitations |
| Good | No misses and at most 1 hesitation |
| Easy | Reviews only: no misses, no hesitations, and at least the user's usual pace |

**A day's session:**
1. Due reviews, the lowest predicted recall first.
2. Relearning.
3. New chunks through the ladder, capped at 50 new words a day by default.
4. Link passes and a run through the section so far, using a rolling window past 150 words.
5. A summary.

**Derived tables.** The `cards` table indexes every chunk's state for the due queue. It is derived
from the passages' frontmatter in the same transaction as any write that changes a passage. It can
always be dropped and rebuilt.

## 6. Rewards

All of these are derived from the passages' progress and the activity files. None is stored
separately, except a badge's date, so they sync for free.

- **Daily goal:** clear the due reviews, plus the day's new words.
- **Streak:**
  - a day counts after any completed pass;
  - one freeze is earned per 7 consecutive days, at most 2 held, and spent automatically on a
    missed day;
  - a broken streak can be repaired within 48 hours by a day of double the goal;
  - an optional weekly rest day;
  - no guilt messaging.
- **Mastery %:** the share of a passage's words that are in learnt chunks.
- **Memory health:** the mean predicted recall of those chunks, weighted by words.
- **Heat maps:** activity per day, and misses per word within a passage.
- **Badges:**
  - first passage learnt;
  - first passage mastered (every chunk at a stability of 21 days or more);
  - words memorised: 100, 500, 1k, 5k;
  - streaks of 7, 30, 100 and 365 days;
  - a whole-passage run with no misses;
  - a passage kept current for 30, 90 and 365 days;
  - a comeback, after a break of 7 days or more, framed positively.
- **Celebrations** are small and respect `prefers-reduced-motion`.

## 7. Local store and the app

**IndexedDB through Dexie** (`apps/web/src/store/db.ts`):
- The tables mirror skysa-notes': `notes` keyed `[connectionId+id]`, `folders`, `prefs`. A
  "note" is any markdown file in the library: a passage, or a year's activity.
- Every row has `connectionId = 'local'` until sync arrives.
- Each row also keeps its title and source read out of the file, so a list need not parse every
  file.
- There is no queue of writes owed to a provider yet. Sync brings skysa-notes' queue in a schema
  version of its own. A first connection queues the whole library afresh anyway, as skysa-notes'
  does, so a queue kept before then would have no reader. Writes set `dirty` from the start.
- Deleting a passage or a collection removes its rows, and an undo notice puts them back. Once
  there is sync, a delete leaves a tombstone until it has been sent, as in skysa-notes.
- Until the first release, version 1 of the schema may still change. After it, a version only
  adds, and an upgrade carries forward what an older build wrote.

**Recording a pass.** `recordPass` is one transaction:
1. Read the row's current `source`.
2. Merge the practised chunks into its `progress`.
3. Write it back.

Two tabs practising at once therefore cannot overwrite each other.

**The app's words.** Every word the user reads comes from the catalog: `t('…')` in
`apps/web/src/i18n/t.ts`.
- Messages are whole sentences with `{placeholders}`, and `{ one, other }` plurals.
- Words are never pieced together in code.
- An ESLint rule (`INLINE_WORDS`) refuses literal words in JSX.

**A newer build in another tab ends this one.** As skysa-notes (`store/staleTab.ts`): the older
tab flushes what it holds, closes its database for good, and says it is out of date. A frozen tab
lets go of the database (`store/frozenTab.ts`).

**Where the app is.** The location lives in the URL hash: TanStack Router with hash history, a
file route for each screen (`#/library`, `#/passage/<id>`). The server is only ever asked for `/`,
so the service worker's one fallback covers every screen offline, and no passage's id or name is
sent to a server.

**Keyboard.** Commands are registered by the components that own them
(`apps/web/src/commands/`), and the palette and the shortcuts read the same list. Shortcuts need a
modifier, so they never collide with typing during practice.

## 8. PWA

- **Generated service worker.** vite-plugin-pwa (`apps/web/pwa.ts`) precaches the shell, so the app
  starts offline. Navigation falls back to the shell only for `/`.
- **Updates.** `registerType: 'prompt'`: a new build waits for the user to reload, and never swaps
  in under a pass being typed.
- **Brand.** The name, colours, icons and fonts come from a `brand.json`: `apps/web/brand/` by
  default, or the file `MEMORIAM_BRAND` names (`apps/web/brand.ts`). The default icons are drawn by
  `apps/web/brand/draw-icons.mjs`.
- **Installing from the browser.** As skysa-notes. Chromium's install event is held for a banner.
  Safari's menu path is named on iPhone, iPad and Mac.
- **Keeping data.** Safari deletes a site's storage after 7 days without use unless the app is
  installed to the home screen. The app asks for persistent storage (`navigator.storage.persist()`)
  once there is a passage to keep, encourages installing, and reminds the user to export a backup.

## 9. Security

The Content-Security-Policy in `apps/web/public/_headers`, checked by `tests/csp.test.ts`:
- `script-src 'self'`, and no inline script, `eval` or `new Function` in the shell. This is a hard
  requirement. Once sync arrives, the shell holds a long-lived credential in IndexedDB, as
  skysa-notes does.
- `connect-src 'self'`: nothing leaves the device until sync arrives. Each provider's hosts are
  added with its adapter.
- `src/jitless.ts` stops zod probing for `new Function`.

## 10. Sync (Phase 2)

Sync is skysa-notes' engine, ported:
- the provider adapters, with their contract tests;
- `sync/{engine,store,conflicts}`;
- the Hono Worker for OAuth, with the same per-connection credentials and no identity layer.

The differences:

**Merge before a conflict copy.** skysa-notes never merges: on a conflict the remote keeps the
path, and the local version is written beside it as a conflict copy. Memoriam adds one merge
before that rule, through a `merge` option on the engine:
- At the pull site, and in `resolvePushConflict`.
- A new `merge-note` pull change, applied only if the local `source` still equals the base the
  merge was made from.

**`mergePassage`:**
- If the bodies and the non-progress frontmatter match, merge `progress` chunk by chunk. The later
  `reviewed` wins, and the remote wins a tie.
- Otherwise, a conflict copy as skysa-notes does.
- Other metadata is not merged: with no base version, nobody can tell which side renamed it.

**`mergeActivity`:**
- Days: union, with the maximum of each field.
- Badges: union, keeping the earliest date.

The same merges also handle a backup imported over an existing library in Phase 1.

**Other changes:**
- **Hidden files.** `isHidden` gets an exception for `.memoriam/activity-YYYY.md` only, as
  skysa-notes has for its scratchpad.
- **When a passage counts as edited.** A pull that changed only progress keeps the passage's
  `updatedAt`.
- **Push timing.** Practice writes wait about 60 seconds, or until the page is hidden, before they
  are pushed. Text edits keep skysa-notes' 2-second debounce.
- **Provider apps.** New registrations named "memoriam" are needed with Dropbox, Google and
  Microsoft (Dropbox app names are permanent).

## 11. Repository layout

```
apps/web/              the PWA
  brand/  brand.ts     the brand: name, colours, icons
  pwa.ts               manifest and service worker
  public/_headers      CSP and HSTS
  src/
    routes/            TanStack Router, a file route per screen (hash history)
    components/        the shell and shared UI
    practice/          the practice screen and keystroke capture
    store/             Dexie: every local read and write
    archive/           zip export and import
    commands/          command registry, chords, palette
    i18n/              t(), rich(), and the English catalog
    install/           the install banner
packages/core/         framework-free TypeScript: browser, Node and Workers
  src/
    passage/           body grammar, tokenizer, chunker, remap
    progress/          frontmatter codec, merges
    practice/          hiding, typing reducer, grading, fading
    schedule/          FSRS, the session planner
    rewards/           activity, streaks, mastery, badges
    markdown/          frontmatter (ported from skysa-notes)
docs/
  ARCHITECTURE.md      this file
  research.md          the evidence
```

## 12. Roadmap

Phase 1 is delivered in milestones, each one pull request with `pnpm verify` green:

| Milestone | Delivers |
|---|---|
| M0 | Docs and scaffold |
| M1 | Core markdown and the progress codec |
| M2 | Library |
| M3 | Text engine |
| M4 | Practice engine |
| M5 | Practice screen |
| M6 | Scheduling and the Today screen |
| M7 | Rewards |
| M8 | Export and import |
| M9 | Polish: install, persistence, backup reminder, palette |

Phase 2 is sync (§10).

Phase 3, later:
- full-word or spoken recall checks;
- audio;
- fitting FSRS parameters to a user with 1,000 or more reviews;
- an optional mode that learns a passage from its end;
- a memory-palace image per section.

## 13. Licence and contributions

- **Licence:** AGPL-3.0-only (`LICENSE`, `NOTICE`), as skysa-notes, whose code much of this is
  ported from.
- **Contributions:** made under a contributor licence agreement (`CLA-individual.md`,
  `CLA-entity.md`), checked by `.github/workflows/cla.yml`. It grants a licence and is not an
  assignment: contributors keep ownership. The agreements are drafts that have not been reviewed by
  counsel.
- **Dependencies:** MIT, Apache-2.0 or ISC licences only.
