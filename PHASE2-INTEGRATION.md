# Sim2Real Phase 2 Integration

This document maps the current static placeholders to the backend work needed to make the app shell live.

## Already wired

The following pieces are now implemented in the lightweight Node backend:

- static page serving through `server.js`
- `POST /api/contact`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/logout`
- `GET /api/account`

What remains is the production-grade integration layer around email delivery, Stripe, and deeper account handling.

## Environment

Use `.env.example` as the starting point for local or hosted configuration.

Current variables:

- `PORT`
- `SESSION_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID_PILOT`

## Contact form

Current state:

- `contact.html` now posts to `/api/contact`
- submissions are stored locally in `.data/contacts.json`

Production hardening still needed:

- delivery target such as email, CRM, or database
- spam protection and validation

Suggested contract:

```http
POST /api/contact
Content-Type: application/json
```

```json
{
  "name": "Jane Doe",
  "email": "jane@company.com",
  "company": "Example Robotics",
  "topic": "Book a demo",
  "message": "We are evaluating sim-to-real tooling for pilot rollout."
}
```

## Auth

Current state:

- account creation and login APIs are live
- sessions are cookie-based
- forgot-password requests generate local reset tokens
- reset-password updates stored credentials
- logout clears server-side sessions
- `billing.html` hydrates from `/api/account` when a user is signed in

Backend needed next:

- password reset email delivery
- stronger protected-account/session behavior for production

Suggested routes:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/account`

## Stripe

Current state:

- pricing buttons now call `/api/billing/checkout`
- billing portal button now calls `/api/billing/portal`
- checkout works once Stripe secret and pilot price env vars are added
- portal works once Stripe secret is present and the request includes a real `customerId`

Backend needed:

- create Checkout Session
- create Billing Portal Session
- persist or derive real Stripe customer IDs for signed-in users

Suggested routes:

- `POST /api/billing/checkout`
- `POST /api/billing/portal`

Suggested checkout request:

```json
{
  "plan": "pilot"
}
```

Suggested portal request:

```json
{
  "customerId": "cus_123"
}
```

## Front-end wiring points

Update `billing.html` and related views to fetch authenticated account data and render live customer state instead of static placeholders.

## Success criteria

Phase 2 is complete when:

- contact submissions are delivered
- account creation and login work end to end
- password reset emails can be triggered
- pricing checkout buttons open real Stripe Checkout
- billing page opens the real Stripe customer portal
- billing page hydrates from `/api/account`
- smoke verification is extended to include any new success/cancel pages
