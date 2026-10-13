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

**Layout.** The library has the same layout whether it is a zip export (§7, "Export and import")
or a provider's app folder:

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
  k3fq9ma: { level: 5, due: 2026-10-20, learnt: 2026-10-13, stability: 6.21, difficulty: 4.1, reps: 3, lapses: 0, reviewed: 2026-10-13T14:03:02Z, misses: "0,0,2,0,1" }
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

**A chunk's entry** holds `level` (0 to 5); once learnt, `due` and `learnt`, the day it was first
learnt, which a lapse does not change; after its first review, the FSRS fields `stability`,
`difficulty`, `reps` and `lapses`; `reviewed`, when it was last practised; and `misses`, a count
per word. A field the app does not know is kept as it was.

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
- `days`, keyed `YYYY-MM-DD~<deviceId>`, giving `{ words, passes, reviews, started, ms }`.
  `started` counts the words of chunks practised for the first time that day: what the cap on new
  words is measured against, summed over every device's line for the day;
- `badges`, giving the date each was earned. A badge already there keeps its date; across files
  and devices, the earliest date wins.

Each day key has exactly one writing device, so two devices' copies can be merged exactly (§10).

## 4. Practice

**The fade ladder.** Hiding adapts per chunk (`docs/research.md` §2.1):

| Level | What the user sees |
|---|---|
| L0 | Every word visible; type the first letters to copy it |
| L1 | About 25% of words hidden, shown as placeholders of their length |
| L2 | About 50% hidden, mostly the half shown on the pass before |
| L3 | About 75% hidden |
| L4 | Every word hidden, with placeholders |
| L5 | Bare: no placeholders, only a line of context before the chunk (or the title, for the first chunk) |

**Which words are hidden** (`practice/hide.ts`):
- Words take turns: those hidden least so far this session are hidden first, so every word is
  hidden within a few passes (five at L1, three at L2, two at L3).
- Among words hidden as often, one missed less over time (`progress.misses`) is likelier to be
  hidden: what is known loses its cue first.
- A missed word is shown on the next pass and hidden again on the pass after.
- No more than 2 hidden words in a row at L1, or 3 at L2. So two L2 passes are not always exact
  complements: a run of four shown words cannot all be hidden next time.
- The random choice is seeded (mulberry32), so a pass can be replayed exactly.

**Moving between levels:**

| A pass | Then |
|---|---|
| At least 90% correct, no hints | Up one level |
| 100% correct with no hesitations | Up two |
| 70–89% correct | The same level again, with the missed words shown once |
| Below 70% | Down one level |

A chunk is learnt after one clean pass at L5. Practice of it stops for the session there.

**Learnt, in the file.** A chunk is learnt once its entry has a `due` day. The learning pass that
learns it sets `due` to the next day (`practice/learn.ts`), and its FSRS card starts from its first
review (§5). Until then, its entry holds only `level`, `reviewed` and `misses`.

**The typist's pace** is kept per device, since a phone and a keyboard differ: the median time per
word of each clean pass, folded in a fifth at a time (`practice.pace` in `prefs`). A hesitation and
an Easy grade are measured against it.

**Typing.** One hidden `<input>` takes the keystrokes (`apps/web/src/practice/LetterCapture.tsx`).
It is focused in the tap on Start and kept focused, so a phone's keyboard stays up for the whole
session. Taps on the chunk and on its buttons do not take the focus from it.
- Keys are never read from `keydown`, where Android keyboards send every letter as 229. What was
  typed is what follows the part the input's old and new values share (`practice/capture.ts`).
- The value is emptied after each read, except while a keyboard is composing a word in it.
  Emptied then, the keyboard would put its word back.
- Enter, or the keyboard's Next key, starts the next pass.

A pure reducer (`practice/typing.ts`) turns each character plus a time into the next state:
- A correct first letter reveals the word.
- A wrong one shows the correct word in red. The user must then type its letter, and it is one
  miss however many keys follow.
- A slip onto an adjacent key, on a touch keyboard, is shown the same way but logged as a slip,
  not a miss. Neighbours are worked out from where a phone puts the keys; QWERTY is the only layout
  so far.
- 5 seconds idle on a word shows a faint outline of it, and 8 seconds the word itself. Either
  counts as a miss, and the word is still typed to go on. A hint can also be asked for.
