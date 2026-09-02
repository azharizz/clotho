# Occasion Lens Recolor Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose any visible headwear, top, bottom, or shoes item in Occasion lens, preview a recolor in place, and save that recolor only when they confirm “I wore this”.

**Architecture:** Keep the current outfit in `look`, replacing only the selected item with an in-memory recolor preview that carries the normal `WardrobeItem` shape plus variant metadata. A shared commit step converts preview items into duplicate-safe catalog variants immediately before wear history is recorded; existing calendar and history snapshots then receive the committed item without a second persistence system.

**Tech Stack:** React 19 client component, TypeScript, browser Canvas API, existing `WardrobeItem` variant persistence.

**Spec:** User request: “Inside Occasion lens select a part from head to shoes and recolor each; save the recolor to wardrobe when accepted with ‘I wore this’.”

## Global Constraints

- Keep the existing clean CLOTHO visual language and low-resource browser-canvas recoloring.
- Recoloring from Occasion lens is preview-only until the existing “I wore this” action is confirmed.
- Preserve direct per-piece selection and the existing click-to-enlarge outfit overview.
- Reuse the current variant persistence and duplicate detection; do not add a second wardrobe store.
- Keep headwear optional and never recolor a missing slot.

---

### Task 1: Add per-piece Occasion lens controls and in-place preview

**Files:**
- Modify: `app/page.tsx` around the look state, recolor helpers, Occasion lens composition, and controls.
- Modify: `app/globals.css` for selected-piece affordance and compact Occasion lens recolor copy.

**Interfaces:**
- `recolorOccasionPiece(category)` renders a low-resolution recolor for one category and replaces that item only in `look`.
- `occasionRecolorCategory` highlights the selected row; `occasionRecolorColors` keeps one color per category and missing headwear is disabled.

- [x] **Step 1: Add the selected-piece state and preview action.**

Use the existing `cleanImagePath()` and `recolorImage()` helpers. Derive the canonical base ID from `item.variantOf ?? item.id`, and create a temporary item with `variantOf`, uppercase `variantColor`, and `imageSrc` but do not append it to `items`.

- [x] **Step 2: Make visible pieces selectable without removing zoom.**

Keep the composition as one accessible button and delegate its click: a visible piece selects its category, while open space and keyboard activation still open the enlarged overview. Each row below remains keyboard-accessible for choosing a slot and running its recolor.

- [x] **Step 3: Add the Occasion lens selector, color input, and preview link.**

Render four ordered rows—headwear, top, bottom, and shoes—with one color input and recolor action per row, disable a missing headwear row, and show a short note that previews are not saved until “I wore this”.

### Task 2: Commit preview variants at wear confirmation

**Files:**
- Modify: `app/page.tsx` in `recordWear()` and the Occasion lens action row.

**Interfaces:**
- `commitLookVariants(outfit)` returns an outfit whose temporary recolor items are duplicate-safe saved variants and appends new variants to `items`.

- [x] **Step 1: Convert temporary recolors to saved variants.**

For each item carrying `imageSrc`, `variantOf`, and `variantColor`, reuse an existing matching base/color variant or create the same ID/name/style shape used by the Recolor lab. Append only new variants to `items` so the existing `clotho:variants` effect persists them.

- [x] **Step 2: Record the committed outfit and keep the main view consistent.**

Have `recordWear()` commit variants before adding history, set `look` to the committed outfit, and report how many recolored pieces were saved. A plain un-recolored wear keeps the current behavior.

- [x] **Step 3: Update the action copy.**

Tell the user that “I wore this” both records the wear and accepts any recolored previews into the wardrobe; do not auto-save from the preview action.

### Task 3: Verify the acceptance boundary

**Files:**
- Modify: `scripts/check-outfit.mjs` only if a pure engine assertion is needed; no new test dependency.

**Interfaces:**
- Existing engine and build checks remain the regression gate; UI state is verified by typecheck/build and a focused DOM smoke check when the dev server is available.

- [x] **Step 1: Run engine, calendar, weather, week, lint, typecheck, build, and diff checks.**

Run: `npm run check:engine && npm run check:calendar && npm run check:weather && npm run check:week && npm run lint && npx tsc --noEmit && npm run build && git diff --check`

- [x] **Step 2: Confirm the Occasion lens controls are present.**

Open the dev page, inspect the Occasion lens, and confirm four rows with per-piece color inputs, recolor actions, and acceptance copy render without changing panel navigation.
