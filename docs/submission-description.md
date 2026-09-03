# CLOTHO — WebMCP Hackathon Submission Description

## One-line summary

CLOTHO turns an owned wardrobe into a local-first, agent-ready decision system: an agent can search, constrain, plan, recolor, schedule, remember, import, and export—while consequential writes remain explicitly reviewable.

## The problem

Most wardrobe apps either show inventory or generate inspiration. They do not coordinate the real constraints of getting dressed for a week: what is already owned, what is on the calendar, what the weather will do, which colors feel right, and what was worn recently.

That coordination is exactly where an agent can help, but a chat response alone is not enough. The agent needs bounded operations that act on the real product, return inspectable results, and stop at a human decision boundary before changing durable state.

## What we built

CLOTHO is a browser-local wardrobe planner built around a synthetic 44-piece catalog: 11 tops, 11 bottoms, 11 shoes, and 11 headwear pieces. It composes those existing images into visible outfit silhouettes and offers:

- single-look suggestions for an occasion, date, time, palette, or constraint;
- a batch of 1–30 actual distinct outfit combinations with scores;
- five- or seven-day planning across morning, day, and evening;
- two or three weekly strategies with reasons, conflicts, and tradeoffs;
- a calendar that can be applied, edited, or cleared by date and moment;
- taste preferences, recent-wear history, and browser-local persistence;
- a browser-canvas recolor preview with an explicit save-as-variant action;
- reviewed import of a public HTTPS 2×2 wardrobe grid; and
- a catalog-only 800×1200 SVG outfit reference export.

## Why this is a strong fit for WebMCP

Wardrobe planning is not one answer. It is a chain of structured actions across the same product state. WebMCP lets an agent work through that chain without pretending that a screenshot is an API:

1. read calendar plans and visible context;
2. search the owned catalog and apply explicit constraints;
3. request a single look, a bounded batch, or a full-week plan;
4. return real CLOTHO results with scores, reasons, conflicts, and tradeoffs;
5. wait for the person's review; and
6. apply, edit, recolor, record, import, or export only through explicit product operations.

The experience is better because the person no longer has to manually carry the same context across several panels, yet the agent is not granted an invisible “decide everything” shortcut.

## What people and agents can now do together

The agent can do the coordination that is tedious to repeat: “plan seven days, use all three dayparts, avoid repeats, respect my palette, and account for the weather.” CLOTHO can produce `Repeat-light`, `Color study`, and `Weather-first` options and show why a shoe or layer is a tradeoff.

The person can inspect the actual option, select one, keep an unrelated calendar plan, edit a slot, preview a recolor, decide whether to save it, record what was worn, and remove a plan later. The agent proposes; the person decides.

## How WebMCP is implemented

The page registers 14 tools with the browser's WebMCP surface:

| Workflow | Tools | Implementation boundary |
| --- | --- | --- |
| Discover and propose | `search_products`, `suggest_outfit`, `generate_outfit_batch` | Deterministic, visible proposals against the current catalog; batches are capped at 30. |
| Read context and plan | `list_calendar_plans`, `set_preferences`, `plan_outfit_week` | Calendar, cached NYC weather, taste, history, dayparts, and constraints become structured inputs. |
| Commit and edit | `apply_week_plan`, `schedule_outfit`, `remove_calendar_plan` | Writes are visible and reversible at the calendar date/slot level. |
| Wear and remember | `record_wear` | Records the current visible look and accepted inline recolor variants locally. |
| Import safely | `import_image_url`, `commit_wardrobe_items` | Import returns a reviewable crop result; commit is a separate persistence step. |
| Transform and export | `recolor_item`, `export_outfit_reference` | Recolor is a 512px browser preview; export is a catalog-only static SVG URL. |

The product deliberately keeps state in the browser: preferences, plans, history, imported pieces, and recolored variants use `localStorage`; weather is cached locally. The recommendation engine is deterministic for the same state and seed, validates required/excluded item IDs, and scores occasion fit, color compatibility, taste terms, recent wear, and weather conflicts.

## Infrastructure and WebMCP proof

The diagrams below document the deployed system and the browser interaction boundary. They are editable Draw.io sources, exported as animated visuals so the dashed request paths visibly “march” in the README and demo materials.

<p align="center">
  <img src="../public/assets/diagrams/clotho-production-architecture.gif" alt="CLOTHO production architecture with managed chatgpt.site hosting, browser-local state, Open-Meteo, and optional TmpFiles" width="100%">
</p>

<p align="center"><a href="../public/assets/diagrams/clotho-production-architecture.drawio">Editable production architecture (Draw.io)</a></p>

The production path is intentionally small: a browser loads the managed `chatgpt.site` site, the React/Vinext app runs the deterministic engine and WebMCP registration, and browser `localStorage`/canvas hold the user's plans, preferences, history, imported pieces, and recolored variants. Open-Meteo supplies the cached NYC forecast. `import_image_url` can read a public HTTPS 2×2 grid through the same-origin `/api/tmpfiles-image` bridge; CLOTHO does not upload wardrobe data to TmpFiles. `/outfit-reference` returns a static 800×1200 SVG for bundled catalog IDs.

<p align="center">
  <img src="../public/assets/diagrams/clotho-webmcp-human-loop.gif" alt="CLOTHO WebMCP human loop from person request to explicit calendar write" width="100%">
</p>

<p align="center"><a href="../public/assets/diagrams/clotho-webmcp-human-loop.drawio">Editable WebMCP human loop (Draw.io)</a></p>

The WebMCP view makes the judging-critical boundary explicit: proposal tools return options and reasons; the person reviews conflicts and tradeoffs; only then does an explicit product action such as `apply_week_plan` change local calendar state. There is no hidden CLOTHO API, database, or silent agent write path behind the browser surface.

## Honest limitations

- The catalog is synthetic and contains 44 pieces.
- CLOTHO composes item images; it does not generate a person wearing a new outfit.
- A batch returns up to 30 distinct looks, not all 15,972 theoretical combinations.
- Weather is cached NYC weather from Open-Meteo, not arbitrary location intelligence.
- Image import requires a clean public HTTPS 2×2 grid and exact crop metadata; it does not accept raw ChatGPT attachments or local file paths.
- Static export supports bundled catalog pieces, not browser-local imports or recolored variants.

## Try it

- Live app: <https://clotho.azharizzannada.chatgpt.site/>
- Repository README: [CLOTHO README](../README.md)
- WebMCP hackathon: <https://webmcp.devpost.com/>

Suggested path: open **Week plan**, request seven days and all three dayparts, review the three strategies, apply one, inspect the populated **Calendar**, then try **Recolor** and **Batch**. The live site exposes the same product states described above.

## Built with

React 19 · TypeScript · Vinext/Vite · browser WebMCP · deterministic TypeScript outfit engine · Open-Meteo · browser `localStorage` · browser canvas

## Source and license

Source code is licensed under Apache-2.0. Wardrobe images are synthetic test assets. See the repository [LICENSE](../LICENSE).