- A key that is no letter or digit (a space, a full stop) is passed over.
- A hesitation is a wait before a word's first key, right or wrong, longer than max(2 s, 2.5× the
  user's median time per word).

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

A chunk gets its card when it is learnt: learnt means its entry has a `due`. Its first review is
the next day. An entry with a `due` and no `stability` is a card not yet reviewed, so a chunk
learnt in one build is reviewed in another without a migration. `due` is a local day; ts-fsrs is
given that day's noon, and a review is never due sooner than tomorrow.

**Reviews:**
- A passage's due chunks come one after another, each a bare pass at L5 with the words before it
  as its context.
- Each chunk is graded on its own, and reviewed at most once a day.
- A lapse (Again) drops the chunk to `min(level, 3)` and relearns it in the same session, once
  the reviews still to come are done. A chunk with a `due` below L5 is relearning: it climbs the
  ladder again, and a clean pass at L5 ends it. It keeps the `due` the lapse gave it.

**Grades** (`docs/research.md` §3.7):

| Grade | When |
|---|---|
| Again | Any hint; more than ~15% of words missed (2 or more on a chunk under 10 words); or the chunk was abandoned |
| Hard | 1 miss (up to ~10%); or no misses but 2 or more hesitations |
| Good | No misses and at most 1 hesitation |
| Easy | Reviews only: no misses, no hesitations, and at least the user's usual pace |

**A day's session** (`packages/core/src/schedule/session.ts`, `apps/web/src/practice/tasks.ts`):
1. Due reviews, a passage's together, the passage with the lowest predicted recall first.
2. Relearning.
3. Chunks begun on an earlier day and not yet learnt.
4. New chunks, in passage order, while the words begun today (`started`, §3) stay within the cap:
   50 a day by default. A day that has begun nothing yet may always begin one chunk, however long.
5. After each new chunk is learnt, a link pass: the last line of the chunk before it, then the new
   chunk, when the one before is learnt.
6. At the end, a run through each section learnt in, from its start to the last chunk learnt
   there, keeping to the last 150 words or so (a rolling window, from a chunk's start).
7. A summary.

Link passes and runs are bare, at L5, and not graded: they add to the day's activity and change no
chunk's progress.

The session is planned once, when it starts. Each pass is recorded as it ends, and the session
adds its own tasks (links, relearning, runs) as it goes.

**A passage's own practice.** Practising from a passage's page plans that passage alone: what is
due in it, then every chunk not yet learnt, whatever the day's cap. Once all of it is learnt, it
can be run through whole, section by section, in runs of no more than 150 words.

**Settings** are kept per device in `prefs`, like the typist's pace, each one of a few choices:
desired retention (0.85, 0.90, 0.95), new words a day (20, 30, 50, 80, 120), the longest interval
(90, 180, 365 days), and whether a slip on a touch keyboard is forgiven. A value that is none of
the choices reads as the default.

**No derived tables yet.** The day's plan is worked out in memory from the passages each time one
changes (`apps/web/src/store/schedule.ts`): each is cut into chunks and its progress laid against
them. A library would have to be large for this to be slow. If one is, a `cards` table can index
every chunk's state for the due queue, derived from the frontmatter in the same transaction as any
write that changes a passage, and always able to be dropped and rebuilt.

## 6. Rewards

All of these are worked out afresh from the passages' progress and the activity files, each time
either changes (`packages/core/src/rewards/`, `apps/web/src/store/rewards.ts`). Nothing is
stored separately, except the day each badge was earned, so they sync for free.

**Daily goal:** clear the reviews due, plus the day's new words. Today shows each as a bar: the
reviews done today out of those done and still due, and the words begun today out of those begun
and the new words still planned.

**Streak** (`rewards/streak.ts`):
- A day counts once any pass is finished on it, on any device. Today is never missed: it is not
  over.
- Each 7 days practised in a row earns a freeze, and at most 2 are held. A freeze is spent by
  itself on a day missed.
- A day missed with no freeze to spend can be mended within the 2 days after it by a day of twice
  the usual practice: words typed at least double the median of the 28 practised days before the
  miss, and at least 40. Until the window closes, the streak stands and Today says how to keep it.
  Once it closes unmended, the streak is the days practised since.
- An optional weekly rest day neither counts nor breaks it.
- There is no guilt messaging: a repair is offered as a way to carry on, never as a loss.

**Mastery %:** the share of a passage's words in chunks learnt and not since forgotten (a chunk
relearning after a lapse does not count).

