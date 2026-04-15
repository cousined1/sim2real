# Sim2Real V7 Static Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Sim2Real repo as a polished static SaaS marketing site and app shell with complete legal, auth, contact, pricing, and billing placeholder flows.

**Architecture:** Keep the project as a static multi-page HTML/CSS/JS site. Use shared visual language and repeated page architecture, with lightweight JavaScript for theme, nav, FAQ behavior, form states, and Stripe placeholder actions. Add a smoke-test script that validates required files and key content so the build has an executable completion check.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, Node.js smoke test

---

### Task 1: Add smoke coverage for required page set

**Files:**
- Create: `scripts/site-smoke.js`
- Test: `scripts/site-smoke.js`

- [ ] **Step 1: Write the failing test**

```js
const requiredPages = [
  "index.html",
  "product.html",
  "pricing.html",
  "contact.html",
  "terms.html",
  "privacy.html",
  "signup.html",
  "login.html",
  "forgot-password.html",
  "billing.html"
];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/site-smoke.js`
Expected: FAIL because several required pages do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
const fs = require("fs");
const path = require("path");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/site-smoke.js`
Expected: PASS after all required pages and content checks exist.

- [ ] **Step 5: Commit**

```bash
git add scripts/site-smoke.js
git commit -m "test: add sim2real site smoke coverage"
```

### Task 2: Complete page inventory and shared UX patterns

**Files:**
- Modify: `index.html`
- Modify: `product.html`
- Modify: `pricing.html`
- Modify: `css/style.css`
- Modify: `js/app.js`
- Create: `contact.html`
- Create: `terms.html`
- Create: `privacy.html`
- Create: `signup.html`
- Create: `login.html`
- Create: `forgot-password.html`
- Create: `billing.html`

- [ ] **Step 1: Write the failing test**

```js
assertContains("pricing.html", "Prices are listed in USD unless otherwise noted.");
assertContains("signup.html", "By creating an account, you agree to the Terms of Service and Privacy Policy.");
assertContains("billing.html", "Manage subscription");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/site-smoke.js`
Expected: FAIL because required disclosures and account-shell content are incomplete.

- [ ] **Step 3: Write minimal implementation**

```html
<p class="disclosure">
  By creating an account, you agree to the <a href="terms.html">Terms of Service</a> and
  <a href="privacy.html">Privacy Policy</a>.
</p>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/site-smoke.js`
Expected: PASS once all required pages, legal links, billing placeholders, and CTA copy exist.

- [ ] **Step 5: Commit**

```bash
git add index.html product.html pricing.html contact.html terms.html privacy.html signup.html login.html forgot-password.html billing.html css/style.css js/app.js
git commit -m "feat: finish sim2real static site and app shell"
```

### Task 3: Final polish and verification

**Files:**
- Modify: `index.html`
- Modify: `product.html`
- Modify: `pricing.html`
- Modify: `contact.html`
- Modify: `terms.html`
- Modify: `privacy.html`
- Modify: `signup.html`
- Modify: `login.html`
- Modify: `forgot-password.html`
- Modify: `billing.html`

- [ ] **Step 1: Write the failing test**

```js
assertContains("index.html", "application/ld+json");
assertContains("terms.html", "Last updated");
assertContains("privacy.html", "Stripe");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/site-smoke.js`
Expected: FAIL if any SEO/schema/legal references are missing or inconsistent.

- [ ] **Step 3: Write minimal implementation**

```html
<link rel="canonical" href="https://sim2real.dev/terms">
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/site-smoke.js`
Expected: PASS with all smoke checks green.

- [ ] **Step 5: Commit**

```bash
git add index.html product.html pricing.html contact.html terms.html privacy.html signup.html login.html forgot-password.html billing.html
git commit -m "chore: verify sim2real v7 static build"
```
