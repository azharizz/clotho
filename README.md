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
- Browser-canvas recoloring that reuses the same item in the wardrobe and outfit view.
- WebMCP tools for searching, suggesting, scheduling, listing/removing, recording, preferring, batching, weekly planning, applying plans, and recoloring.

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

The bundled catalog is a small synthetic test wardrobe: 44 items represented by 2×2 catalog grids and transparent WebP derivatives. No personal wardrobe data is included. Preferences, plans, and wear history stay in `localStorage`; the weather response is cached in the same browser.

The source code is licensed under Apache-2.0. CLOTHO branding and generated image provenance should be reviewed before reuse in another product.
