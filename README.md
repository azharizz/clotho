# CLOTHO

**Classy Looks for Occasion, Taste, History & Outfits**

CLOTHO is a local-first wardrobe planner that lets a person and an agent build, compare, and schedule outfits together. It composes existing catalog images in the browser; it does not generate a new outfit image at runtime.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. WebMCP is available when the site is opened in ChatGPT's in-app browser or in Chrome with WebMCP testing enabled.

## What is included

- Deterministic combinations of tops, bottoms, shoes, and optional headwear.
- Seven-column calendar with up to morning, day, and evening moments per date.
- Cached New York City weather from Open-Meteo.
- Wear history, taste preferences, free-form taste notes, and local browser persistence.
- Batch outfit generation and review-first weekly planning with conflict/trade-off explanations.
- Browser-canvas recoloring in the Recolor lab and Occasion lens; inline previews are accepted into persistent wardrobe variants when a wear is recorded.
- WebMCP tools for searching, suggesting, scheduling, listing/removing, recording, preferring, batching, weekly planning, applying plans, recoloring, importing a client-provided HTTPS image URL, and saving a reviewed wardrobe grid.

## Temporary URL import

The image-import panel starts with a generic image URL field for the client bridge. The agent first turns an outfit photo into a clean 2×2 catalog grid, uploads that grid to temporary hosting, then passes its HTTPS URL to `import_image_url`. CLOTHO's same-origin bridge resolves the temporary upload page and reads the image so browser canvas cropping remains possible. CLOTHO does not upload the client's image itself.

```text
agent creates 2×2 catalog grid + one metadata record per crop → temporary HTTPS URL
→ import_image_url({ imageUrl, includeHeadwear, items, autoAccept })
→ fetch/crop the grid → preview or immediate local save
```

This path is for synthetic or non-sensitive feasibility images only. Temporary hosting is public third-party storage; the link expires, and only confirmed crop previews are persisted locally.

## Checks

```bash
npm run check:engine
npm run check:calendar
npm run check:weather
npm run check:week
npm run lint
npm run build
```

## Data and assets

The bundled catalog is a small synthetic test wardrobe: 44 items represented by 2×2 catalog grids and transparent WebP derivatives. No personal wardrobe data is included. Preferences, plans, wear history, and saved recolor variants stay in `localStorage`; the weather response is cached in the same browser.

The source code is licensed under Apache-2.0. CLOTHO branding and generated image provenance should be reviewed before reuse in another product.
