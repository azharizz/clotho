<p align="center">
  <img src="https://raw.githubusercontent.com/azharizz/clotho/main/docs/assets/clotho-readme-banner.png" alt="CLOTHO: Classy Looks for Occasion, Taste, History &amp; Outfits" width="100%">
</p>

<div align="center">
  <strong>CLOTHO: Classy Looks for Occasion, Taste, History &amp; Outfits</strong><br>
  One wardrobe. A changing week. One decision system.<br>
  <a href="https://clotho.azharizzannada.chatgpt.site/">Open the live product</a> ·
  <a href="https://github.com/azharizz/clotho/blob/main/README.md">Read the repository</a> ·
  <a href="https://github.com/azharizz/clotho/blob/main/docs/assets/clotho-readme-banner.svg">Banner SVG source</a> ·
  <a href="https://webmcp.devpost.com/">WebMCP hackathon</a>
</div>

# CLOTHO: Classy Looks for Occasion, Taste, History &amp; Outfits

## The short version

CLOTHO (Classy Looks for Occasion, Taste, History &amp; Outfits) turns an owned wardrobe into a local-first, agent-ready decision system.
An agent can search, constrain, plan, recolor, schedule, remember, import, and
export. The person can inspect every result and decide what becomes durable.

The important distinction is simple: the agent proposes; the person decides.

## The problem

Wardrobe apps usually stop at inventory or inspiration. They do not coordinate
the real constraints of getting dressed for a week: what is already owned, what
is on the calendar, what the weather will do, which colors feel right, and what
was worn recently.

That coordination is where an agent is useful—but a chat response is not enough.
The agent needs bounded operations against the real product, visible results,
and a human decision boundary before changing durable state.

## What we built

| CLOTHO capability | What the demo shows | Why it matters |
| --- | --- | --- |
| Today | A composed look from actual catalog images for an occasion, date, time, palette, or constraint. | Start from what the person owns, not a generic generated image. |
| Batch | Up to 30 distinct candidates with scores, constraints, and a visible **Use look** action. | Compare a set of real options instead of accepting a roulette-wheel answer. |
| Week plan | Five- or seven-day proposals across morning, day, and evening. | Turn one request into a reviewable plan with tradeoffs. |
| Calendar | Apply, edit, inspect, and remove plans by date and daypart. | A proposed week becomes durable only through an explicit product action. |
| Recolor | A browser-canvas preview with a separate save-as-variant action. | Explore a color decision without silently mutating the wardrobe. |
| Import and export | Review a public HTTPS 2×2 wardrobe grid or export an 800×1200 SVG reference. | Keep handoffs inspectable and bounded at the product edge. |

The live app uses a synthetic 44-piece catalog: 11 tops, 11 bottoms, 11 shoes,
and 11 headwear pieces. It composes those images into outfit silhouettes; it
does not claim to generate a person wearing a new outfit.

## Product walkthrough

This is a capture of the real deployed UI, not a mocked dashboard. It follows
the path a judge can repeat: see today's look, inspect the wardrobe, ask for a
bounded batch, plan a week, inspect the calendar, and preview a recolor.

<p align="center">
  <img src="https://raw.githubusercontent.com/azharizz/clotho/main/docs/assets/clotho-product-walkthrough.gif" alt="CLOTHO live walkthrough: Today, Wardrobe, Batch, Week plan, Calendar, and Recolor" width="100%">
</p>

| 01 / Today | 02 / Wardrobe | 03 / Batch |
| --- | --- | --- |
| Existing pieces become one visible silhouette. | The owned catalog stays searchable and inspectable. | Candidate generation is bounded, scored, and selectable. |

| 04 / Week plan | 05 / Calendar | 06 / Recolor |
| --- | --- | --- |
| Three strategies expose reasons, conflicts, and tradeoffs. | The chosen plan becomes visible date/slot state. | Preview and persistence remain separate decisions. |

## Why WebMCP is the right interface

Outfit planning is a chain of structured actions across the same state—not one
answer. WebMCP lets an agent read context, call bounded operations, inspect the
result, and hand the decision back to the person inside the product.

| Without a product tool boundary | With CLOTHO's WebMCP surface |
| --- | --- |
| “Wear something for the week” becomes a paragraph the person must manually reconstruct. | `plan_outfit_week` returns named strategies for the actual calendar, taste, weather, and dayparts. |
| The agent describes an outfit that may not exist in the wardrobe. | `suggest_outfit` and `generate_outfit_batch` operate on real catalog IDs and return visible compositions. |
| “Schedule it” is ambiguous and easy to apply too early. | The person reviews the proposal, then explicitly calls `apply_week_plan`. |
| Recolor and import are opaque AI steps. | `recolor_item` previews; `import_image_url` previews crops; separate actions persist either result. |

