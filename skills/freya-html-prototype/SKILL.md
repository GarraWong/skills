---
name: freya-html-prototype
description: Use when building a clickable HTML prototype, mockup, or design spike of a Freya screen — one file, no build step, opened in a browser. Produces MUI v5 markup styled by the real published Freya theme rather than a hand-copied approximation. Triggers include prototype, mockup, wireframe, design spike, proof of concept, "show me what it would look like", sharing a screen design with a PM or designer, and iterating on layout before writing app code.
---

# Freya HTML prototype

A prototype here is one `.html` file plus a fetched `assets/` folder. It runs
React 18, MUI v5 and the real Freya theme from `<script>` tags — no npm project,
no bundler, no dev server build.

The theme is the published `@freyr/freya-docs-ui` package, so a prototype shows
the same blue, the same 3px radius and the same Nunito Sans as the shipped apps.
Do not hand-copy theme values into a prototype; that is the drift this exists to
prevent.

**This is for prototypes only.** This repo ships no application code, so nothing
here ever becomes UI. When the shape is agreed, distil it into `BR-xxx` rules
under `functional-spec/` and raise an OpenSpec change; the UI itself is built in
`Freya-Docs-UI` under that repo's own rules (lint preset, `sx` ratchet).

## Where a prototype lives

One folder per topic under `requirements/<topic>/`, next to the requirement it
illustrates:

```
requirements/<topic>/
  prototype.html
  README.md      # what it demonstrates, what is faked, open questions
  .gitignore     # assets/
  assets/        # fetched, never committed — ~4 MB
```

A prototype is raw input for discussion, the same layer as the rest of
`requirements/`. Say so in the README: it is not agreed, not a design
deliverable, and not code to promote.

## Setup

From the folder the prototype will live in:

```bash
node .claude/skills/freya-html-prototype/scripts/setup-assets.mjs .
```

That writes five files into `./assets/`, fetched with `npm pack` using the
caller's existing npm auth:

| File | Global | Source |
| --- | --- | --- |
| `react.js` | `React` | `react@18` |
| `react-dom.js` | `ReactDOM` | `react-dom@18` |
| `mui.js` | `MaterialUI` | `@mui/material@5` — emotion bundled in |
| `freya-theme.js` | `FreyaTheme` | `@freyr/freya-docs-ui` |
| `babel.js` | `Babel` | `@babel/standalone@7` — compiles the JSX in-page |

Re-running skips files already present; `--force` refetches.

`@freyr/freya-docs-ui` comes from the Freyr ADO feed. If that fetch fails it is
almost always auth — the script says so and prints the `.npmrc` line to check.
The other four come from the public registry. **No checkout of any frontend repo
is needed**, which is why the theme is published at all — this repo has no
`node_modules` and needs none.

Then copy `templates/prototype.html` alongside `assets/` and edit it, and add the
`.gitignore` with `assets/` in it so the 4 MB never lands in a docs repo.

## Viewing it

Serve the folder rather than double-clicking the file:

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```

Loading over `http://` is the path that is verified to work. `file://` may work
too, but browsers treat it inconsistently and it has not been tested here.

## Writing the prototype

The template already wires up the theme. Inside `<script type="text/babel">`,
pull components off the `MaterialUI` global and write ordinary JSX:

```jsx
const { Box, Stack, Typography, Button, Dialog, TextField } = MaterialUI;
```

Everything in `@mui/material` is available — 459 components, including `Dialog`,
`Drawer`, `Tabs`, `Autocomplete`, `Stepper`, `Menu`, `Tooltip` and the whole
`Table` family.

Write it the way app code is written, so it can move across by copy-paste:

- Theme tokens, never literals — `color: 'text.primary'`, `p: 2`, `gap: 1`.
- `<Typography variant="…">` for type, not `fontSize` / `fontWeight`.
- `variant="contained"` for the primary action, `color="secondary"` for the grey
  Default button beside it. That pairing is the Freya dialog footer.
- `sx` is fine here. The ratchet does not apply to prototypes.

## Two things the prototype cannot have

Both are UMD gaps, not policy:

- **No Data Grid.** `@mui/x-data-grid-premium` ships no UMD build and needs a
  licence key. Use `Table` / `TableContainer` for record lists. It looks close
  enough to communicate a layout, and the real screen swaps it for the grid.
- **No `@mui/icons-material`.** Also no UMD build. Use `createSvgIcon` from the
  `MaterialUI` global with a path lifted from the Docs UI's own SVGs
  (`../Freya-Docs-UI/src/assets/images/DocsIcons/`, `DetailPanel-icons/`), or
  inline `<svg>`. Do not import an icon font or fetch icons from a CDN. If that
  sibling repo is not checked out locally, draw a plain shape rather than
  inventing a Freya icon.

```jsx
const { createSvgIcon } = MaterialUI;
const UploadIcon = createSvgIcon(<path d="M5 20h14v-2H5v2zM12 4l-5 5h3v6h4V9h3l-5-5z" />, 'Upload');
```

## Checking your work

Confirm the theme actually applied rather than trusting the screenshot — a
prototype that silently falls back to stock MUI looks plausible and is wrong:

```js
const cs = getComputedStyle(document.querySelector('.MuiButton-containedPrimary'));
cs.backgroundColor;  // rgb(41, 94, 241)  = #295ef1
cs.borderRadius;     // 3px
cs.textTransform;    // none
getComputedStyle(document.querySelector('h1')).fontFamily;  // "Nunito Sans"
```

If the button is stock MUI blue `#1976d2` with a 4px radius and uppercase text,
`freya-theme.js` did not load or `createTheme` was called without it.

## Never do

- NEVER retype theme values (hex, radius, type scale) into the prototype. Read
  them from `FreyaTheme.freyaThemeOptions`. A prototype whose blue is close but
  not equal to `#295ef1` misleads the reviewer about what shipped UI will look
  like, and that is the whole cost this skill is paying setup time to avoid.
- NEVER load React, MUI, Babel or fonts from a CDN. The assets are vendored so a
  prototype opens on a plane, survives the CDN being blocked on the corporate
  network, and renders identically a year from now.
- NEVER drop the `MuiCssBaseline: FreyaTheme.cssBaselineFontFix` override from
  `createTheme`. It carries the eight `@font-face` blocks; without it every
  weight silently falls back to the system sans and the type looks wrong in a way
  that is hard to name from a screenshot.
- NEVER promote a prototype to app code as-is. It has no tests, no i18n, no
  permissions and no data layer, and it is exempt from the lint rules that real
  UI must pass. Rebuild it in `Freya-Docs-UI`.
- NEVER let a prototype stand in for a spec. It is `requirements/`-layer input:
  free-form, prescriptive, not testable. The agreed behaviour still has to become
  `BR-xxx` rules in `functional-spec/` — a screenshot is not a business rule, and
  a reviewer nodding at a prototype is not sign-off on one.
- NEVER commit `assets/`.
