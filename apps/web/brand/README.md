The default brand: what the app is called and how it looks when nothing else is given
(`docs/ARCHITECTURE.md` §8, "Brand"). A deployment that wants its own points `MEMORIAM_BRAND` at
a `brand.json` of its own when it builds, and changes nothing here.

- `brand.json`: the name ("Memoriam"), the colours, and where the icons are. No fonts, so the app
  keeps the system's. `brand.schema.json` is its JSON Schema, for an editor; `tests/brand.test.ts`
  holds it to `brandSchema` in `brand.ts`.
- `icons/`: the six icons, at the names and sizes in `BRAND_ICONS`. The mark is a passage being
  learnt: three lines of text, the last fading into dots where its words have been hidden. The
  favicons are a rounded tile; every other icon is a full square, since the platforms that show
  them round or crop it themselves (the maskable one keeps the mark inside the central 80% circle).
- `draw-icons.mjs`: draws them. `node apps/web/brand/draw-icons.mjs <out dir> '#RRGGBB'` makes a
  set on another colour.
