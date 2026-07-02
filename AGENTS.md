# Repository Guidelines

## Project Structure & Module Organization

This is a static, dependency-free emergency response app:

- `index.html` contains the frontend markup.
- `css/app.css` holds the design system (Stripe-style tokens, self-hosted Inter).
- `js/app.js` holds the vanilla JavaScript UI logic.
- `services/api.js` is the single frontend data service for Supabase (PostgREST reads + edge function writes). It keeps the historical `window.SheetsService` interface.
- The backend lives in Supabase project `zryfwbjvlacorryzdaod`: SQL schema with closed RLS, public views/RPCs for reads, and the `api` edge function for writes.
- `locales/` contains UI translations (es/en/fr).
- `manifest.json` and `sw.js` implement the PWA (static assets only; data is never cached).
- `vercel.json` defines security headers and CSP.
- `robots.txt` and `sitemap.xml` are root SEO files.

There is no `package.json`, bundler, framework, CDN, or build step. Do not add one unless direction changes.

## Build, Test, and Development Commands

- Open locally over HTTP: `python3 -m http.server 8000`, then visit `http://127.0.0.1:8000/`.
- Check reads: `curl -s -H "apikey: <PUBLISHABLE_KEY>" "https://zryfwbjvlacorryzdaod.supabase.co/rest/v1/lugares_directorio?select=nombre&limit=1"` should return JSON.
- Deploy: push to the production branch connected to Vercel. Vercel serves the static files with no build. Backend changes go through Supabase SQL migrations and redeploys of the `api` edge function.

## Coding Style & Naming Conventions

Use 2-space indentation in HTML, CSS, and JavaScript. Keep UI copy in Spanish (translated via `locales/`).

All external or database-derived values rendered through template literals and `innerHTML` must pass through `escaparHTML` / `e()`.

Form field IDs for the Agregar tab use the `ag-` prefix to avoid collisions with filters. When changing static assets, bump the `?v=` version in `index.html` and `sw.js` (and the SW cache name).

## Testing Guidelines

There is no automated test runner or coverage target. Verify manually in a browser at mobile and desktop widths. Test tab switching, filters, donation matching, family search, token tracking, add form submission, driver routes, contributions, and the per-center panel (create, token+PIN sign-in, supply edit).

## Security & Configuration Tips

Never hardcode private keys in the frontend; only the Supabase **publishable** key belongs in `js/app.js` (it is public by design; RLS keeps tables closed). Writes must stay behind the `api` edge function (validation + IP rate-limit). Public invoice tokens may appear in URLs but must not expose donor references, phones, emails, coordinates, internal centers, deposits, bank details, or operational data. Center-panel PINs are stored only as SHA-256(salt+pin). If an external endpoint is added, update `vercel.json` CSP.
