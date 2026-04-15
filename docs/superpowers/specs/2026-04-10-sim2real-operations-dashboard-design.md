# Sim2Real Operations Dashboard Design

Date: 2026-04-10
Status: Drafted from approved design discussion
Product brief: `Sim2RealPrompt.txt`

## Goal

Evolve the authenticated `billing.html` experience into a credible Sim2Real operations workspace that reflects the original product brief: a signed-in dashboard with deployment telemetry, failure trends, simulation recommendations, account settings, and billing controls.

This phase should go beyond a read-only billing shell while remaining local-first and lightweight. Signed-in users should be able to view realistic seeded operational data, create notes, acknowledge recommendations, change lightweight deployment statuses, update account details, and change their password. These actions should survive refresh through local persistence.

## Product framing

The prompt positions Sim2Real as a simulation-to-real transfer platform for robotics teams and explicitly calls for:

- a `Billing / Account overview`
- a site that can scale into a SaaS dashboard after login
- dashboard and deployment insights as part of the product value

Because of that, the authenticated area should not remain a billing-only page. Billing and account management should become supporting capabilities inside a broader operations workspace.

## Recommended approach

Use the current `billing.html` route as the authenticated workspace entry and expand it into a multi-panel operations dashboard.

This approach is preferred over introducing a separate `dashboard.html` because it:

- keeps the current signed-in routing simple
- preserves momentum in the existing app shell
- avoids splitting account state across multiple authenticated surfaces
- still allows clear separation between operations, account, and billing inside one page

## Architecture

### Frontend structure

Keep `billing.html` as the signed-in entry point, but reposition it as the main Sim2Real workspace.

The page should render the following first-class sections:

1. Workspace header
2. Operations overview
3. Deployment telemetry
4. Failure trends
5. Simulation recommendations
6. Operator notes
7. Account settings
8. Billing and invoices

The page should remain server-agnostic HTML with progressive enhancement from `js/app.js`.

### Backend structure

Extend the existing lightweight Node server and local JSON store rather than introducing a new backend layer.

The server should:

- continue to use cookie-based sessions
- return a richer authenticated dashboard payload from `GET /api/account`
- persist user-specific dashboard actions in local data files
- continue to support Stripe-related endpoints for billing actions

## Dashboard information architecture

### 1. Workspace header

Purpose:
- establish this as the signed-in Sim2Real workspace
- show current account context at a glance
- provide fast access to high-value actions

Content:
- workspace title
- signed-in user name and company
- current plan
- subscription status
- deployment health summary
- quick actions:
  - Manage subscription
  - Contact support
  - Log out

### 2. Operations overview

Purpose:
- provide a fast, executive-level snapshot of robotics deployment health

Content:
- KPI cards for:
  - active robots
  - transfer success rate
  - open failure clusters
  - recommended simulation updates

Notes:
- values should be seeded server-side
- values should be plausible and product-specific rather than generic SaaS analytics

### 3. Deployment telemetry

Purpose:
- show current deployment activity across robots, sites, and tasks

Content per row/card:
- robot name
- site
- task
- simulator confidence
- real-world success rate
- drift score
- current status

Allowed lightweight interactions:
- update status to values such as:
  - Monitoring
  - Needs review
  - Retraining queued
  - Stable

Persistence:
- status changes persist per signed-in user

### 4. Failure trends

Purpose:
- make common sim-to-real mismatch categories visible

Content:
- top recurring breakdowns such as:
  - lighting variance
  - object tilt
  - grip slip
  - clutter occlusion
  - contact mismatch
- counts or frequency indicators
- severity framing
- short operational interpretation

Notes:
- this panel is seeded, not user-authored
- the emphasis is product credibility, not exhaustive analytics

### 5. Simulation recommendations

Purpose:
- connect observed failure patterns to simulator changes and retraining actions

Content per recommendation:
- recommendation title
- linked failure theme
- proposed simulator or training adjustment
- expected impact
- confidence level
- acknowledgement state

Interactions:
- users can acknowledge recommendations
- acknowledged state persists per signed-in user

### 6. Operator notes

Purpose:
- give the dashboard a practical collaboration and handoff surface

Content:
- chronological note stream
- note author identity from signed-in user
- created timestamp

Interactions:
- add a new note
- newly added notes appear immediately
- notes persist across refresh

Scope:
- per-user local persistence only
- no real-time collaboration
- no threaded discussions in this phase

### 7. Account settings

Purpose:
- move account administration into the workspace instead of splitting it into separate flows

Content:
- name
- email
- company
- Stripe customer ID when available

Interactions:
- update profile fields inline
- change password inline

