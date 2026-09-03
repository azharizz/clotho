# Deterministic Fit Scoring Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (required for inline execution). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make recolored and catalog items use richer deterministic color harmony and explicit occasion attributes instead of relying primarily on one keyword match.

**Architecture:** Keep the existing pure TypeScript outfit engine and WebMCP call paths. Add a small color-profile parser that treats recolor hex values as ground truth and a compact formality/activity profile on catalog items. Require the current occasion profile for scoring and migrate older saved variants from their base item instead of retaining keyword scoring.

**Tech Stack:** TypeScript, JSON manifest, existing Node assert check; no new dependency and no runtime network/AI call.

**Spec:** Current-thread request to implement the deterministic color upgrade and occasion scoring upgrade.

## Global Constraints

- Keep WebMCP tool signatures unchanged.
- Recolored variants must inherit occasion metadata from their base item.
- Do not inspect or download images during scoring.
- Do not add a dependency or commit changes.

### Task 1: Upgrade deterministic color profiling

**Files:**
- Modify: `lib/outfit-engine.ts`
- Test: `scripts/check-outfit.mjs`

**Interfaces:**
- `analyzeColor(color)` returns a deterministic profile for named, hex, and multi-color values.
- `colorCompatibility(left, right)` returns a bounded pair-harmony score consumed by `scoreItem`.

- [x] Add named-color profiles, hex RGB parsing, multi-color aggregation, and hue/lightness/chroma compatibility while retaining a small `colorFamily` wrapper for tone text.
- [x] Replace the old family-only palette and pair rules with the profile-based rules.
- [x] Add assertions that multi-color metadata is not classified solely by its first neutral word and that recolor hex variants remain scoreable.

### Task 2: Upgrade deterministic occasion fit

**Files:**
- Modify: `lib/outfit-engine.ts`
- Modify: `public/items/manifest.json`
- Modify: `app/page.tsx`
- Test: `scripts/check-outfit.mjs`

**Interfaces:**
- `WardrobeItem.occasionProfile` stores `formality`, `activity`, and optional occasion tags.
- `occasionFit(item, occasion)` returns an explainable numeric fit and rejects records without the current profile.

- [x] Add compact occasion profiles to all catalog items and copy them into recolored variants.
- [x] Score metadata distance and explicit occasion tags with no keyword fallback; migrate older variants to their base profile during hydration.
- [x] Assert work/casual and event/casual item distinctions, then run engine, lint, typecheck, build, and diff checks.
