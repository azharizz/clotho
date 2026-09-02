# Recolor Wardrobe Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user preview a recolor, explicitly save it as a persistent wardrobe variant, and have that variant participate in CLOTHO recommendations and calendar workflows.

**Architecture:** Keep the manifest as the canonical base catalog and append locally saved variant records to the in-memory `items` collection after manifest load. A variant stores its generated 512px data URL plus `variantOf` and `variantColor`; existing scoring, calendar, batch, search, and history code then consume it without a second catalog abstraction. Persist only the variant collection in `clotho:variants`; the existing plan/history snapshots continue to work because they already store item records.

**Tech Stack:** React 19 client component, TypeScript, browser Canvas API, `localStorage`, existing deterministic outfit engine.

**Spec:** User request: “Save recolored versions as wardrobe variants — needed if recolored items should participate in recommendations, calendar, batch, and history; add a decision in the recolor page so preview can be explicitly saved, with many variants supported.”

## Global Constraints

- Keep recoloring browser-local and low-resource; do not add a backend or image-generation service.
- Preserve the existing preview-first behavior; recoloring alone must not silently save data.
- Saved variants must be selectable and scoreable like normal wardrobe items.
- Reuse existing `WardrobeItem`, `displayPath`, and outfit-engine paths rather than adding parallel recommendation logic.
- Handle malformed saved variant data and storage quota failures without breaking the app.

---

### Task 1: Add persisted variant records to the catalog

**Files:**
- Modify: `lib/outfit-engine.ts:3-11`
- Modify: `app/page.tsx:45-60,126-205,850-853`

**Interfaces:**
- `WardrobeItem` gains optional `variantOf?: string`, `variantColor?: string`, and `imageSrc?: string` fields.
- `imagePath(item)` and `cleanImagePath(item)` return `item.imageSrc` for saved variants.
- `readSavedVariants()` returns validated `WardrobeItem[]` from `localStorage` key `clotho:variants`.

- [x] **Step 1: Extend the item type and image-source helpers.**

```ts
export type WardrobeItem = {
  id: string;
  category: Category;
  name: string;
  color: string;
  style: string;
  sourceGrid: string;
  file: string;
  variantOf?: string;
  variantColor?: string;
  imageSrc?: string;
};
```

For `imagePath` and `cleanImagePath`, return `item.imageSrc ??` the current manifest path.

- [x] **Step 2: Add a small validated local-storage reader.**

Accept only arrays whose entries contain string `id`, `category`, `name`, `color`, `style`, `sourceGrid`, `file`, `variantOf`, `variantColor`, and `imageSrc`; discard malformed entries. Catch JSON and storage errors and return `[]`.

- [x] **Step 3: Hydrate manifest items with saved variants.**

In the existing manifest fetch success handler, read variants and call:

```ts
setItems([...manifest.items, ...readSavedVariants()]);
```

Keep the current status message but report the combined item count.

- [x] **Step 4: Persist only variant records after the catalog is loaded.**

Add `items` to the existing hydrated persistence effect and guard with `if (!hydrated || !items.length) return;`. Store:

```ts
localStorage.setItem(
  'clotho:variants',
  JSON.stringify(items.filter((item) => item.variantOf && item.variantColor && item.imageSrc)),
);
```

- [x] **Step 5: Run the existing engine check.**

Run: `npm run check:engine`

Expected: PASS; the base manifest still produces deterministic outfits and unique batches.

### Task 2: Save recolor previews through an explicit Recolor decision

**Files:**
- Modify: `app/page.tsx:136-141,374-394,1037-1050`

**Interfaces:**
- `saveRecolorVariant()` consumes `recolorPreview` and appends one `WardrobeItem` to `items`.
- Duplicate base-item/color saves reuse the existing variant instead of adding an identical record.
- The rendered Recolor panel exposes a button named `Save as wardrobe variant →` only when a preview exists.

- [x] **Step 1: Implement duplicate-safe variant creation.**

Use the normalized base ID (`recolorPreview.item.variantOf ?? recolorPreview.item.id`) and uppercase six-digit color. If an existing item has the same `variantOf` and `variantColor`, select it and report that it already exists. Otherwise create:

```ts
{
  id: `${baseId}--${color.slice(1).toLowerCase()}`,
  category: source.category,
  name: `${source.name} · ${color}`,
  color,
  style: `${source.style} · recolored`,
  sourceGrid: source.sourceGrid,
  file: source.file,
  variantOf: baseId,
  variantColor: color,
  imageSrc: recolorPreview.src,
}
```

Catch `localStorage` quota errors in the persistence effect and set a visible status explaining that the preview remains available but could not be saved.

- [x] **Step 2: Append the variant and keep it selected.**

Call `setItems((current) => [...current, variant])`, set `recolorItemId(variant.id)`, and leave the Recolor panel open. Do not overwrite the base item or auto-save from `applyRecolor`.

- [x] **Step 3: Add the explicit save control and saved-state copy.**

Place the control beside the existing preview action. Disable it while recoloring or when there is no preview. Add a short note: “Preview first. Save this color as a wardrobe variant when you want it in future looks.”

- [x] **Step 4: Run the production build.**

Run: `npm run build`

Expected: PASS with no TypeScript or bundling errors.

### Task 3: Verify participation across recommendation surfaces

**Files:**
- Modify: `scripts/check-outfit.mjs:1-35`

**Interfaces:**
- The test creates an in-memory recolored variant with `imageSrc`, passes the combined catalog to `buildOutfit` and `buildOutfitBatch`, and verifies the variant ID can be selected.

- [x] **Step 1: Add a minimal variant participation assertion.**

Append a variant derived from the first top and assert that a custom outfit built with the variant ID returns that variant in `items`. Also assert a batch call accepts the combined catalog and returns the requested unique count.

- [x] **Step 2: Run all existing checks.**

Run: `npm run check:engine && npm run check:calendar && npm run check:weather && npm run check:week && npm run build`

Expected: every command passes.

- [x] **Step 3: Inspect the working diff.**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only the planned app, engine, check, and plan files are changed.