Behavior:
- actions should complete without leaving the page
- responses should use contained inline success and error states

### 8. Billing and invoices

Purpose:
- keep billing operationally accessible while no longer making it the center of the signed-in experience

Content:
- current plan
- billing interval
- billing status
- invoice history placeholders or seeded history
- payment method placeholder

Actions:
- Manage subscription via Stripe portal
- Change plan via pricing route
- Contact support

## API design

### Expanded read endpoint

`GET /api/account`

Returns:

```json
{
  "user": {},
  "subscription": {},
  "workspaceMetrics": {},
  "deployments": [],
  "failureTrends": [],
  "recommendations": [],
  "notes": [],
  "invoices": []
}
```

Behavior:
- requires authentication
- returns a combined dashboard payload
- seeded dashboard content should be deterministic per user so the experience feels stable across reloads

### Write endpoints

#### `POST /api/account/profile`

Purpose:
- update name and company details

Expected body:

```json
{
  "name": "Jane Doe",
  "company": "Example Robotics"
}
```

#### `POST /api/account/password`

Purpose:
- update the signed-in user's password

Expected body:

```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password"
}
```

#### `POST /api/dashboard/notes`

Purpose:
- create a new operator note

Expected body:

```json
{
  "message": "Warehouse West grip slip increased after tote change."
}
```

#### `POST /api/dashboard/recommendations/:id/acknowledge`

Purpose:
- mark a recommendation as acknowledged for the current user

Expected body:

```json
{}
```

#### `POST /api/dashboard/deployments/:id/status`

Purpose:
- persist a lightweight status override for a deployment item

Expected body:

```json
{
  "status": "Needs review"
}
```

## Persistence model

Use lightweight local JSON persistence under the existing `.data` store.

Suggested logical records:

- `users.json`
- `sessions.json`
- `contacts.json`
- `reset-tokens.json`
- `dashboard-notes.json`
- `dashboard-recommendations.json`
- `dashboard-deployment-statuses.json`

Persistence rules:

- notes are stored per user
- recommendation acknowledgements are stored per user and recommendation id
- deployment statuses are stored per user and deployment id
- seeded base dashboard content is derived server-side, then overlaid with persisted user actions

## Interaction behavior

### Authentication behavior

If the user is not authenticated:

- `billing.html` should stop presenting seeded live-looking account data as if the user is signed in
- the page should redirect to `login.html` or render a clear authentication-required state

Recommended implementation:
- redirect unauthenticated users to `login.html`
- preserve a professional fallback state if the fetch fails unexpectedly

### Inline actions

Profile edits:
- submit inline
- return contained confirmation text
- keep the user on the dashboard

Password changes:
- submit inline
- validate current password
- clear sensitive fields after success

Notes:
- append to the visible note list on success
- clear the form after success

Recommendation acknowledgements:
- disable or restyle the action after success
- persist on refresh

Deployment status changes:
- update visible state after success
- persist on refresh

### Error handling

The dashboard should degrade by panel rather than fail as a whole page.

Rules:

- if a panel fails to load, show a contained inline error in that panel
- if a write fails, preserve current visible state and show a short actionable error
- avoid browser alert boxes for normal in-app form and dashboard actions
- keep messages operational and specific

## Visual direction

The existing site already follows a Swiss-inspired, compact SaaS aesthetic. The dashboard should continue that language while becoming more app-like.

Desired characteristics:

- compact, credible layout
- clear panel structure
- restrained accent usage
- neutral surfaces
- density appropriate for a working robotics operations console
- mobile-safe stacked layouts

Avoid:

- oversized marketing-style hero treatment inside the signed-in area
- gimmicky AI visuals
- generic CRM-style dashboards unrelated to robotics operations

## Verification strategy

### Backend tests

Extend `tests/server.test.js` to cover:

- expanded `GET /api/account` payload shape
- authenticated profile update
- authenticated password change
- note creation and persistence
- recommendation acknowledgement persistence
- deployment status persistence

### Smoke coverage

Extend `scripts/site-smoke.js` only where useful to validate:

- key dashboard copy
- presence of account settings and notes sections
- absence of obviously stale billing-only framing

### Scope guard

This phase does not include:

- real telemetry ingestion
- websockets
- collaborative multi-user notes
- real production database wiring
- live simulator execution
- advanced authorization roles

The goal is a realistic, local-first product shell with real signed-in behavior.

## Implementation notes

Implementation should preserve the current lightweight stack:

- static HTML
- shared CSS
- vanilla JavaScript
- Node HTTP server
- local JSON persistence

The dashboard should feel like a natural continuation of the Sim2Real site, not a separate prototype.