**Memory health:** the mean predicted recall now (FSRS retrievability) of the chunks with a
schedule, weighted by their words. A chunk learnt and not yet reviewed counts as 1.

**Heat maps:**
- practice by the day, 26 weeks of it, each day's words placed in a quarter of the days
  practised in view; days the streak kept without practice (a freeze, a repair, a rest day) are
  outlined;
- misses per word within a passage, underlined on its page, the darker the more often.

**Badges** (`rewards/badges.ts`), each earned once:
- first passage learnt (every chunk learnt);
- first passage mastered (every chunk at a stability of 21 days or more);
- words learnt across the library: 100, 500, 1,000, 5,000;
- streaks of 7, 30, 100 and 365 days, dated the day each length was reached;
- a passage held for 30, 90 and 365 days: every chunk learnt, none relearning or overdue, counted
  from the day its last chunk was first learnt (`learnt`, §3). A passage that falls behind and
  catches up again is held from where it was: forgiving, like the streak;
- word perfect: a run through a whole passage without a miss, earned by the pass itself;
- a comeback, practising again after a week or more without, framed as a welcome.

Every other badge is derived from the state it describes. The app writes each one derived and not
yet recorded into this year's activity file, and says so in a small notice that goes by itself.

**Celebrations** are small: a check that pops when a chunk is learnt, and the badge notice. Both
keep still under `prefers-reduced-motion`.

**Progress screen:** the streak and freezes, the practice heat map, totals (words and passages
learnt, minutes, passes), each passage's mastery and health, and every badge, earned or how to
earn it.

## 7. Local store and the app

**IndexedDB through Dexie** (`apps/web/src/store/db.ts`):
- The tables mirror skysa-notes': `notes` keyed `[connectionId+id]`, `folders`, `prefs`. A
  "note" is any markdown file in the library: a passage, or a year's activity.
- Every row has `connectionId = 'local'`, connected or not (§10, "The web store").
- Each row also keeps its title and source read out of the file, so a list need not parse every
  file.
- Version 2 adds sync's tables: `syncState`, `opQueue`, `files` and `fileBytes`, and a passage's
  `remoteId`, `remoteVersion`, `syncedHash` and `deletedLocally`.
