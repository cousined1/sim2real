const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { createAppServer } = require("../server");

async function startServer(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sim2real-test-"));
  const server = createAppServer({
    rootDir: path.resolve(__dirname, ".."),
    dataDir,
    sessionSecret: "test-secret",
    ...overrides
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    dataDir,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

// Extract all cookies from a response as a single cookie header string
function extractCookies(response) {
  const setCookieHeaders = response.headers.getSetCookie?.() ||
    [response.headers.get("set-cookie")].filter(Boolean);
  return setCookieHeaders.map((c) => c.split(";")[0].trim()).join("; ");
}

// Extract a specific cookie value by name from a response
function getCookieValue(response, name) {
  const setCookieHeaders = response.headers.getSetCookie?.() ||
    [response.headers.get("set-cookie")].filter(Boolean);
  for (const header of setCookieHeaders) {
    const part = header.split(";")[0].trim();
    if (part.startsWith(`${name}=`)) {
      return decodeURIComponent(part.slice(name.length + 1));
    }
  }
  return null;
}

// Fetch with CSRF: GET any page to obtain a CSRF token, then make the POST
async function fetchWithCsrf(url, options, appOrCookie) {
  const headers = { ...(options.headers || {}) };
  let cookieStr = headers.cookie || "";

  // If we have a pre-existing cookie string, extract the CSRF token
  const csrfFromCookie = cookieStr.split(";").map((c) => c.trim()).find((c) => c.startsWith("sim2real_csrf="));
  if (csrfFromCookie) {
    const token = decodeURIComponent(csrfFromCookie.slice("sim2real_csrf=".length));
    headers["x-csrf-token"] = token;
  }

  return fetch(url, { ...options, headers });
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function main() {
  await run("GET / serves the homepage", async () => {
    const app = await startServer();
    try {
      const response = await fetch(`${app.baseUrl}/`);
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.match(text, /Sim2Real/);
    } finally {
      await app.close();
    }
  });

  await run("POST /api/contact stores a submission", async () => {
    const app = await startServer();
    try {
      // Get a CSRF token from the homepage
      const pageResponse = await fetch(`${app.baseUrl}/`);
      const pageCookies = extractCookies(pageResponse);
      const csrfToken = getCookieValue(pageResponse, "sim2real_csrf");

      const response = await fetch(`${app.baseUrl}/api/contact`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie: pageCookies
        },
        body: JSON.stringify({
          name: "Jane Doe",
          email: "jane@example.com",
          company: "Example Robotics",
          topic: "Book a demo",
          message: "Need a demo for our warehouse pilot."
        })
      });
      const body = await response.json();

      assert.equal(response.status, 201);
      assert.equal(body.ok, true);

      const stored = JSON.parse(fs.readFileSync(path.join(app.dataDir, "contacts.json"), "utf8"));
      assert.equal(stored.length, 1);
      assert.equal(stored[0].email, "jane@example.com");
    } finally {
      await app.close();
    }
  });

  await run("signup, login, and account endpoints work together", async () => {
    const app = await startServer();
    try {
      const signupResponse = await fetch(`${app.baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Jane Doe",
          email: "jane@example.com",
          company: "Example Robotics",
          password: "robotics123"
        })
      });
      const signupBody = await signupResponse.json();
      assert.equal(signupResponse.status, 201);
      assert.equal(signupBody.user.email, "jane@example.com");

      const loginResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "jane@example.com",
          password: "robotics123"
        })
      });
      const loginBody = await loginResponse.json();
      assert.equal(loginResponse.status, 200);
      assert.equal(loginBody.ok, true);

      const cookie = extractCookies(loginResponse);
      assert.ok(cookie);

      const accountResponse = await fetch(`${app.baseUrl}/api/account`, {
        headers: { cookie }
      });
      const accountBody = await accountResponse.json();

      assert.equal(accountResponse.status, 200);
      assert.equal(accountBody.user.email, "jane@example.com");
      assert.equal(accountBody.subscription.plan, "Pilot Optimizer");
    } finally {
      await app.close();
    }
  });

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
      const cookie = extractCookies(loginResponse);

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

  await run("forgot password stores a reset token hash for existing users", async () => {
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

      // Get CSRF token from homepage
      const pageResponse = await fetch(`${app.baseUrl}/`);
      const pageCookies = extractCookies(pageResponse);
      const csrfToken = getCookieValue(pageResponse, "sim2real_csrf");

      const response = await fetch(`${app.baseUrl}/api/auth/forgot-password`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie: pageCookies
        },
        body: JSON.stringify({ email: "jane@example.com" })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);

      const tokens = JSON.parse(fs.readFileSync(path.join(app.dataDir, "reset-tokens.json"), "utf8"));
      assert.equal(tokens.length, 1);
      // Token is stored as SHA-256 hash, not plaintext
      assert.ok(tokens[0].tokenHash);
      assert.equal(tokens[0].tokenHash.length, 64); // SHA-256 hex digest
    } finally {
      await app.close();
    }
  });

  await run("reset password updates stored credentials", async () => {
    const app = await startServer();
    try {
      // Get CSRF token from homepage
      const pageResponse = await fetch(`${app.baseUrl}/`);
      const pageCookies = extractCookies(pageResponse);
      const csrfToken = getCookieValue(pageResponse, "sim2real_csrf");

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

      // Request password reset
      await fetch(`${app.baseUrl}/api/auth/forgot-password`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie: pageCookies
        },
        body: JSON.stringify({ email: "jane@example.com" })
      });

      // Create a known token and replace the stored hash
      const rawToken = crypto.randomBytes(24).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const users = JSON.parse(fs.readFileSync(path.join(app.dataDir, "users.json"), "utf8"));
      const tokens = JSON.parse(fs.readFileSync(path.join(app.dataDir, "reset-tokens.json"), "utf8"));
      tokens[0].tokenHash = tokenHash;
      fs.writeFileSync(path.join(app.dataDir, "reset-tokens.json"), JSON.stringify(tokens, null, 2));

      const resetResponse = await fetch(`${app.baseUrl}/api/auth/reset-password`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie: pageCookies
        },
        body: JSON.stringify({
          token: rawToken,
          password: "newpassword456"
        })
      });
      const resetBody = await resetResponse.json();
      assert.equal(resetResponse.status, 200);
      assert.equal(resetBody.ok, true);

      const loginResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "jane@example.com",
          password: "newpassword456"
        })
      });
      assert.equal(loginResponse.status, 200);
    } finally {
      await app.close();
    }
  });

  await run("logout clears the active session", async () => {
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
      const cookie = extractCookies(loginResponse);
      assert.ok(cookie);

      const logoutResponse = await fetch(`${app.baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { cookie }
      });
      const logoutBody = await logoutResponse.json();
      assert.equal(logoutResponse.status, 200);
      assert.equal(logoutBody.ok, true);

      const accountResponse = await fetch(`${app.baseUrl}/api/account`, {
        headers: { cookie }
      });
      assert.equal(accountResponse.status, 401);
    } finally {
      await app.close();
    }
  });

  await run("billing checkout returns config error when Stripe is not configured", async () => {
    const app = await startServer();
    try {
      const pageResponse = await fetch(`${app.baseUrl}/`);
      const pageCookies = extractCookies(pageResponse);
      const csrfToken = getCookieValue(pageResponse, "sim2real_csrf");

      const response = await fetch(`${app.baseUrl}/api/billing/checkout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie: pageCookies
        },
        body: JSON.stringify({ plan: "pilot" })
      });
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.match(body.error, /Stripe is not configured yet/);
    } finally {
      await app.close();
    }
  });

  await run("billing portal returns a live URL when Stripe is configured", async () => {
    const fetchImpl = async (url, options) => {
      assert.match(url, /billing_portal\/sessions$/);
      assert.match(String(options.headers.Authorization || ""), /^Bearer sk_test_/);
      return {
        ok: true,
        async json() {
          return { url: "https://billing.stripe.test/session_123" };
        }
      };
    };

    const app = await startServer({
      stripe: {
        secretKey: "sk_test_123",
        pilotPriceId: "price_test_pilot",
        fetchImpl
      }
    });

    try {
      // Create and authenticate a user; pre-assign their Stripe customer ID
      await fetch(`${app.baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Portal Test", email: "portal@example.com", company: "Portal Corp", password: "robotics123" })
      });
      const users = JSON.parse(fs.readFileSync(path.join(app.dataDir, "users.json"), "utf8"));
      users[0].stripeCustomerId = "cus_123";
      fs.writeFileSync(path.join(app.dataDir, "users.json"), JSON.stringify(users, null, 2));

      const loginResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "portal@example.com", password: "robotics123" })
      });
      const cookie = extractCookies(loginResponse);
      const csrfToken = getCookieValue(loginResponse, "sim2real_csrf");

      const response = await fetch(`${app.baseUrl}/api/billing/portal`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie
        },
        body: JSON.stringify({})
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.url, "https://billing.stripe.test/session_123");
    } finally {
      await app.close();
    }
  });

  await run("billing portal creates and reuses a Stripe customer for the signed-in user", async () => {
    const fetchCalls = [];
    const fetchImpl = async (url, options) => {
      fetchCalls.push({ url, options });
      if (url.includes("/v1/customers")) {
        return {
          ok: true,
          async json() {
            return { id: "cus_created_123" };
          }
        };
      }
      if (url.includes("/v1/billing_portal/sessions")) {
        return {
          ok: true,
          async json() {
            return { url: "https://billing.stripe.test/session_account_123" };
          }
        };
      }
      throw new Error(`Unexpected Stripe URL: ${url}`);
    };

    const app = await startServer({
      stripe: {
        secretKey: "sk_test_123",
        pilotPriceId: "price_test_pilot",
        fetchImpl
      }
    });

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
      const cookie = extractCookies(loginResponse);
      const csrfToken = getCookieValue(loginResponse, "sim2real_csrf");
      assert.ok(cookie);

      const firstPortalResponse = await fetch(`${app.baseUrl}/api/billing/portal`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie
        },
        body: JSON.stringify({})
      });
      const firstPortalBody = await firstPortalResponse.json();
      assert.equal(firstPortalResponse.status, 200);
      assert.equal(firstPortalBody.url, "https://billing.stripe.test/session_account_123");

      const users = JSON.parse(fs.readFileSync(path.join(app.dataDir, "users.json"), "utf8"));
      assert.equal(users[0].stripeCustomerId, "cus_created_123");

      const secondPortalResponse = await fetch(`${app.baseUrl}/api/billing/portal`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie
        },
        body: JSON.stringify({})
      });
      assert.equal(secondPortalResponse.status, 200);

      const customerCalls = fetchCalls.filter((entry) => entry.url.includes("/v1/customers"));
      assert.equal(customerCalls.length, 1);
    } finally {
      await app.close();
    }
  });

  await run("billing checkout uses the stored Stripe customer for signed-in users", async () => {
    const fetchCalls = [];
    const fetchImpl = async (url, options) => {
      fetchCalls.push({ url, options, body: String(options.body) });
      if (url.includes("/v1/customers")) {
        return {
          ok: true,
          async json() {
            return { id: "cus_created_checkout" };
          }
        };
      }
      if (url.includes("/v1/checkout/sessions")) {
        return {
          ok: true,
          async json() {
            return { id: "cs_test_123", url: "https://checkout.stripe.test/session_123" };
          }
        };
      }
      throw new Error(`Unexpected Stripe URL: ${url}`);
    };

    const app = await startServer({
      stripe: {
        secretKey: "sk_test_123",
        pilotPriceId: "price_test_pilot",
        fetchImpl
      }
    });

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
      const cookie = extractCookies(loginResponse);
      const csrfToken = getCookieValue(loginResponse, "sim2real_csrf");

      const response = await fetch(`${app.baseUrl}/api/billing/checkout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie
        },
        body: JSON.stringify({ plan: "pilot" })
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.url, "https://checkout.stripe.test/session_123");

      const checkoutCall = fetchCalls.find((entry) => entry.url.includes("/v1/checkout/sessions"));
      assert.match(checkoutCall.body, /customer=cus_created_checkout/);
    } finally {
      await app.close();
    }
  });

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
      const cookie = extractCookies(loginResponse);
      const csrfToken = getCookieValue(loginResponse, "sim2real_csrf");

      const noteResponse = await fetch(`${app.baseUrl}/api/dashboard/notes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
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
          "x-csrf-token": csrfToken || "",
          cookie
        },
        body: JSON.stringify({})
      });
      assert.equal(recommendationResponse.status, 200);

      const statusResponse = await fetch(`${app.baseUrl}/api/dashboard/deployments/dock-west-bin-picking/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
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
      assert.equal(
        accountBody.recommendations.find((item) => item.id === "reco-lighting-domain-randomization").acknowledged,
        true
      );
      assert.equal(accountBody.deployments.find((item) => item.id === "dock-west-bin-picking").status, "Retraining queued");
    } finally {
      await app.close();
    }
  });

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
      const cookie = extractCookies(loginResponse);
      const csrfToken = getCookieValue(loginResponse, "sim2real_csrf");

      const profileResponse = await fetch(`${app.baseUrl}/api/account/profile`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
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
          "x-csrf-token": csrfToken || "",
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

      const newCookie = extractCookies(reloginResponse);
      const accountResponse = await fetch(`${app.baseUrl}/api/account`, {
        headers: { cookie: newCookie }
      });
      const body = await accountResponse.json();
      assert.equal(body.user.name, "Jane Q. Doe");
      assert.equal(body.user.company, "Example Robotics West");
    } finally {
      await app.close();
    }
  });

  // ── Security regression: .data/ directory must not be HTTP-accessible ──────
  await run("GET /.data/users.json is blocked with 403", async () => {
    const app = await startServer();
    try {
      const response = await fetch(`${app.baseUrl}/.data/users.json`);
      assert.equal(response.status, 403, "Expected 403 for /.data/users.json");

      // Body must not leak any data regardless of status.
      const text = await response.text();
      assert.ok(!text.includes("passwordHash"), "Response must not contain credential fields");
    } finally {
      await app.close();
    }
  });

  await run("GET /.data/sessions.json is blocked with 403", async () => {
    const app = await startServer();
    try {
      const response = await fetch(`${app.baseUrl}/.data/sessions.json`);
      assert.equal(response.status, 403, "Expected 403 for /.data/sessions.json");
    } finally {
      await app.close();
    }
  });

  await run("GET /.data/ directory itself is blocked with 403", async () => {
    const app = await startServer();
    try {
      const response = await fetch(`${app.baseUrl}/.data/`);
      assert.equal(response.status, 403, "Expected 403 for /.data/ directory request");
    } finally {
      await app.close();
    }
  });

  // ── Security regression: tampered session cookies must be rejected ─────────
  await run("fabricated session cookie with wrong HMAC is rejected with 401", async () => {
    const app = await startServer();
    try {
      const fakeSessionId = "00000000-0000-0000-0000-000000000000";
      const fakeHmac = "0".repeat(64);
      const fakeCookieValue = encodeURIComponent(`${fakeSessionId}.${fakeHmac}`);

      const response = await fetch(`${app.baseUrl}/api/account`, {
        headers: { cookie: `sim2real_session=${fakeCookieValue}` }
      });
      assert.equal(response.status, 401, "Expected 401 for fabricated session cookie");
    } finally {
      await app.close();
    }
  });

  await run("session cookie with valid ID but corrupted signature is rejected with 401", async () => {
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
        body: JSON.stringify({ email: "jane@example.com", password: "robotics123" })
      });
      const setCookieHeaders = loginResponse.headers.getSetCookie?.() || [];
      const sessionCookie = setCookieHeaders.find((c) => c.startsWith("sim2real_session="));
      assert.ok(sessionCookie, "Login must set a session cookie");

      // Flip the last character of the raw cookie value to corrupt the HMAC.
      const rawSessionCookie = sessionCookie.split(";")[0];
      const tampered = rawSessionCookie.slice(0, -1) + "x";

      const response = await fetch(`${app.baseUrl}/api/account`, {
        headers: { cookie: tampered }
      });
      assert.equal(response.status, 401, "Expected 401 for cookie with corrupted HMAC");
    } finally {
      await app.close();
    }
  });

  // ── Security: password minimum length enforcement ────────────────────────
  await run("signup rejects passwords shorter than minimum length", async () => {
    const app = await startServer();
    try {
      const response = await fetch(`${app.baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Short Pw",
          email: "short@example.com",
          password: "abc"
        })
      });
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.match(body.error, /at least 8 characters/i);
    } finally {
      await app.close();
    }
  });

  await run("reset-password rejects passwords shorter than minimum length", async () => {
    const app = await startServer();
    try {
      const rawToken = crypto.randomBytes(24).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

      await fetch(`${app.baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Reset Test",
          email: "resetpw@example.com",
          password: "robotics123"
        })
      });

      // Get CSRF from homepage
      const pageResponse = await fetch(`${app.baseUrl}/`);
      const pageCookies = extractCookies(pageResponse);
      const csrfToken = getCookieValue(pageResponse, "sim2real_csrf");

      // Write token directly to store
      const userId = JSON.parse(fs.readFileSync(path.join(app.dataDir, "users.json"), "utf8"))[0].id;
      const tokens = [{ id: "test-token-id", userId, tokenHash, createdAt: new Date().toISOString() }];
      fs.writeFileSync(path.join(app.dataDir, "reset-tokens.json"), JSON.stringify(tokens, null, 2));

      const response = await fetch(`${app.baseUrl}/api/auth/reset-password`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie: pageCookies
        },
        body: JSON.stringify({
          token: rawToken,
          password: "short"
        })
      });
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.match(body.error, /at least 8 characters/i);
    } finally {
      await app.close();
    }
  });

  // ── Security: CSRF token validation ───────────────────────────────────────
  await run("POST to CSRF-protected endpoint without token returns 403", async () => {
    const app = await startServer();
    try {
      const response = await fetch(`${app.baseUrl}/api/contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Test",
          email: "test@example.com",
          message: "Hello"
        })
      });
      assert.equal(response.status, 403);
    } finally {
      await app.close();
    }
  });

  await run("POST to CSRF-protected endpoint with valid token succeeds", async () => {
    const app = await startServer();
    try {
      const pageResponse = await fetch(`${app.baseUrl}/`);
      const pageCookies = extractCookies(pageResponse);
      const csrfToken = getCookieValue(pageResponse, "sim2real_csrf");

      const response = await fetch(`${app.baseUrl}/api/contact`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie: pageCookies
        },
        body: JSON.stringify({
          name: "CSRF Test",
          email: "csrf@example.com",
          message: "Testing CSRF"
        })
      });
      assert.equal(response.status, 201);
    } finally {
      await app.close();
    }
  });

  // ── Security: invalid deployment status falls back to default ─────────────
  await run("invalid deployment status value falls back to Monitoring", async () => {
    const app = await startServer();
    try {
      await fetch(`${app.baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Status Test",
          email: "status@example.com",
          password: "robotics123"
        })
      });

      const loginResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "status@example.com", password: "robotics123" })
      });
      const cookie = extractCookies(loginResponse);
      const csrfToken = getCookieValue(loginResponse, "sim2real_csrf");

      const statusResponse = await fetch(`${app.baseUrl}/api/dashboard/deployments/dock-west-bin-picking/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie
        },
        body: JSON.stringify({ status: "<script>alert('xss')</script>" })
      });
      assert.equal(statusResponse.status, 200);
      const body = await statusResponse.json();
      assert.equal(body.status, "Monitoring");
    } finally {
      await app.close();
    }
  });

  // ── Security: email validation rejects invalid emails ─────────────────────
  await run("signup rejects invalid email addresses", async () => {
    const app = await startServer();
    try {
      const response = await fetch(`${app.baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Bad Email",
          email: "not-an-email",
          password: "robotics123"
        })
      });
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.match(body.error, /valid email/i);
    } finally {
      await app.close();
    }
  });

  // ── Security: rate limiting returns 429 ──────────────────────────────────
  await run("rate limiting returns 429 after exceeding auth rate limit", async () => {
    const app = await startServer();
    try {
      // Send more than RATE_LIMIT_AUTH_MAX (10) login requests rapidly
      let lastResponse;
      for (let i = 0; i < 12; i++) {
        lastResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "rate@test.com", password: "ratelimit123" })
        });
      }
      // The 11th or 12th request should get 429
      assert.ok(lastResponse.status === 429, `Expected 429 but got ${lastResponse.status}`);
    } finally {
      await app.close();
    }
  });

  // ── Security: billing portal requires authentication (F2 fix) ─────────────
  await run("billing portal requires authentication — client-supplied customerId rejected", async () => {
    const app = await startServer({ stripe: { secretKey: "sk_test_123" } });
    try {
      const pageResponse = await fetch(`${app.baseUrl}/`);
      const pageCookies = extractCookies(pageResponse);
      const csrfToken = getCookieValue(pageResponse, "sim2real_csrf");

      const response = await fetch(`${app.baseUrl}/api/billing/portal`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken || "",
          cookie: pageCookies
        },
        body: JSON.stringify({ customerId: "cus_attacker_knows" })
      });
      assert.equal(response.status, 401, "Expected 401 when unauthenticated request supplies customerId");
    } finally {
      await app.close();
    }
  });

  // ── Security: password change invalidates all sessions (F3 fix) ───────────
  await run("password change invalidates all active sessions", async () => {
    const app = await startServer();
    try {
      await fetch(`${app.baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Jane Doe", email: "jane@example.com", password: "robotics123" })
      });
      const loginResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "jane@example.com", password: "robotics123" })
      });
      const cookie = extractCookies(loginResponse);
      const csrfToken = getCookieValue(loginResponse, "sim2real_csrf");

      const pwResponse = await fetch(`${app.baseUrl}/api/account/password`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken || "", cookie },
        body: JSON.stringify({ currentPassword: "robotics123", newPassword: "newpassword456" })
      });
      assert.equal(pwResponse.status, 200);

      // Old session must no longer work
      const accountResponse = await fetch(`${app.baseUrl}/api/account`, { headers: { cookie } });
      assert.equal(accountResponse.status, 401, "Expected 401 after session invalidation on password change");
    } finally {
      await app.close();
    }
  });

  // ── Security: Stripe webhook signature verification (F1 fix) ──────────────
  await run("Stripe webhook with invalid signature returns 400", async () => {
    const app = await startServer({ stripe: { webhookSecret: "whsec_test_secret_value" } });
    try {
      const response = await fetch(`${app.baseUrl}/api/webhooks/stripe`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=1234567890,v1=invalidsignaturehex0000000000000000000000000000000000000000000000"
        },
        body: JSON.stringify({ type: "customer.subscription.created", data: { object: {} } })
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.match(body.error, /signature/i);
    } finally {
      await app.close();
    }
  });

  // ── Security: note message length limit (F8 fix) ──────────────────────────
  await run("notes endpoint rejects messages exceeding maximum length", async () => {
    const app = await startServer();
    try {
      await fetch(`${app.baseUrl}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Jane Doe", email: "jane@example.com", password: "robotics123" })
      });
      const loginResponse = await fetch(`${app.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "jane@example.com", password: "robotics123" })
      });
      const cookie = extractCookies(loginResponse);
      const csrfToken = getCookieValue(loginResponse, "sim2real_csrf");

      const response = await fetch(`${app.baseUrl}/api/dashboard/notes`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken || "", cookie },
        body: JSON.stringify({ message: "x".repeat(2001) })
      });
      assert.equal(response.status, 400, "Expected 400 for note exceeding 2000 chars");
    } finally {
      await app.close();
    }
  });

  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main();