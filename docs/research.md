# Memorizing text word for word: what the evidence says

This is the research behind how Memoriam teaches a passage. It covers:
- the cognitive science of learning text verbatim;
- the techniques built on it;
- the scheduling algorithms that decide when to review;
- what existing apps do;
- what is known about motivation.

The last section, [Design decisions](#7-design-decisions), says what Memoriam does with each finding.
`docs/ARCHITECTURE.md` §4–§6 records how that is built.

Compiled October 2026. Where a claim comes from my own prior knowledge rather than a source I
retrieved, it is marked *(not re-checked)*.

## Summary

- **The core mechanic is well supported, but nobody has tested it directly.** The mechanic: type
  the first letter of each word while words are progressively hidden. It combines three effects
  with strong evidence behind them:
  - **retrieval practice:** recalling something strengthens it more than rereading it;
  - **the generation effect:** producing a word yourself beats reading it;
  - **vanishing cues:** hints are withdrawn as the learner succeeds.

  No controlled study has tested this exact combination on passages. The design below extrapolates
  from studies of word pairs, prose and clinical populations, and from what established apps do.
- **Fade hints adaptively, not on a timetable.** Remove a hint after success and bring it back after
  an error. Fade slowly for hard items and weaker learners, and quickly for easy ones.
- **Learn in small chunks, link them in order, and sleep before the first review.** A chunk is
  roughly one verse, one sentence, or 2–4 lines of verse, split where a reader would pause. Join
  chunks with link drills and runs through everything learnt so far. Do the first review the next
  day.
- **Schedule each chunk separately, with FSRS, aiming for 90% recall.** Roll the chunk results up
  into a health score per passage. Grade every review automatically from errors, hints and
  hesitations.
- **Keep rewards informative and forgiving.** A streak needs a way to survive a missed day.
  Reward keeping material remembered, not volume. Leaderboards, if any, are opt-in.

---

## 1. Core findings

### Recalling beats rereading
- **Roediger & Karpicke (2006)**, using prose passages
  ([PDF](https://psychology.ecu.edu/wp-content/pv-uploads/sites/216/2019/03/Roediger-Karpicke-2006.pdf)):
  - rereading won on a test five minutes later;
  - testing won at two days and at one week;
  - students who reread felt more confident despite remembering less.
- **Dunlosky et al. (2013)** reviewed common study techniques. Only practice testing and spaced
  practice earned a rating of "high utility".
- **Implication:** hiding words and having them typed is retrieval. Reading the full text should
  be only a brief first step.

### Spacing
- **Ebbinghaus (1885)**, replicated by Murre & Dros (2015) in
  [PLOS ONE](https://ideas.repec.org/a/plo/pone00/0120644.html). The replication's forgetting curve
  shows a bump at 24 hours.
- **Cepeda et al. (2006)** combined 317 experiments
  ([PubMed](https://pubmed.ncbi.nlm.nih.gov/16719566/)). The best gap between sessions grows with
  how long the material must be kept.
- **Cepeda et al. (2008)**, with more than 1,350 learners
  ([PDF](https://www.evullab.org/pdf/CepedaVulRohrerWixtedPashler-PS-2008.pdf)):

  | Kept until | Best gap between sessions |
  |---|---|
  | 1 week | about 20–40% of that time |
  | 1 year | about 5–10% of that time |

  A gap that is too short hurts more than one that is too long.
- **Kornell (2009)** ([record](https://cir.nii.ac.jp/crid/1361699994055985152)): spacing beat
  cramming for 90% of learners, yet 72% believed cramming had worked better.
- **Implication:** let an algorithm schedule reviews, and show people their own retention. Their
  intuition will favour cramming.

### Widening the gaps, or keeping them equal
- **Karpicke & Roediger (2007)**
  ([abstract](https://profiles.wustl.edu/en/publications/expanding-retrieval-practice-promotes-short-term-retention-but-eq/)):
  - widening gaps helped at ten minutes, equal gaps did better at two days;
  - what mattered most was putting off the first recall.
- **Karpicke & Roediger (2010)**, on text, found no difference between the two.
- **Storm, Bjork & Storm (2010)**
  ([PDF](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/Storm_Bjork_Storm_2010.pdf))
  make the case for widening gaps.
- **Mettler, Massey & Kellman (2016)**
  ([PDF](https://kellmanlab.psych.ucla.edu/wp-content/uploads/sites/357/2025/09/mettler_massey_kellman_2016.pdf)):
  a schedule that adapted to accuracy and response time beat both fixed schedules.
- **Implication:** adapt the schedule to each item rather than following a fixed ladder. Response
  time is a legitimate signal for grading.

### Desirable difficulties
- **Bjork (1994); Bjork & Bjork (2011)**
  ([PDF](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/04/EBjork_RBjork_2011.pdf)):
  spacing, testing, interleaving and producing the answer all help long-term learning while making
  practice feel harder.
- Producing the answer helps only when the learner has enough cues to succeed.
- **Implication:** make practice harder only as fast as the learner can keep succeeding. That is
  why hints fade adaptively.

### Producing the word yourself (the generation effect)
- **Slamecka & Graf (1978)** first described it.
- **Bertsch et al. (2007)**, a meta-analysis of 86 studies, found an effect of d ≈ 0.40
  ([PubMed](https://pubmed.ncbi.nlm.nih.gov/17645161/)).

### Hard recall that succeeds is worth more
- **Pyc & Rawson (2009)**, *Journal of Memory and Language*: recalling something with difficulty,
  and succeeding, strengthens memory more than recalling it easily *(not re-checked)*.
- **Implication:** a slow but correct answer must not be graded as a failure.

### Mistakes help, if feedback is immediate
- **Kornell, Hays & Bjork (2009)** ([PubMed](https://pubmed.ncbi.nlm.nih.gov/19586265/)): failed
  attempts to recall improve later learning.
- **Hays, Kornell & Bjork (2012)**
  ([PDF](https://sites.lifesci.ucla.edu/psych-bjorklab/wp-content/uploads/sites/13/2016/07/Hays_Kornell_RBjork_inpress.pdf)):
  the benefit needs feedback straight away. Delayed feedback mostly removed it.
- **Implication:** show the correct word the instant a mistake is made.

### Successive relearning
- **Rawson & Dunlosky** ([review](https://journals.sagepub.com/doi/full/10.1177/09637214221100484)):
  practise until you get it right, then relearn in later sessions.

  | Practice | Recalled a week later |
  |---|---|
  | One correct recall in each of 3 spaced sessions | 68% |
  | 3 correct recalls in a single session | 26% |

- **Implication:** get it right once per session, then come back another day. Don't drill.

### Overlearning
- **Driskell et al. (1992)**, a meta-analysis, found a moderate benefit.
- **Rohrer et al. (2005)** ([USF](https://digitalcommons.usf.edu/psy_facpub/1772/)): the benefit
  was clear after one week and almost gone by four.
- **Implication:** don't drill past the point of success within a session.

### How much fits in working memory
- **Miller (1956)** put the limit at 7±2 items.
- **Cowan (2001)** ([PDF](https://memory.psych.missouri.edu/assets/doc/articles/2001/cowan-bbs-2001.pdf))
  revised it to about 4 chunks, within a range of 3–5.
- **Implication:** group about four chunks into a section.

### Natural units in remembered text
- **Rubin (1977)** ([Duke](https://dukespace.lib.duke.edu/items/7641a8ef-d3d7-4e45-aeef-0989c6c5e69c))
  studied passages people had learnt while growing up:
  - recall was partial but word for word;
  - it tended to start and stop where a reader breathes;
  - cueing with first letters, function words or music increased it.
- **Implication:** split chunks at pauses and punctuation. This is also direct support for
  first-letter cues.

### Long texts and where recall starts
- **Seamon et al. (2010)** ([PDF](https://www.gwern.net/docs/spaced-repetition/2010-seamon.pdf))
  studied John Basinger, who learnt all of *Paradise Lost* (10,565 lines) at about an hour a day
  for nine years:
  - he recited aloud and analysed the meaning;
  - given two lines, he recalled the next ten word-perfect 88% of the time;
  - given the opening of a book, that rose to 98%.
- **Chaffin's research on "performance cues"**
  ([UConn](https://musiclab.uconn.edu/wp-content/uploads/sites/290/2021/09/2009-ISPS-Chaffin-Demos-Crawford-PCsurveyHowDoesUsePCsVary.pdf)):
  musicians build their memory of a piece around landmarks in its structure and starting points
  they have practised.
- **Implication:**
  - the opening of each section makes a strong anchor;
  - chunks in the middle and late in a passage need extra practice;
  - practise starting from anywhere in the passage, not only the beginning.

### Mixing material (interleaving)
- **Brunmair & Richter (2019)**
  ([PDF](https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf)),
  a meta-analysis:
  - overall, mixing helped (g = 0.42);
  - for words, practising one thing at a time won instead (g = −0.39).
- **Implication:** mixing passages in review is useful because it spaces them out, not as a
  benefit of its own. Don't mix passages while first learning them.

### Sleep
- **Mazza et al. (2016)**
  ([release](https://www.psychologicalscience.org/news/releases/sleep-makes-relearning-faster-and-longer-lasting.html))
  compared people who slept between two learning sessions with people who did not:

  | | Slept between sessions | Did not |
  |---|---|---|
  | Trials needed to relearn | about 3 | about 6 |
  | Items recalled a week later (of 16) | about 15 | about 11 |

  The advantage was still visible six months later.
- **Implication:** cap how much new material is learnt in a day, and do the first review the next
  day.

### Understanding the meaning
- **Noice & Noice (2006)**, *Current Directions in Psychological Science*
  ([ScienceDaily](https://www.sciencedaily.com/releases/2006/01/060126194917.htm)): actors learn
  lines by focusing on what each line means and is meant to do ("active experiencing"). The exact
  wording comes along as a by-product.
- **Implication:** offer a short step for understanding the passage before drilling it.

### Memory palace (method of loci)
- **Twomey & Kroneisen (2021)** ([SAGE](https://journals.sagepub.com/doi/10.1177/1747021821993457))
  reviewed 13 randomised trials: g = 0.65, with a high risk of bias in the studies.
- **Implication:** best for remembering the *order of sections* in a long text, not the wording.
  It could be an optional feature.

### Saying it aloud (the production effect)
- **MacLeod et al. (2010)**
  ([PDF](https://uwaterloo.ca/memory-attention-cognition-lab/sites/default/files/uploads/files/jeplmc10-2.pdf)):
  - words read aloud are remembered better than words read silently;
  - the effect shows mainly in comparison within one list. Reading every word aloud showed no
    clear advantage over reading every word silently.
- **Forrin et al. (2012)**
  ([PDF](https://uwaterloo.ca/memory-attention-cognition-lab/sites/default/files/uploads/files/forrin2012.pdf)):
  typing and writing count as producing a word too, but speech has the strongest effect.
- **Implication:** typing already gets some of this benefit.

---

## 2. Techniques for verbatim memorization

### 2.1 Vanishing cues (the most relevant evidence)
- **Glisky, Schacter & Tulving (1986)**, *Journal of Clinical and Experimental Neuropsychology*
  8:292–312 ([PubMed](https://pubmed.ncbi.nlm.nih.gov/3755140/),
  [PDF](https://sites.harvard.edu/schacter-memory/files/2022/06/glisky1986.pdf)):
  - memory-impaired patients learnt computer vocabulary from word fragments that shrank across
    trials;
  - a letter was removed after a correct answer and added back after an error;
  - learning relied heavily on the first-letter cue, yet every patient learnt a substantial amount
    and kept it for six weeks.
- **Riley & Heaton (2000)**, *Neuropsychological Rehabilitation*
  ([Birmingham](https://research.birmingham.ac.uk/en/publications/guidelines-for-the-selection-of-a-method-of-fading-cues/)):
  - fast fading worked better for people with better memories and for easier items;
  - gradual fading worked better for weaker memories and harder items.

  This is the case for fading at a speed set by both the learner and the item.
- **Finley, Benjamin, Hays, Bjork & Kornell (2011)**, *Journal of Memory and Language* 64:289–298
  ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3076684/)). Final recall:

  | Method | Without feedback | With feedback |
  |---|---|---|
  | Diminishing cues | 0.40 | 0.58 |
  | Accumulating cues | 0.25 | 0.51 |
  | Study only | 0.29 | 0.40 |

  - "Diminishing cues" started with the whole word and dropped one letter per trial.
  - They worked by producing about twice as many *successful* recalls.
  - Learners who struggled early benefited most.
  - The authors propose a hybrid: **add cues within a trial, and remove them across trials.**
    That is exactly "progressive hints during a pass, more hidden on each new pass".
  - The final test came only minutes later, so long-term retention was not tested.
- **Fiechter & Benjamin (2018)**, *Psychonomic Bulletin & Review*, doi 10.3758/s13423-017-1366-9
  ([summary](https://featuredcontent.psychonomic.org/sherlock-holmes-and-mrs-h____n-the-mystery-of-diminishing-cues-retrieval-practice/)):
  - without feedback, on hard material, recall with diminishing cues beat both restudying and
    plain testing;
  - with feedback, it matched plain testing.
- **Takeaway:**
  - progressive hiding is a support that keeps recall succeeding;
  - its advantage is largest early on and for harder material;
  - immediate feedback should be given anyway, and it removes the cost of a harder schedule.

### 2.2 First-letter cues
- **Rubin (1977):** first-letter cues increase word-for-word recall of passages people already
  know.
- **First-letter mnemonics:** the classic research (Morris & Cook 1978; Carney, Levin & Levin
  1994; [ResearchGate](https://www.researchgate.net/publication/230173871_When_do_first_letter_mnemonics_aid_recall))
  finds they mainly preserve *order*, and help little unless the material is already familiar. So
  they support recall after first learning; they are not a way to learn new material.
- **Practitioners' method** ([Art of Memory forum](https://forum.artofmemory.com/t/what-is-the-best-technique-for-memorizing-sentences-verbatim/112148);
  anecdotal): write out the initials, recite from them, and repeat about three times. Long run-on
  sentences are reported as hard.
- **The distinction this app depends on:** in Memoriam, as in Bible Memory, the first letter is
  the learner's *answer*, not a cue shown to them. Typing it is a fast stand-in for recalling the
  word. The weakness is that only the first letter is checked:
  - a guess is often right: in English roughly one running word in six begins with "t"
    *(not re-checked)*;
  - it cannot tell apart words that share an initial ("this" and "that", "shall" and "should").

  So first-letter accuracy probably overstates how well someone knows the exact wording. That
  argues for a high bar to count as learnt (about 90%), and for an occasional full-recall check.

### 2.3 Progressive deletion, disappearing text, cloze
- **Bible Memory app** ([games](https://biblememory.com/bible-memory-games)):
  - "Memorize It" hides every other word and swaps which half is hidden each round, so every word
    is tested within two passes;
  - "Master It" hides every word;
  - hints and mistakes lower the accuracy score.
- **MemoCoach** ([App Store](https://apps.apple.com/us/app/-/id1220188894)): hides a random set of
  words, shows more when the learner is stuck and hides more when they are comfortable, until the
  page is blank. This is vanishing cues driven by the user.
- **Anki's LPCG (Lyrics/Poetry Cloze Generator)**
  ([docs](https://ankilpcg.readthedocs.io/en/latest/theory.html)): each card shows two lines of
  context and asks for the next line. Its author's reasoning:
  - a whole poem on one card means one weak line forces a review of the whole poem;
  - each card must make sense on its own, so cards can be reviewed in any order;
  - cards like these are *not* a good way to first learn a poem, because the missing context makes
    first learning needlessly hard.

  The author's procedure for first learning a poem:
  1. Learn it line by line.
  2. Learn chunks growing from 2 lines to 6 ("unnecessary beyond six").
  3. Sleep.
  4. Recite the whole poem, fixing the weak spots.
  5. Repeat the recitation the next day.

### 2.4 Learning in parts or as a whole
The evidence is old and mixed:
- A 1983 Hiroshima study of a 16-line poem
  ([record](https://ir.lib.hiroshima-u.ac.jp/00027163?locale=en)): practising parts carried over to
  the whole poem only when the parts were learnt *in order*.
- A 1994 thesis ([ECU](https://ro.ecu.edu.au/theses_hons/643)): learning harder songs whole was
  better for long-term memory.

Combined with Cowan's limit of about four chunks and the LPCG procedure, the best-supported
approach is a **cumulative part method within a hierarchy**:
- learn chunks in order;
- join each new chunk to the one before it;
- run through the whole section regularly.

### 2.5 Learning from the end (backward chaining)
- No good study tests backward chaining for text. The reasoning for it comes from language teaching
  and from serial-position effects ([overview](https://en.wikipedia.org/wiki/Back-chaining)).
- The real problem it addresses: later material gets less practice and fewer places to start
  from.
- Seamon's 98% against 88%, and Chaffin's landmarks, point to a better fix:
  - practise starting from any chunk;
  - give extra weight to chunks in the middle and late in a passage, and to the joins between
    chunks.
- **Implication:** offer backward chaining as an option, not the default.

### 2.6 How actors learn lines
- **Noice & Noice:** understand *why* each line follows the previous one and what it is meant to
  do, and deliver it as if speaking to someone
  ([VOA](https://learningenglish.voanews.com/a/a-23-2006-02-15-voa1-83127542/117194.html)).
  Actors were no better than anyone else at memorizing unrelated material such as an encyclopedia
  passage.
- **Basinger** recited aloud and analysed the structure in depth.
- **Implication:** a light step for understanding the passage, before drilling it.

### 2.7 Reciting aloud
The production effect (section 1) is real for single words. For passages it is plausible but
untested. An optional "say it as you type" prompt costs little.

---

## 3. Scheduling algorithms

### 3.1 Leitner (1972)
- Cards move up a box when answered correctly and back to the first box when missed
  ([overview](https://en.wikipedia.org/wiki/Leitner_system)).
- Each box has a fixed interval, for example 1, 3, 7, 14 and 30 days.
- Simple and transparent, but it does not adapt to the item. Worse at predicting forgetting.

### 3.2 SM-2 (Woźniak, 1987–1990)
*([source](https://super-memory.com/english/ol/sm2.htm); formula not re-checked)*
- The first interval is 1 day and the second 6 days. After that, each interval is the previous one
  times the item's ease factor (EF).
- EF starts at 2.5, and after a review graded q (0–5) it becomes
  EF + (0.1 − (5−q)(0.08 + (5−q)·0.02)), never lower than 1.3.
- A grade below 3 starts the item again.

### 3.3 Anki's variant of SM-2
([Anki FAQ](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm))

| Button | Effect |
|---|---|
| Again | The card goes to relearning; ease −20 points |
| Hard | Ease −15 points; the interval × 1.2 |
| Good | The interval × the ease |
| Easy | Ease rises, and the interval gets a bonus |

- Ease never goes below 130%.
- Repeated failures leave a card stuck at very short intervals ("low interval hell").

### 3.4 FSRS (Free Spaced Repetition Scheduler)
**The memory model**
([Anki](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm),
[algorithm](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm)). Each card
has three values:
- **Retrievability (R):** the chance of recalling it now. It changes every day.
- **Stability (S):** the number of days for R to fall from 100% to 90%.
- **Difficulty (D):** a value from 1 to 10 for how hard the card is to stabilise. Each review
  changes it slightly, and pulls it back towards an average.

**Formulas (FSRS-6)**
- Forgetting curve: R(t, S) = (1 + f·t/S)^(−w₂₀), where f = 0.9^(−1/w₂₀) − 1.
- Interval for a target retention r: I = (S/f)·(r^(−1/w₂₀) − 1).

**How a review changes stability**
- After a success, stability grows less for harder cards and for cards that are already stable.
- It grows **more when recall was unlikely at the time of the review.** That builds the spacing
  effect into the model, and means reviewing early does little harm, and little good.
- Hard reduces the gain and Easy adds a bonus.
- A failure resets stability to a much smaller value, set by D, the previous S and R.

**Parameters:** FSRS-6 has 21 parameters, with defaults fitted to large datasets. An optimiser can
fit them to one person's reviews.

**Target retention:** the default is **0.9**. Higher targets mean more reviews, and the workload
grows steeply above about 0.95.

**Benchmark** ([srs-benchmark](https://github.com/open-spaced-repetition/srs-benchmark)), on about
350 million reviews from about 10,000 Anki collections. Lower log loss means better predictions:

| Model | Log loss |
|---|---|
| FSRS-7 | 0.337 |
| FSRS-6 | 0.346 |
| FSRS-5 | 0.356 |
| FSRS-4.5 | 0.363 |
| Duolingo HLR | 0.469 |
| Ebisu v2 | 0.499 |

SM-2 is not in the current table. A forum claim, not checked here, says FSRS-5 beats a trained SM-2
for 97.4% of users ([forum](https://forums.ankiweb.net/t/fsrs-vs-sm2-in-2-seperate-profiles/52171)).

**Implementation:** [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) is FSRS-6 in
TypeScript under the MIT licence.
- `createEmptyCard()` makes a new card.
- `fsrs()` makes a scheduler.
- `scheduler.next(card, now, Rating.Good)` applies one review.

**Caveat:** FSRS handles same-day reviews imperfectly
([notes](https://l-m-sherlock.notion.site/Clarifications-about-FSRS-5-short-term-memory-and-learning-steps-156c250163a180b3bdd5fe4c96f1cdda)).
Memoriam keeps first learning out of FSRS altogether; the fading ladder does that job.

### 3.5 Half-life regression (Duolingo; Settles & Meeder 2016)
([blog](https://blog.duolingo.com/how-we-learn-how-you-learn))
- The chance of recall is p = 2^(−Δ/h), where Δ is the time since the last practice and h is a
  half-life the model learns.
- It cut prediction error by more than 45% against earlier baselines, and raised activity by 12% in
  Duolingo's A/B tests.
- FSRS now benchmarks much better.

### 3.6 Scheduling a passage or its chunks
- **Schedule each chunk separately.** LPCG's argument applies here:
  - a whole-passage card fails whenever any part is weak, so the strong parts get over-reviewed;
  - each chunk has its own difficulty.
- **A short passage of up to about 40 words** can be a single card.
- **The independence problem:** FSRS assumes cards are independent, but neighbouring chunks prompt
  each other. To limit this:
  - show one line of what comes before each chunk during review;
  - when several chunks of one passage are due, merge them into one run, but grade each chunk on
    its own;
  - let a run through the whole passage count as a review of every chunk in it. Early reviews cost
    little.
- **One number per passage:** a passage's "memory health" is the mean (or the minimum) of its
  chunks' predicted recall.

### 3.7 Grading recall from typing
In FSRS, **Hard is a pass**; Again is only for a real failure. Starting rules, to be tuned:

| Grade | When |
|---|---|
| Again | Any hint that revealed a word; or more than ~15% of words missed (2 or more on a chunk under 10 words); or the chunk was abandoned |
| Hard | 1 miss (up to ~10% of words); or no misses but 2 or more hesitations |
| Good | No misses, and at most 1 hesitation |
| Easy | Reviews only, never during first learning: no misses, no hesitations, and at least the user's usual fluent pace |

- **A hesitation** is a wait before a word's keystroke longer than max(2 s, 2.5–3 × the user's
  median time per word on material they know well). Using response time is supported by Mettler
  et al.; Pyc & Rawson argue against treating an effortful success as a failure.
- **A slip onto an adjacent key** is logged separately and does not count as a failure to recall.
  Bible Memory also gives credit for adjacent keys.

---

## 4. Existing apps

| App | Modes | First-letter typing? | Review | Motivation and progress |
|---|---|---|---|---|
| **Bible Memory** (formerly Scripture Typer; [manual](https://biblememory.com/Pages/Users-Manual/)) | Type It (all visible) → Memorize It (every other word hidden, alternating) → Master It (all hidden); speed rounds, flashcards, audio | **Yes, the core mechanic.** 90% accuracy needed to master or review ([2012](https://biblememory.com/bulletin/446)) | Spaced repetition, daily to yearly | Points, levels, leaderboards, a heat map of missed words; 4.8★ from about 30,000 ratings |
| **Verses** ([App Store](https://apps.apple.com/us/app/id939461663)) | Absorb → Memorize → Recall games, "adaptive difficulty" | Not confirmed | "Memory health" | Progress by verse, chapter and book; groups |
| **Remember Me** ([site](https://remem.me)) | Word puzzle, fill the gaps, typing, first letters, placeholders, line by line, audio, flashcards | Yes | Spaced repetition (New / Due / Known) | Streaks, goals, charts, groups |
| **Fighter Verses** ([App Store](https://apps.apple.com/us/app/id411711646)) | Reveal word by word, record a recitation, typing, first letters, word bank, trivia | Yes | Intervals the user sets | Minimal |
| **Versify** ([App Store](https://apps.apple.com/app/id1597230197)) | Read, first letters, fill the blank, free typing, speak aloud, listen, flashcards | Yes | — | Free; 4.9★ |
| **VerseLock** ([App Store](https://apps.apple.com/us/app/-/id6740823561)) | Read and tap, record, reveal challenge, typing challenge (all hidden, first letters) | Yes | None | Streaks, milestones, widgets |
| **MemorizeNow** ([note](https://www.thegospelcoalition.org/blogs/justin-taylor/memorize-now/)) | Shows first letters as prompts | Shown as cues, not typed | None | None |
| **Memorize By Heart** ([App Store](https://apps.apple.com/us/app/memorize-by-heart-learn-texts/id1436935583)) | Letter and word removal, scramble, fill blanks, first letters, recall, recite, script mode, chunking | Yes | Spaced repetition | Streaks with recovery, points, levels, badges |
| **MemoCoach** | Random word and line hiding, revealed by the user | Unclear | None | — |
| **Anki + LPCG** | Context lines, then recite the next line | No | SM-2 or FSRS | None |

**The pattern:**
- Most apps go from becoming familiar with the text, to partly hidden, to fully hidden, to spaced
  review.
- First-letter typing is the usual fast recall mode.

**The gaps:**
- few apps fade hints *for each word, adaptively*;
- few schedule *chunks* separately and link them into long passages;
- none publish their algorithms.

---

## 5. Motivation

- **Gamification's effect is small but positive.** Sailer & Homner (2020), a meta-analysis
  ([Springer](https://link.springer.com/article/10.1007/s10648-019-09498-w)):

  | Outcome | Effect (g) |
  |---|---|
  | Learning | 0.49 |
  | Motivation | 0.36 |
  | Behaviour | 0.25 |

  Only the effect on learning held up in the most rigorous studies.
- **Rewards people expect can erode motivation.**
  - Deci, Koestner & Ryan (1999), 128 experiments
    ([PDF](https://home.ubalt.edu/ntygmitc/642/Articles%20syllabus/Deci%20Koestner%20Ryan%20meta%20IM%20psy%20bull%2099.pdf)):
    expected rewards tied to taking part, finishing or performing reduced intrinsic motivation
    (d −0.28 to −0.40). Positive *informational* feedback increased it.
  - Hanus & Fox (2015): leaderboards and badges in a semester-long course lowered intrinsic
    motivation and final exam scores (n = 80).
  - People memorizing scripture or poetry are often motivated for their own reasons, so this risk
    is real.
- **A broken streak drives people away.** Silverman & Barasch (2023, *Journal of Consumer
  Research*; [summary](https://www.colorado.edu/business/news/2023/04/20/research-streaks-marketing-tech-barasch)):
  - an intact streak increases later engagement;
  - a broken streak that is highlighted reduces it;
  - the drop is smaller when the break can be repaired, and larger when people blame themselves;
  - "get back on track" messages tend to backfire.
- **Slack helps people keep going.** Sharif & Shu (2019)
  ([PDF](https://anderson-review.ucla.edu/wp-content/uploads/2021/03/Sharif-Shu_EmergencyReserveFailure_OBHDP2019.pdf)):
  goals with an "emergency reserve" of skip days improve persistence after a failure.
- **Duolingo's own data** ([blog](https://blog.duolingo.com/how-duolingo-streak-builds-habit)):
  - streak animations raised 7-day retention by 1.7%;
  - letting people hold two streak freezes raised daily active learners by 0.38%.
- **Missing a day is fine.** Lally et al. (2010)
  ([UCL](https://www.ucl.ac.uk/news/2009/aug/how-long-does-it-take-form-habit)):
  - habits took a median of 66 days to become automatic, with a range of 18–254;
  - a single missed day did not materially affect the process.

  A strict daily streak does not match how habits actually form.
- **What tends to work:**
  - forgiving streaks;
  - progress towards a concrete goal;
  - "fresh start" framing at the start of a week or month (Dai, Milkman & Riis 2014;
    *not re-checked*);
  - feedback that informs, such as accuracy compared with last time, or a heat map;
  - celebrating milestones.
- **What tends to backfire:**
  - public leaderboards by default;
  - points for volume, which leads people to add too much or grind easy material;
  - guilt about a lost streak;
  - heavy random rewards.

---

## 6. Gaps in the evidence

- The fading studies used word pairs and short delays.
- No randomised trial has tested first-letter typing for passages.
- What apps claim about their features is marketing.
- The FSRS benchmarks come from flashcards, not from chained text.

Worth testing once there is enough use:
- how fast hints fade;
- hiding content words first or function words first;
- the hesitation threshold;
- assigning Easy automatically, or never;
- default chunk size;
- a "say it aloud" prompt.

---

## 7. Design decisions

What Memoriam does with each finding. `docs/ARCHITECTURE.md` §4–§6 records how it is built.

| Finding | What Memoriam does | Built in |
|---|---|---|
| Recalling beats rereading (§1); first letters are a fast stand-in for recalling the word (§2.2) | The core interaction: type the first letter of each word. The full text is shown only at the first level | `packages/core/src/practice/` |
| Adaptive vanishing cues (§2.1) | Each chunk climbs a ladder, L0–L5, from all words visible to a bare card. It moves up a level after success and down after failure | `practice/hide.ts`, `practice/fade.ts` |
| Rotation (Bible Memory); bringing a missed cue back (Glisky) | Every word is hidden within a few passes. A missed word is shown on the next pass and hidden again on the one after | `practice/hide.ts` |
| Feedback must be immediate (§1) | A wrong key at once shows the correct word in red. The user must then type its letter, and it counts as one miss | `practice/typing.ts` |
| Hints added within a trial (Finley 2011) | After about 5 seconds idle, a faint outline of the word appears, then the word. A hint counts as a miss | `practice/typing.ts` |
| Chunks at breath pauses, about 4 per section (Rubin; Cowan) | Chunks of 10–30 words, split at lines, then sentences, then clauses. Blank lines separate sections | `passage/chunk.ts` |
| Learning parts in order and linking them (§2.4) | Link passes after each chunk, a run of the section so far, and a drill on section openings | `schedule/session.ts` |
| Getting it right once per session, then sleeping (§1) | Learning a chunk stops at one clean pass at L5. Its first review is the next day | `practice/fade.ts`, `schedule/fsrs.ts` |
| FSRS beats the alternatives (§3.4) | ts-fsrs for each chunk, with 0.9 retention by default. Presets 0.85, 0.9, 0.95; longest interval 365 days | `schedule/fsrs.ts` |
| Grading from errors and hesitations (§3.7) | Fully automatic grades, from the table in §3.7 | `practice/grade.ts` |
| A score per passage (§3.6) | Mastery % (the share of words in learnt chunks) and memory health (mean predicted recall) | `rewards/mastery.ts` |
| Forgiving streaks, slack, no guilt (§5) | Freezes earned by practising (one per 7 days, at most 2 held), a 48-hour repair, an optional rest day | `rewards/activity.ts` |
| Informational feedback (§5) | A heat map of missed words, an activity heat map, and milestone badges for keeping material remembered, not for volume | `rewards/badges.ts` |
| First letters overstate recall (§2.2) | An occasional full-recall check, planned for Phase 3 | — |
| First letters do not exist in some scripts | Chinese, Japanese, Korean and Thai are not supported in v1: their words are not typed by a first letter | `passage/tokenize.ts` |
