# Sim2Real

Static SaaS marketing site and app shell for **Sim2Real**, built for **Developer312**, a subsidiary of **NIGHT LITE USA LLC**.

## What’s in this repo

- Marketing pages: `index.html`, `product.html`, `pricing.html`, `contact.html`
- Legal pages: `terms.html`, `privacy.html`
- Auth/account shell: `signup.html`, `login.html`, `forgot-password.html`, `reset-password.html`, `billing.html`
- Deployment assets: `robots.txt`, `sitemap.xml`, `404.html`, `site.webmanifest`
- Brand assets: `assets/og-image.svg`, `assets/favicon.svg`
- Shared UI: `css/style.css`, `js/app.js`
- Smoke verification: `scripts/site-smoke.js`

## Current state

This repo is intentionally **static-first**.

The site is now complete from a front-end perspective and includes a lightweight built-in Node backend:

- Enterprise-ready product and pricing copy
- Legal and billing disclosures
- Contact submission API
- Signup, login, session, and account APIs
- Password reset request API
- Password reset completion API
- Logout/session invalidation
- Theme toggle and mobile navigation
- Social preview and installable-site metadata
- Crawl assets for deployment

The following are still placeholder-backed or partially wired:

- Password reset email delivery
- Stripe live secret and price configuration
- customer-to-Stripe mapping for billing portal sessions

## Verify

Run:

```bash
npm run test
npm run smoke
```

Expected outputs:

```text
PASS GET / serves the homepage
PASS POST /api/contact stores a submission
PASS signup, login, and account endpoints work together
PASS forgot password stores a reset token for existing users
PASS reset password updates stored credentials
PASS logout clears the active session
Sim2Real smoke test passed.
```

## Run locally

Start the local server:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:3000
```

Optional environment variables are documented in [.env.example](./.env.example).

## Deploy

This can now be deployed as a small Node app or adapted to a serverless/static split.

Current backend entry point:

- `server.js`

## Phase 2

Backend integration work is outlined in [PHASE2-INTEGRATION.md](./PHASE2-INTEGRATION.md).

That phase should wire:

- Stripe Checkout
- Stripe billing portal
- password reset delivery
- success/cancel redirect flows