The result is a better division of labor: the agent handles multi-step
coordination, while the person supplies taste, correction, approval, and the
final “this is what I will wear” decision.

## What people and agents can do together

An agent can handle the tedious coordination in one turn:

> Plan seven days, use morning/day/evening, avoid repeats, respect my palette,
> and account for the weather.

CLOTHO returns `Repeat-light`, `Color study`, and `Weather-first` options with
reasons, conflicts, and tradeoffs. The person can then inspect a look, choose
one option, apply it, edit a slot, recolor a piece, record what was worn, or
remove the plan later. The agent never receives a silent “decide everything”
shortcut.

## WebMCP implementation

The page registers 14 tools with the browser's WebMCP surface. They are grouped
by the job they perform in the product:

| Job | Registered tools | Boundary |
| --- | --- | --- |
| Find and propose | `search_products` · `suggest_outfit` · `generate_outfit_batch` | Read/propose against the visible catalog; batches are capped at 1–30. |
| Read and plan | `list_calendar_plans` · `set_preferences` · `plan_outfit_week` | Calendar, cached NYC weather, taste, history, dayparts, and constraints become structured inputs. |
| Commit and edit | `apply_week_plan` · `schedule_outfit` · `remove_calendar_plan` | Writes are visible, date/slot scoped, and reversible. |
| Wear and remember | `record_wear` | Records the visible look and accepted inline variants locally. |
| Import safely | `import_image_url` · `commit_wardrobe_items` | Preview first; commit only reviewed crops from a public HTTPS 2×2 grid. |
| Transform and export | `recolor_item` · `export_outfit_reference` | Recolor is a 512px canvas preview; export is a catalog-only static SVG URL. |

The recommendation engine is deterministic for the same state and seed. It
validates required/excluded item IDs and scores occasion fit, color
compatibility, taste terms, recent wear, and weather conflicts.

## Architecture: the real production path

The infrastructure is intentionally small and honest. A browser loads the
managed `chatgpt.site` deployment, the React/Vinext app runs the deterministic
engine and WebMCP registration, browser storage holds the user's state, and
Open-Meteo supplies cached NYC weather. The optional image bridge reads a
public temporary grid URL; CLOTHO does not upload wardrobe data to TmpFiles.

<p align="center">
  <img src="https://raw.githubusercontent.com/azharizz/clotho/main/public/assets/diagrams/clotho-production-architecture.gif" alt="CLOTHO production architecture: browser, managed chatgpt.site app, local state, Open-Meteo, and optional image bridge" width="100%">
</p>

<p align="center"><a href="https://github.com/azharizz/clotho/blob/main/public/assets/diagrams/clotho-production-architecture.drawio">Open the editable production architecture in Draw.io →</a></p>

## Architecture: the WebMCP human loop

The judging-critical boundary is visible in this diagram: proposal tools return
options and reasons, the person reviews them, and only an explicit product
action changes local calendar state.

<p align="center">
  <img src="https://raw.githubusercontent.com/azharizz/clotho/main/public/assets/diagrams/clotho-webmcp-human-loop.gif" alt="CLOTHO WebMCP human loop: request, orchestrate, propose, review, explicitly write, and keep editing" width="100%">
</p>

<p align="center"><a href="https://github.com/azharizz/clotho/blob/main/public/assets/diagrams/clotho-webmcp-human-loop.drawio">Open the editable WebMCP human-loop diagram in Draw.io →</a></p>

## Honest limits

- The catalog is synthetic and contains 44 pieces.
- CLOTHO composes item images; it does not generate a person wearing a new outfit.
- A batch returns up to 30 distinct looks, not all 15,972 theoretical combinations.
- Weather is cached NYC weather from Open-Meteo, not arbitrary location intelligence.
- Image import requires a clean public HTTPS 2×2 grid and exact crop metadata.
- Static export supports bundled catalog pieces, not browser-local imports or recolored variants.
- Preferences, plans, history, imports, and recolored variants live in this browser's `localStorage`.

## Try it

- **Live app:** <https://clotho.azharizzannada.chatgpt.site/>
- **Repository README:** [CLOTHO README](https://github.com/azharizz/clotho/blob/main/README.md)
- **Hackathon:** <https://webmcp.devpost.com/>

Suggested judge path: open **Week plan**, request seven days and all three
dayparts, review the three strategies, apply one, inspect **Calendar**, then
try **Recolor** and **Batch**. The live site exposes the same product states and
WebMCP boundaries described here.

## Built with

React 19 · TypeScript · Vinext/Vite · browser WebMCP · deterministic TypeScript
outfit engine · Open-Meteo · browser `localStorage` · browser canvas

## Source and license

Source code is licensed under Apache-2.0. Wardrobe images are synthetic test
assets. See the repository [LICENSE](https://github.com/azharizz/clotho/blob/main/LICENSE).