- Version 3 adds `credentials`: the credential each connection is reached with (§10, "The sync
  client").
- Writes set `dirty`, and queue what the remote is owed in the same transaction, while the
  library is connected (§10, "The web store").
- Deleting a passage or a collection removes its rows while the library is not connected, and
  leaves tombstones while it is. Either way an undo notice puts them back.
- A version only adds, and an upgrade carries forward what an older build wrote.

**Recording a pass.** `recordPass` (`apps/web/src/store/practice.ts`) is one transaction:
1. Read the row's current `source`, and cut it into chunks by its own `chunker`.
2. If the chunk practised is no longer one of them (the words were edited meanwhile), refuse and
   say so.
3. Fill gaps left by another tool (§3, "Writes"), then set the practised chunk's entry from what
   the file has for it now.
4. Write the `progress` block back, in passage order, and nothing else of the file.
5. Add the pass to today's line in `.memoriam/activity-YYYY.md` (row id `activity-YYYY`), made on
   the first pass of a year. If that file cannot be read, the pass is still recorded, and the user
   is told the day was not.

Two tabs practising at once therefore cannot overwrite each other: each changes only its own
chunk's entry, in the file as it is when the write is made.

**Export and import** (`apps/web/src/archive/`, on the Settings screen). Until sync, the only
copy of the library is the one in this browser, so a backup is a file the user keeps.
- **Export** writes a ZIP of every row at its path, byte for byte, the activity files included
  (§3, "Layout"). An empty collection gets a folder entry of its own. Entries are stored, not
  deflated: passages are small, and a stored archive needs no compressor. Names are UTF-8. A name
  that a case-insensitive disk would take for another is numbered, `name (2).md`, though the
  library's own naming already keeps them apart. The archive is named `memoriam-YYYY-MM-DD.zip`,
  for the day on the user's clock.
- **Import** takes `.md`, `.markdown` and `.txt` files and ZIPs, several at once, in one
  transaction:
  - **Reading.** A ZIP's stored and deflated entries are read, the latter through the browser's
    own `DecompressionStream`. What an operating system adds (`__MACOSX/`, `.DS_Store`) is
    dropped. An export unpacked and compressed again as a folder is read from the folder that
    holds `.memoriam/`. A file that is not UTF-8, or an entry that is damaged or encrypted, is
    named to the user and left out.
  - **A passage the library has** is found by its `id`, or by its path when it has none. If
    `mergePassage` finds the same words and details, the progress is merged and `updatedAt` stays
    where it was, since practice is not an edit. If they differ, the incoming file is added as a
    copy in the same collection, with a new `id` and its title followed by "(imported)".
  - **A passage the library lacks** is added at its own path and with its own `id` where they are
    free, and under a free name and a new `id` where they are not.
  - **A year's activity** is merged into the library's with `mergeActivity`, or added where the
    library has none. One that cannot be read is named and left out. Other files under
    `.memoriam/` are left out.
  - **A `.txt` file** becomes a new passage, titled from the file's name.
  - The user is told, in sentences, how many passages were added, merged, already up to date or
    copied, whether practice records came in, and what was left out.

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
- `Mod+K` opens the palette (`components/CommandPalette.tsx`, ported from skysa-notes). It is the
  only chord: the screens are a tap away in the bar, and the chords a browser keeps for itself
  (`Mod+N`, `Mod+T`) cannot be taken.
- `components/AppCommands.tsx` registers what can be done from anywhere: go to each screen, start
  today's practice, add a passage, export a backup. A passage's page adds practising and editing
  that passage while it is open.

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
  installed to the home screen, and any browser may clear storage it has not been granted for good
  when the disk runs short. Until sync, the only copy of the library is this one. So, once there is
  a passage to keep:
  - **The install banner** shows, and not before.
  - **Persistent storage.** The app asks for it (`navigator.storage.persist()`,
    `store/persistence.ts`). After a refusal it asks again a month later. Chromium and Safari
    answer by how the site is used, so a later ask may be granted. Firefox asks the user, who is
    not to be asked on every visit. Settings says whether the browser has agreed, and can ask
    again.
  - **The backup reminder** (`store/backup.ts`) shows on Today a week after the first passage if
    no backup has been made here. After that, it shows a week after the last export, but only if
    any file has changed since; a day's practice changes the activity file. "Not now" puts it off
    for three days. An export from anywhere notes the day. A library that syncs is not reminded:
    it is kept in the user's own storage as well.

## 9. Security

The Content-Security-Policy in `apps/web/public/_headers`, checked by `tests/csp.test.ts`:
- `script-src 'self'`, and no inline script, `eval` or `new Function` in the shell. This is a hard
  requirement. Once sync arrives, the shell holds a long-lived credential in IndexedDB, as
  skysa-notes does.
- `connect-src`: this origin, which serves the API, and the hosts of the storage providers the
  browser syncs with directly, as skysa-notes lists them. These are `*.dropboxapi.com`;
  `graph.microsoft.com` and the hosts OneDrive serves file bytes from (`*.files.1drv.com`,
  `my.microsoftpersonalcontent.com`, `*.sharepoint.com`); and `www.googleapis.com`. Nothing else
  leaves the device.
- `src/jitless.ts` stops zod probing for `new Function`.

## 10. Sync (Phase 2)

Sync is skysa-notes' engine, ported:
- the provider adapters, with their contract tests;
- `sync/{engine,store,conflicts}`;
- the Hono Worker for OAuth, with the same per-connection credentials and no identity layer.

**Ported as it is.** Skysa-notes' design record for this code is its `docs/ARCHITECTURE.md`, as of
commit `fa92ad6`: §4 for the provider interface and its contract, §5 for each provider, and §7 for
the store and the engine. The ported code cites it as "skysa-notes' `docs/ARCHITECTURE.md`", so a
reference is never read against this file's sections. What follows records only where Memoriam
differs.

**The provider layer** (`packages/core/src/providers/`, `marker.ts`, `sync/conflicts.ts`):
- The adapters for Dropbox, OneDrive and Google Drive, and the in-memory fake.
- The marker file, and conflict names.
- The contract suite every adapter passes (`tests/providers/contract.ts`), with each provider's
  wire stub.

Only the names differ:
- `APP_FOLDER_NAME` is `memoriam`, and the marker is `.memoriam-app.json`.
- Google Drive tags the app's folder `appProperties: { memoriam: 'root' }`.
- `PROVIDER_KINDS` has no `webdav`, which skysa-notes deferred indefinitely.

The interface keeps `readBytes` and `createFile`, though nothing here yet writes a file that is not
a passage. Every adapter's `read` is its `readBytes` decoded, and audio (Phase 3) would need both.

**The engine** (`sync/engine.ts`, `sync/store.ts`, from S2) is ported whole, with its tests: the
store contract (`tests/sync/storeContract.ts`), run against the in-memory store the engine tests
use, the engine over every adapter's stub, and the randomized remote. The Google Drive tests that
drive the engine through the adapter, held back in S1, are restored. Where it differs:
- **No clipboard.** skysa-notes' engine pulls a clipboard folder for its share target. Memoriam
  has neither, so that path is gone, from the pull and from its progress reports.
- **The app's own folder.** The engine passes over hidden paths, except `.memoriam/` and its
  `activity-YYYY.md` files (`unsynced` in the engine). Every other hidden path, `.memoriam/` or
  not, is left alone, as skysa-notes leaves it. `isHidden` itself is unchanged, so the library
  still hides them.
- **Files, kept dormant.** The engine still carries skysa-notes' attachments: `SyncFile`, and the
  `upload`, `move-file` and `delete-file` ops. Nothing in the web app makes one yet. They stay so
  that audio (Phase 3) does not reopen the engine. `files.ts` holds the extension → content type
  map they need.

**Merge before a conflict copy.** skysa-notes never merges: on a conflict the remote keeps the
path, and the local version is written beside it as a conflict copy. Memoriam adds one merge
before that rule, through a `merge` option on the engine:
- **The option.** `merge({ path, local, remote })` returns the merged text, or `undefined` for no
  merge. A merge that throws counts as no merge. Without the option, the engine behaves as
  skysa-notes'.
- **`mergeFile`** (`sync/merge.ts`) is the merge the app passes:
  - an activity file goes to `mergeActivity`, if the remote one can be read;
  - a passage (`.md`, not hidden) goes to `mergePassage`;
  - anything else gets no merge.
- **On a pull.** Where a note changed here and on the remote since they last agreed, the engine
  merges before it decides on a conflict copy. This includes a note never sent that meets a
  remote one at its path, such as two devices' `activity-2026.md`.
- **On a push.** Where a write meets a `ConflictError` (`resolvePushConflict`), the engine reads
  the remote, merges, and writes the merge against the version it read.
- **The `merge-note` pull change** carries the merge. The store applies it only if the note still
  holds the content the merge was made from (`base`), and otherwise refuses the whole pull, so the
  next one decides again.
  - A merge that equals the remote leaves the note clean, and drops its queued writes.
  - Any other merge leaves it dirty, with a write queued, so the merge is sent.

**`mergePassage`:**
- If the bodies and the non-progress frontmatter match, merge `progress` chunk by chunk. The later
  `reviewed` wins, and the remote wins a tie.
- Otherwise, a conflict copy as skysa-notes does.
- Other metadata is not merged: with no base version, nobody can tell which side renamed it.

**`mergeActivity`:**
- Days: union, with the maximum of each field.
- Badges: union, keeping the earliest date.

The same merges already handle a backup imported over an existing library (§7, "Export and
import"). `mergePassage` is in `packages/core/src/progress/merge.ts`. `mergeActivity` sits with
the rest of the activity codec in `rewards/activity.ts`, and writes nothing when the incoming file
adds nothing.

**The web store** (S3: `apps/web/src/store/{queue,connection}.ts`, `apps/web/src/sync/store.ts`)
is skysa-notes' push queue and Dexie `SyncStore`, ported. The store passes the core contract
suite (`apps/web/tests/syncStore.test.ts`). Where it differs:
- **One library, one connection.**
  - skysa-notes keeps each connected source as a silo of its own. Its rows are keyed by that
    source, and the device's own pile is copied into the first source connected.
  - Memoriam has one library, so a connection is where that library syncs to. The rows stay
    under `connectionId = 'local'` whatever they sync with. The connection is the one
    `syncState` row, keyed by the id `apps/api` gives it.
  - The store is made for a connection, and writes only while the library is still bound to it.
- **Binding** (`bindLibrary`) queues the whole library for the remote, collection by collection
  (`queueByNotebook`). The first sync then pulls what the remote has and sends the rest. A
  passage on both sides is merged on that pull, or kept twice where the words differ.
- **Unbinding** (`unbindLibrary`) cuts every passage loose and keeps it.
  - Everything owed is forgotten, and so are the tombstones: their deletes were never sent.
  - The remote keeps those files, so binding to the same account again brings them back.
  - The files sync kept beside the passages go with the binding: they were the remote's.
- **Nothing is queued while the library is bound to nothing.**
  - There is nowhere to send it, and binding queues everything afresh.
  - A delete then removes the row outright rather than leaving a tombstone.
  - The rule is one check, in the queue's `add`, inside the writer's transaction.
- **Tombstones** are skysa-notes': a delete while bound keeps the row until the delete is sent,
  and every reader but sync passes over it (`isLive`).
  - Undo lifts a tombstone. One whose file the remote still has keeps its path, and a passage
    made at that name meanwhile moves aside.
  - A pull can write into a tombstone, since a tombstone owes the remote nothing but its delete.
    Then the undo merges the progress of both where the words agree. Otherwise it brings the
    deleted text back as a copy of its own.
- **Files beside passages.** A collection's rename moves them with it (`queueMoveFile`). A
  collection's delete leaves them: nothing here shows one, so nothing here deletes one. Their
  directory stays on the remote while it holds one.
- **When a passage counts as edited.** A pull keeps the row's `updatedAt` where the file changed
  only its progress (`sameApartFromProgress`). Otherwise the time moves forward, as skysa-notes'
  `editedAt` moves it.
- **Practice** queues one write, like any edit, marked as lazy ("Push timing", below).
- **Dirty means a write is owed.** The store clears the flag when a write lands, and nothing else
  does. So a passage moved without a change to its file, to another collection or by a
  collection's rename, keeps the flag it had, and owes only the move. Marked dirty, it stayed dirty
  for good. The other device's next edit then made a conflict copy of the old words, and a delete
  there left it here, cut loose from the remote (found by the soak, S6).

**The sync client** (S4: `apps/web/src/api/client.ts`, `store/credentials.ts`,
`sync/{tokens,providers,scheduler,account,runtime}.ts`) is skysa-notes' client, ported. Where it
differs:
- **No change relay, and no connect gate.** skysa-notes' server can run a relay, which tells a
  device as soon as another has pushed, and an operator's gate in front of connecting: a message,
  a code its policy checks, and the reasons beside a refusal. Memoriam's server has neither. So
  the client has no relay tickets, no connect code, no gate, and no reasons beside
  `not_entitled`. A device hears of another's changes at its next sync: on opening, on focus, on
  coming into view, and every minute while in view.
- **Credentials** are skysa-notes':
  - `sk1_` and 32 random bytes, made by the device, written down before the browser leaves for
    the provider (`beginConnect`), and filed under the connection once the server names it;
  - the server only ever sees the credential's SHA-256;
  - kept in IndexedDB, never localStorage. `script-src 'self'` (§9) is what protects them.
- **Tokens** are minted by `apps/api` against the credential, held in memory and on the `syncState`
  row, and replaced a minute before they expire (`sync/tokens.ts`).
- **Every provider request has a deadline** (`sync/providers.ts`): a minute, and longer for a
  large body.
- **The scheduler** (`sync/scheduler.ts`) follows the binding, with one session per bound
  connection. From skysa-notes, unchanged:
  - one run at a time per connection, across tabs (Web Locks, `memoriam:sync:<id>`);
  - a backoff from 5 seconds, doubling to 5 minutes, and a provider's `Retry-After` honoured up to
    15 minutes;
  - an op out of attempts holds the queue (`blocked`), and is tried again after 15 minutes or when
    the user asks;
  - a run that ends after the library was bound or let go (`bindingCount`) is ignored, and asked
    for again.

  It is started in `main.tsx`, and does nothing while the library is bound to nothing.
- **The account** (`sync/account.ts`). There is one library, so connecting is choosing where it
  syncs.
  - **A connect that comes back** binds the library (`claimConnection`). A library bound
    elsewhere is let go first, with every passage kept. The old credential's grant is signed out,
    since nothing here will present it again.
  - **`credential_revoked` or `not_found`** about the bound connection lets the library go and
    forgets the credential, keeping every passage. Anything else (offline, a 5xx, another refusal)
    changes nothing.
  - **Disconnecting** signs this device out on the server first, then lets go here.

**Push timing.** skysa-notes pushes 2 seconds after the last edit. Practice records a pass every
few seconds, and each pass changes the passage and the day's activity. Pushed alone, every pass
would be two requests, and at the provider two new file versions. So:
- **A pass's writes are lazy** (`queuePracticeWrite`): the passage's, and the activity file's.
- **The scheduler sends lazy writes with the next sync**: the minute's poll while the page is in
  view, or as the page is hidden. Either way they go within a minute of the first (`lazyMs`). A
  later pass joins that wait rather than putting it off.
- **An edit's write is never lazy.** An edit that finds a lazy write queued replaces it, at the
  back of the queue, so it goes after the 2-second debounce and takes the pass with it.
- **A write that lands after another pass was made** is owed again, as lazily as it was queued.
- **Hiding the page sends whatever waits**, at once: a phone may not run the page again for hours,
  and the next device opened should find the practice made here.

**The server** (S5: `apps/api`) is skysa-notes' Worker, ported: Hono on Cloudflare Workers, with
D1 through drizzle. It holds:
- the OAuth flows for Dropbox, OneDrive and Google Drive, with PKCE and a signed flow cookie;
- each connection's refresh token, encrypted at rest (AES-256-GCM);
- each device's credential, as its SHA-256 only.

It mints access tokens from the refresh token, lists the devices holding a connection, and signs
any of them out. The one Worker serves the app as well, so `/api` and the app share an origin.
`docs/self-hosting.md` says how to run one. Where it differs:
- **No entitlement policy.** skysa-notes asks an operator's policy at the callback and at
  `/token`. Memoriam does not: every account that connects may sync, and `not_entitled` is never
  the answer. The rate-limit seam stays, in `apps/api/src/limits.ts` rather than core, and ships
  `neverLimited`.
- **No connect gate, connect codes or change relay**, as the client has none ("The sync client").
- **No `AUTH_MODE` and no WebDAV.**
- **One migration.** The schema starts as skysa-notes' seven migrations leave it, less the two
  tables nothing reads (`users` and `identities`), in a single `0000_init.sql`.
- **Tests** run the real drizzle D1 driver over Node's `node:sqlite`, as skysa-notes' do. A
  contract test checks that the server's answers parse with the web client's own schemas.

**Connecting** (S6) is a section of Settings (`components/SyncSettings.tsx`):
- **Unbound**, it offers each provider the server has set up (`/config`) and this build can sync
  with. Choosing one writes the credential down, then leaves for the provider's consent screen.
- **The way back.** The server's callback sends the browser to the path the app started from, with
  the outcome in the query (`?connect=ok`). It never sees the hash, which is where the app keeps
  its place. So `main.tsx` reads the outcome out of the real query before the router is made, puts
  the address back without it, and opens Settings (`sync/connectReturn.ts`). Settings says the
  outcome once.
- **Keeping the binding in step** (`components/SyncKeeper.tsx`, in the root layout). Once a page
  load, it takes up a connection a flow has just consented to, or asks after the bound one
  (`claimConnection`). When the scheduler is told the credential reaches nothing, it asks again,
  which lets the library go if the server says so (`reconcileAccount`).
- **Bound**, the section names the provider and account, and says how syncing stands:
  - up to date, and when it last synced;
  - syncing, offline, or retrying;
  - what needs attention, with the change that is stuck, or "Connect again" when the provider
    must be asked again (`reauthorize_required`).

  Sync now runs a sync and tries again a stuck change.
- **Disconnect** asks first, then signs this device out on the server and lets go here. Where the
  server will not or cannot answer, the section offers to stop syncing on this device alone
  (`stopSyncingHere`).

**Conflicts** (S6: `store/conflicts.ts`, `routes/conflicts.tsx`). What sync could not merge it
keeps twice. The remote's version stays at the passage's path, and this device's goes beside it as
a copy, `name (conflict 2026-10-13T14-32).md`. Nothing is decided for the user:
- **Finding them.** A copy is known by the stamp in its name alone, so it is found on every device
  it reaches. Its original is the passage at the name without the stamp. While there is one, the
  Library and Settings say so, with a link to the conflicts screen.
- **The screen** shows the two versions side by side, with the lines one has and the other does
  not marked. The choices:
  - **Keep this version**, on either side. Keeping the copy writes its words and details over the
    original, at the original's path and under its id, and the copy goes. Keeping the original
    lets the copy go. Either way, where the two have the same words, the progress of both is kept
    (`mergePassage`). Each can be taken back from its notice. The undo leaves alone an original
    changed since the choice, and still brings the copy back, so no version is lost.
  - **Keep both**, as two passages. The copy is given the title "… (other version)", which moves
    it to a name of its own.
- **A copy whose original is gone** can be kept, which moves it to the original's name, or a name
  from its title where that one is taken. It can also be deleted, with undo.

**The two-device soak** (S6: `apps/web/tests/twoDeviceSoak.test.ts`). Two devices share one fake
provider, each with its own database, web store and engine. A seed drives them at random:
- passages made, edited, retitled, moved, deleted, and put back;
- passes recorded;
- collections made, renamed and deleted;
- syncs, some with the other device acting while a push is in flight.

At the end they sync in turn until nothing moves. Then the soak checks four things:
- both devices and the remote hold the same passages and activity files;
- neither device owes anything;
- each device's last words for a passage nobody deleted are still some passage's words;
- the last pass on such a passage is still in some passage's progress.

12 seeds of 40 steps run with the tests. 300 ran clean once the move fix above was in.

**Known issue: a passage's id can differ between devices.** A passage made here that meets another
at its path on the remote, before it was ever sent, keeps its row and its id for the remote's file.
That file's `id` is the other passage's, and its own words go to a conflict copy (`resolutionFor`
in the engine, as skysa-notes'). The next edit of its details here writes the row's id into the
file, and the other device's next edit writes its own back. No words or progress are lost. Import
matches a backup's passages by the file's `id`, so a backup from the other device brings such a
passage in as a second one rather than merging it. Fixing it means changing which row keeps which
id in the engine's conflict rule, which is left for a milestone of its own.

**Still to come:**
- **Provider apps.** New registrations named "memoriam" are needed with Dropbox, Google and
  Microsoft (Dropbox app names are permanent). `docs/self-hosting.md` says how.
- **A real two-device soak**, against a live provider, once the apps are registered.
- **The id rule above.**
- **The devices list.** The server lists the devices holding a connection and signs any of them
  out (`grants`, `revokeGrant`), but Settings does not show them yet.

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
    store/             Dexie: every local read and write, the push queue, credentials
    api/               the typed client for apps/api (from S4)
    sync/              the Dexie SyncStore, tokens, providers, the scheduler, the account
    archive/           zip export and import
    commands/          command registry, chords, palette
    i18n/              t(), rich(), and the English catalog
    install/           the install banner
packages/core/         framework-free TypeScript: browser, Node and Workers
  src/
    passage/           body grammar, tokenizer, chunker, remap
    progress/          frontmatter codec, passage merge
    providers/         storage adapters and the in-memory fake (from skysa-notes)
    sync/              the engine and its store contract, conflict names, the merge
    practice/          hiding, typing reducer, grading, fading
    schedule/          FSRS, the session planner
    rewards/           activity and its merge, streaks, mastery, badges
    markdown/          frontmatter (ported from skysa-notes)
apps/api/              the Worker (S5): OAuth, per-connection credentials, tokens, grants
  src/
    routes/            connect, token, connections
    oauth/             Dropbox, OneDrive, Google Drive
    db/                the D1 schema (drizzle)
  migrations/          generated by drizzle-kit, applied by wrangler
docs/
  ARCHITECTURE.md      this file
  research.md          the evidence
  self-hosting.md      running the Worker on your own Cloudflare account
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

Phase 2 is sync (§10), in milestones of its own:

| Milestone | Delivers |
|---|---|
| S1 | The provider adapters, the marker, conflict names, and the contract suite |
| S2 | The sync engine and the store contract in core, with the merge hook |
| S3 | The web store: schema version 2, the push queue, tombstones, binding, and the Dexie `SyncStore` |
| S4 | The sync client: credentials, tokens, the API client, the scheduler and push timing |
| S5 | `apps/api`: the Worker for OAuth, with per-connection credentials |
| S6 | Connecting storage in Settings, the conflict screen, and the two-device soak |

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
