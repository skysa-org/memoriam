---
'@memoriam/web': patch
---

The stylesheet is a file for each part of the app (`src/styles/`), imported in the order it cascades, and builds the same CSS as the single file did.

Corners, shadows, sizes of words and what is over what are named steps in `src/styles/tokens.css`, as spacing was, and the brand's colours have defaults there for a page without the brand's stylesheet.

The bare buttons of the notices, the install banner, the other-tab dialog and the error screen are drawn by one rule.

An error toast now draws its red bar down its side, which the toast's own border had covered. A toast's tone, how often a word was missed, and a day's level in the heatmap are said by `data-*` attributes rather than class names built in code.

The app's words sit on one scale of sizes: a few move by less than a pixel, and none by more than one. The field for a passage's words is a pixel larger, the size the passage is shown at.

The padding, margins and gaps a step was near sit on the steps, and the command palette's shortcut keys are a fraction of a pixel roomier.
