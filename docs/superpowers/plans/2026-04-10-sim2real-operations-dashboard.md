# Sim2Real Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the authenticated Sim2Real account shell into a fuller operations dashboard with deployment telemetry, failure trends, simulation recommendations, operator notes, account settings, and persisted per-user interactions.

**Architecture:** Keep `billing.html` as the authenticated workspace and extend the current Node HTTP server plus local JSON store. Seed deterministic robotics dashboard data on the server, overlay user-specific persisted notes, recommendation acknowledgements, and deployment status changes, and hydrate the UI from a single expanded `GET /api/account` payload.

**Tech Stack:** Static HTML, shared CSS, vanilla JavaScript, Node.js HTTP server, local JSON persistence, executable Node test harness

---

### Task 1: Expand authenticated dashboard API coverage

**Files:**
- Modify: `tests/server.test.js`
- Modify: `server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write the failing tests**

```js
  await run("GET /api/account returns operations dashboard data for signed-in users", async () => {
    const app = await startServer();
    try {
      await fetch(`${app.baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Jane Doe",
          email: "jane@example.com",
          company: "Example Robotics",
          password: "robotics123"
        })
      });

      const loginResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "jane@example.com",
          password: "robotics123"
        })
      });
      const cookie = loginResponse.headers.get("set-cookie");

      const accountResponse = await fetch(`${app.baseUrl}/api/account`, {
        headers: { cookie }
      });
      const body = await accountResponse.json();

      assert.equal(accountResponse.status, 200);
      assert.equal(typeof body.workspaceMetrics.activeRobots, "number");
      assert.ok(Array.isArray(body.deployments));
      assert.ok(Array.isArray(body.failureTrends));
      assert.ok(Array.isArray(body.recommendations));
      assert.ok(Array.isArray(body.notes));
      assert.ok(body.deployments.length > 0);
      assert.ok(body.failureTrends.length > 0);
      assert.ok(body.recommendations.length > 0);
    } finally {
      await app.close();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/server.test.js`
Expected: FAIL because `workspaceMetrics`, `deployments`, `failureTrends`, `recommendations`, and `notes` are not returned yet.

- [ ] **Step 3: Write minimal implementation**

```js
function seededDashboardForUser(user) {
  return {
    workspaceMetrics: {
      activeRobots: 3,
      transferSuccessRate: "94.2%",
      openFailureClusters: 4,
      recommendedUpdates: 3
    },
    deployments: [
      {
        id: "dock-west-bin-picking",
        robotName: "Picker-07",
        site: "Warehouse West",
        task: "Bin picking",
        simConfidence: "91%",
        realWorldSuccessRate: "84%",
        driftScore: "0.31",
        status: "Monitoring"
      }
    ],
    failureTrends: [
      {
        id: "lighting-variance",
        label: "Lighting variance",
        severity: "High",
        count: 18,
        summary: "Observed glare spikes during late-shift picking windows."
      }
    ],
    recommendations: [
      {
        id: "reco-lighting-domain-randomization",
        title: "Increase lighting domain randomization",
        theme: "Lighting variance",
        action: "Expand overhead glare and exposure perturbations in sim scenes.",
        expectedImpact: "Reduce grasp miss rate during low-angle glare events.",
        confidence: "High",
        acknowledged: false
      }
    ]
  };
}
```

```js
      const dashboard = seededDashboardForUser(user);
      return json(response, 200, {
        user: sanitizeUser(user),
        subscription: user.subscription,
        workspaceMetrics: dashboard.workspaceMetrics,
        deployments: dashboard.deployments,
        failureTrends: dashboard.failureTrends,
        recommendations: dashboard.recommendations,
        notes: [],
        invoices: [
          { month: "April 2026", status: "Paid" },
          { month: "March 2026", status: "Paid" },
          { month: "February 2026", status: "Paid" }
        ]
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/server.test.js`
Expected: PASS for the new dashboard payload test.

- [ ] **Step 5: Commit**

```bash
git add tests/server.test.js server.js
git commit -m "feat: add seeded operations dashboard payload"
```

### Task 2: Add persisted notes, recommendation acknowledgements, and deployment statuses

**Files:**
- Modify: `tests/server.test.js`
- Modify: `server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write the failing tests**

```js
  await run("dashboard notes, recommendation acknowledgements, and deployment statuses persist", async () => {
    const app = await startServer();
    try {
      await fetch(`${app.baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Jane Doe",
          email: "jane@example.com",
          company: "Example Robotics",
          password: "robotics123"
        })
      });

      const loginResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "jane@example.com",
          password: "robotics123"
        })
      });
      const cookie = loginResponse.headers.get("set-cookie");

      const noteResponse = await fetch(`${app.baseUrl}/api/dashboard/notes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie
        },
        body: JSON.stringify({
          message: "Queued retraining for Dock West after repeated clutter occlusion."
        })
      });
      assert.equal(noteResponse.status, 201);

      const recommendationResponse = await fetch(`${app.baseUrl}/api/dashboard/recommendations/reco-lighting-domain-randomization/acknowledge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie
        },
        body: JSON.stringify({})
      });
      assert.equal(recommendationResponse.status, 200);

      const statusResponse = await fetch(`${app.baseUrl}/api/dashboard/deployments/dock-west-bin-picking/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie
        },
        body: JSON.stringify({ status: "Retraining queued" })
      });
      assert.equal(statusResponse.status, 200);

      const accountResponse = await fetch(`${app.baseUrl}/api/account`, {
        headers: { cookie }
      });
      const accountBody = await accountResponse.json();

      assert.equal(accountBody.notes.length, 1);
      assert.equal(accountBody.notes[0].message.includes("Dock West"), true);
      assert.equal(accountBody.recommendations.find((item) => item.id === "reco-lighting-domain-randomization").acknowledged, true);
      assert.equal(accountBody.deployments.find((item) => item.id === "dock-west-bin-picking").status, "Retraining queued");
    } finally {
      await app.close();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/server.test.js`
Expected: FAIL because the dashboard write endpoints and persisted overlays do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
function requireUser(request) {
  const session = getSession(request);
  if (!session) {
    return { error: { status: 401, payload: { error: "Authentication required." } } };
  }

  const users = store.read("users", []);
  const user = users.find((entry) => entry.id === session.userId);
  if (!user) {
    return { error: { status: 404, payload: { error: "User not found." } } };
  }

  return { session, users, user };
}
```

```js
    if (request.method === "POST" && request.url === "/api/dashboard/notes") {
      const auth = requireUser(request);
      if (auth.error) return json(response, auth.error.status, auth.error.payload);
      const body = await parseBody(request);
      if (!String(body.message || "").trim()) {
        return json(response, 400, { error: "A note message is required." });
      }

      const notes = store.read("dashboard-notes", []);
      const note = {
        id: crypto.randomUUID(),
        userId: auth.user.id,
        author: auth.user.name,
        message: String(body.message).trim(),
        createdAt: new Date().toISOString()
      };
      notes.push(note);
      store.write("dashboard-notes", notes);
      return json(response, 201, { ok: true, note });
    }
```

```js
    if (request.method === "POST" && request.url.startsWith("/api/dashboard/recommendations/") && request.url.endsWith("/acknowledge")) {
      const auth = requireUser(request);
      if (auth.error) return json(response, auth.error.status, auth.error.payload);
      const recommendationId = request.url.split("/")[4];
      const acknowledgements = store.read("dashboard-recommendations", []);
      acknowledgements.push({
        userId: auth.user.id,
        recommendationId,
        acknowledgedAt: new Date().toISOString()
      });
      store.write("dashboard-recommendations", acknowledgements);
      return json(response, 200, { ok: true, recommendationId });
    }
```

```js
    if (request.method === "POST" && request.url.startsWith("/api/dashboard/deployments/") && request.url.endsWith("/status")) {
      const auth = requireUser(request);
      if (auth.error) return json(response, auth.error.status, auth.error.payload);
      const deploymentId = request.url.split("/")[4];
      const body = await parseBody(request);
      const statuses = store.read("dashboard-deployment-statuses", []);
      const next = statuses.filter((entry) => !(entry.userId === auth.user.id && entry.deploymentId === deploymentId));
      next.push({
        userId: auth.user.id,
        deploymentId,
        status: body.status || "Monitoring",
        updatedAt: new Date().toISOString()
      });
      store.write("dashboard-deployment-statuses", next);
      return json(response, 200, { ok: true });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/server.test.js`
Expected: PASS for persisted notes, recommendation acknowledgement, and deployment status coverage.

- [ ] **Step 5: Commit**

```bash
git add tests/server.test.js server.js
git commit -m "feat: persist dashboard actions"
```

### Task 3: Add profile and password management endpoints

**Files:**
- Modify: `tests/server.test.js`
- Modify: `server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write the failing tests**

```js
  await run("profile and password updates work for signed-in users", async () => {
    const app = await startServer();
    try {
      await fetch(`${app.baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Jane Doe",
          email: "jane@example.com",
          company: "Example Robotics",
          password: "robotics123"
        })
      });

      const loginResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "jane@example.com",
          password: "robotics123"
        })
      });
      const cookie = loginResponse.headers.get("set-cookie");

      const profileResponse = await fetch(`${app.baseUrl}/api/account/profile`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie
        },
        body: JSON.stringify({
          name: "Jane Q. Doe",
          company: "Example Robotics West"
        })
      });
      assert.equal(profileResponse.status, 200);

      const passwordResponse = await fetch(`${app.baseUrl}/api/account/password`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie
        },
        body: JSON.stringify({
          currentPassword: "robotics123",
          newPassword: "robotics456"
        })
      });
      assert.equal(passwordResponse.status, 200);

      const reloginResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "jane@example.com",
          password: "robotics456"
        })
      });
      assert.equal(reloginResponse.status, 200);

      const accountResponse = await fetch(`${app.baseUrl}/api/account`, {
        headers: { cookie }
      });
      const body = await accountResponse.json();
      assert.equal(body.user.name, "Jane Q. Doe");
      assert.equal(body.user.company, "Example Robotics West");
    } finally {
      await app.close();
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/server.test.js`
Expected: FAIL because `/api/account/profile` and `/api/account/password` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
    if (request.method === "POST" && request.url === "/api/account/profile") {
      const auth = requireUser(request);
      if (auth.error) return json(response, auth.error.status, auth.error.payload);
      const body = await parseBody(request);
      auth.user.name = String(body.name || auth.user.name).trim() || auth.user.name;
      auth.user.company = String(body.company || "").trim();
      store.write("users", auth.users);
      return json(response, 200, { ok: true, user: sanitizeUser(auth.user) });
    }
```

```js
    if (request.method === "POST" && request.url === "/api/account/password") {
      const auth = requireUser(request);
      if (auth.error) return json(response, auth.error.status, auth.error.payload);
      const body = await parseBody(request);
      if (!verifyPassword(body.currentPassword || "", auth.user.passwordHash)) {
        return json(response, 401, { error: "Current password is incorrect." });
      }
      if (!body.newPassword) {
        return json(response, 400, { error: "A new password is required." });
      }
      auth.user.passwordHash = hashPassword(body.newPassword);
      store.write("users", auth.users);
      return json(response, 200, { ok: true });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/server.test.js`
Expected: PASS for profile and password update coverage.

- [ ] **Step 5: Commit**

```bash
git add tests/server.test.js server.js
git commit -m "feat: add account management endpoints"
```

### Task 4: Replace billing-only UI with operations workspace

**Files:**
- Modify: `billing.html`
- Modify: `css/style.css`
- Modify: `scripts/site-smoke.js`
- Test: `scripts/site-smoke.js`

- [ ] **Step 1: Write the failing smoke checks**

```js
  ["billing.html", "Operations overview"],
  ["billing.html", "Deployment telemetry"],
  ["billing.html", "Simulation recommendations"],
  ["billing.html", "Operator notes"],
  ["billing.html", "Account settings"]
```

- [ ] **Step 2: Run smoke to verify it fails**

Run: `node scripts/site-smoke.js`
Expected: FAIL because `billing.html` is still framed as a billing-first page.

- [ ] **Step 3: Write minimal implementation**

```html
    <section class="workspace-shell">
      <div class="workspace-hero">
        <div>
          <p class="hero__badge">Sim2Real Workspace</p>
          <h1>Deployment telemetry and sim-to-real recovery in one view</h1>
          <p class="hero__subtitle">Track transfer health, review failure clusters, and apply simulation updates before pilot drift compounds.</p>
        </div>
        <div class="workspace-actions">
          <a href="#" class="btn btn--primary" data-stripe-portal="billing">Manage subscription</a>
          <a href="contact.html" class="btn btn--secondary">Contact support</a>
          <a href="#" class="btn btn--ghost" data-auth-logout="true">Log out</a>
        </div>
      </div>

      <section class="workspace-panel">
        <h2>Operations overview</h2>
        <div id="workspace-metrics" class="metric-grid"></div>
      </section>
    </section>
```

```css
.workspace-shell {
  display: grid;
  gap: var(--space-lg);
}

.workspace-panel {
  border: 1px solid var(--border-color);
  background: var(--surface-elevated);
  border-radius: 24px;
  padding: var(--space-lg);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-md);
}
```

- [ ] **Step 4: Run smoke to verify it passes**

Run: `node scripts/site-smoke.js`
Expected: PASS for the new operations workspace copy checks.

- [ ] **Step 5: Commit**

```bash
git add billing.html css/style.css scripts/site-smoke.js
git commit -m "feat: replace billing shell with operations workspace layout"
```

### Task 5: Hydrate dashboard actions and inline account flows

**Files:**
- Modify: `js/app.js`
- Modify: `billing.html`
- Modify: `css/style.css`
- Test: `tests/server.test.js`
- Test: `scripts/site-smoke.js`

- [ ] **Step 1: Write the failing integration expectation**

```js
async function hydrateBillingPage() {
  const response = await fetch("/api/account");
  if (!response.ok) {
    window.location.href = "/login.html";
    return;
  }
}
```

The intended failure is behavioral: the current page only fills the old billing summary and uses alert-driven flows rather than panel updates.

- [ ] **Step 2: Run verification to confirm current behavior is incomplete**

Run: `node tests/server.test.js`
Run: `node scripts/site-smoke.js`
Expected: PASS on old tests but missing the richer dashboard UX until implemented.

- [ ] **Step 3: Write minimal implementation**

```js
function setPanelMessage(target, message, tone = "neutral") {
  if (!target) return;
  target.textContent = message;
  target.dataset.tone = tone;
}
```

```js
async function hydrateBillingPage() {
  const response = await fetch("/api/account");
  if (response.status === 401) {
    window.location.href = "/login.html";
    return;
  }

  const payload = await response.json();
  renderWorkspaceMetrics(payload.workspaceMetrics);
  renderDeployments(payload.deployments);
  renderFailureTrends(payload.failureTrends);
  renderRecommendations(payload.recommendations);
  renderNotes(payload.notes);
  renderAccountSettings(payload.user, payload.subscription, payload.invoices);
}
```

```js
document.querySelector("#note-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  const payload = await submitJson("/api/dashboard/notes", data);
  appendNote(payload.note);
  event.currentTarget.reset();
});
```

- [ ] **Step 4: Run full verification**

Run: `npm run test`
Run: `npm run smoke`
Expected: PASS with the richer workspace UI and persisted actions wired up.

- [ ] **Step 5: Commit**

```bash
git add js/app.js billing.html css/style.css
git commit -m "feat: wire sim2real operations dashboard interactions"
```
