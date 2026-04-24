const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// â”€â”€ Named constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MAX_BODY_BYTES = 64 * 1024;                          // 64 KB per request body
const PBKDF2_ITERATIONS = parseInt(process.env.PBKDF2_ITERATIONS || "100000", 10);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;            // 30-day session lifetime
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;                  // 1-hour reset-token lifetime
const MIN_PASSWORD_LENGTH = 8;
const VALID_PLANS = ["Pilot Optimizer", "Enterprise Transfer", "Request custom plan"];
const VALID_DEPLOYMENT_STATUSES = ["Monitoring", "Needs review", "Retraining queued", "Stable"];
const RATE_LIMIT_WINDOW_MS = 60 * 1000;                     // 1 minute
const RATE_LIMIT_AUTH_MAX = 10;                               // 10 requests per minute for auth
const RATE_LIMIT_GENERAL_MAX = 30;                           // 30 requests per minute general
const RATE_LIMIT_CONTACT_MAX = 5;                            // 5 contact submissions per minute
const RATE_LIMIT_WEBHOOK_MAX = 100;                          // 100 webhook requests per minute
const NOTE_MAX_LENGTH = 2000;                                // Max note message characters
const NAME_MAX_LENGTH = 255;                                  // Max name field characters
const COMPANY_MAX_LENGTH = 255;                              // Max company field characters
const WEBHOOK_MAX_BYTES = 512 * 1024;                        // 512 KB max webhook body
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;                // 5-minute replay-protection window

// â”€â”€ Structured logging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LOG_LEVELS = { error: 50, warn: 40, info: 30, debug: 20 };
const MIN_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || "info"] || LOG_LEVELS.info;

function log(level, message, context = {}) {
  if (LOG_LEVELS[level] < MIN_LOG_LEVEL) return;
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    requestId: context.requestId || null,
    userId: context.userId || null,
    ...context
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// â”€â”€ Rate limiter with cleanup (in-memory, per-IP) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const RATE_LIMITER_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;     // 5 minutes
const RATE_LIMITER_MAX_ENTRIES_PER_IP = 1000;               // Cap entries per IP

function createRateLimiter(maxRequests, windowMs) {
  const hits = new Map();
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now - record.start > windowMs * 2) {
        hits.delete(key);
      }
    }
  }, RATE_LIMITER_CLEANUP_INTERVAL_MS);
  cleanupInterval.unref();

  return function rateLimited(remoteAddress) {
    const now = Date.now();
    const record = hits.get(remoteAddress);
    if (!record || now - record.start > windowMs) {
      if (hits.size >= RATE_LIMITER_MAX_ENTRIES_PER_IP) {
        hits.clear();
      }
      hits.set(remoteAddress, { start: now, count: 1 });
      return false;
    }
    record.count += 1;
    if (record.count > maxRequests) {
      return true;
    }
    return false;
  };
}

// â”€â”€ Simple CSRF token generation and validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function validateCsrfToken(header, cookie) {
  if (!header || !cookie) return false;
  return timingSafeHexCompare(header, cookie);
}

// â”€â”€ Email format validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email) {
  return typeof email === "string" && EMAIL_REGEX.test(email);
}

// â”€â”€ Data store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  let writeLock = Promise.resolve();

  function fileFor(name) {
    return path.join(dataDir, `${name}.json`);
  }

  function read(name, fallback = []) {
    const file = fileFor(name);
    if (!fs.existsSync(file)) {
      return fallback;
    }
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      log("error", `Failed to read ${name}: ${error.message}`, { error: error.stack });
      return fallback;
    }
  }

  function write(name, value) {
    const serialised = JSON.stringify(value, null, 2);
    const dest = fileFor(name);
    writeLock = writeLock.then(
      () => { fs.writeFileSync(dest, serialised, "utf8"); },
      (error) => {
        log("error", `Write failed for ${name}, retrying: ${error.message}`);
        fs.writeFileSync(dest, serialised, "utf8");
      }
    );
    return writeLock;
  }

  return { read, write };
}

// â”€â”€ Security headers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.stripe.com; frame-ancestors 'none';",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()"
};

function addSecurityHeaders(response, extraHeaders = {}) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(key, value);
  }
  for (const [key, value] of Object.entries(extraHeaders)) {
    response.setHeader(key, value);
  }
}

function json(response, status, payload, headers = {}) {
  const setCookie = headers["set-cookie"];
  const otherHeaders = { ...headers };
  delete otherHeaders["set-cookie"];

  addSecurityHeaders(response);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...otherHeaders,
    ...(setCookie ? { "set-cookie": setCookie } : {})
  });
  response.end(JSON.stringify(payload));
}

function text(response, status, payload, headers = {}) {
  addSecurityHeaders(response, headers);
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  response.end(payload);
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join("="));
    return acc;
  }, {});
}

// â”€â”€ Timing-safe comparison â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function timingSafeHexCompare(a, b) {
  try {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// â”€â”€ Password hashing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// â”€â”€ Stripe webhook HMAC-SHA256 signature verification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Implements https://stripe.com/docs/webhooks/signatures manually (no Stripe SDK).
// Returns true only when signature is valid and the timestamp is within tolerance.
function verifyStripeSignature(rawBody, signatureHeader, webhookSecret) {
  const elements = signatureHeader.split(",");
  const tPart = elements.find((e) => e.startsWith("t="));
  const signatures = elements.filter((e) => e.startsWith("v1=")).map((e) => e.slice(3));
  if (!tPart || !signatures.length) return false;

  const timestamp = tPart.slice(2);
  const timestampInt = parseInt(timestamp, 10);
  if (!Number.isFinite(timestampInt)) return false;

  // Replay protection â€” reject events older than the tolerance window
  const ageSeconds = Math.abs(Date.now() / 1000 - timestampInt);
  if (ageSeconds > STRIPE_WEBHOOK_TOLERANCE_SECONDS) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSig = crypto.createHmac("sha256", webhookSecret)
    .update(signedPayload, "utf8")
    .digest("hex");

  return signatures.some((sig) => {
    try {
      const bufSig = Buffer.from(sig, "hex");
      const bufExp = Buffer.from(expectedSig, "hex");
      return bufSig.length === bufExp.length && crypto.timingSafeEqual(bufSig, bufExp);
    } catch {
      return false;
    }
  });
}

// â”€â”€ Body parser â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function parseBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        request.destroy();
        const err = new Error("Request body too large.");
        err.statusCode = 413;
        return reject(err);
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

// â”€â”€ MIME types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8"
  };
  return map[ext] || "application/octet-stream";
}

// â”€â”€ User sanitization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    company: user.company,
    stripeCustomerId: user.stripeCustomerId || null
  };
}

// â”€â”€ Seeded dashboard data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function seededDashboardForUser(user) {
  const seed = Array.from(user.id || user.email || "sim2real").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const activeRobots = 3 + (seed % 3);
  const openFailureClusters = 3 + (seed % 4);
  const recommendedUpdates = 2 + (seed % 3);
  const successRate = (92 + (seed % 5) + 0.2).toFixed(1);

  return {
    workspaceMetrics: { activeRobots, transferSuccessRate: `${successRate}%`, openFailureClusters, recommendedUpdates },
    deployments: [
      { id: "dock-west-bin-picking", robotName: "Picker-07", site: "Warehouse West", task: "Bin picking", simConfidence: "91%", realWorldSuccessRate: "84%", driftScore: "0.31", status: "Monitoring" },
      { id: "line-east-case-transfer", robotName: "Transfer-04", site: "Assembly East", task: "Case transfer", simConfidence: "89%", realWorldSuccessRate: "87%", driftScore: "0.24", status: "Stable" },
      { id: "dock-south-pallet-scan", robotName: "Scout-12", site: "Distribution South", task: "Pallet scan", simConfidence: "94%", realWorldSuccessRate: "79%", driftScore: "0.42", status: "Needs review" }
    ],
    failureTrends: [
      { id: "lighting-variance", label: "Lighting variance", severity: "High", count: 18, summary: "Observed glare spikes during late-shift picking windows." },
      { id: "object-tilt", label: "Object tilt", severity: "Medium", count: 11, summary: "Tray entry angle drift is increasing near mixed tote lanes." },
      { id: "clutter-occlusion", label: "Clutter occlusion", severity: "High", count: 15, summary: "Partially hidden grasp targets are reducing first-pass success." }
    ],
    recommendations: [
      { id: "reco-lighting-domain-randomization", title: "Increase lighting domain randomization", theme: "Lighting variance", action: "Expand overhead glare and exposure perturbations in sim scenes.", expectedImpact: "Reduce grasp miss rate during low-angle glare events.", confidence: "High", acknowledged: false },
      { id: "reco-contact-restitution-pass", title: "Retune contact restitution for tilted bins", theme: "Object tilt", action: "Update contact and friction sweeps for angled tote edges.", expectedImpact: "Improve placement recovery during offset landings.", confidence: "Medium", acknowledged: false },
      { id: "reco-clutter-scene-expansion", title: "Expand clutter density scene generation", theme: "Clutter occlusion", action: "Generate denser occlusion cases in retraining batches for dock workflows.", expectedImpact: "Lift first-pass pick success in mixed inventory lanes.", confidence: "High", acknowledged: false }
    ]
  };
}

// â”€â”€ Stripe helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function ensureStripeCustomer({ user, storeUsers, stripe }) {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }
  const secret = stripe.secretKey || process.env.STRIPE_SECRET_KEY;
  const fetchImpl = stripe.fetchImpl || fetch;
  if (!secret) {
    throw new Error("Stripe is not configured yet. Add STRIPE_SECRET_KEY to create customers.");
  }
  const params = new URLSearchParams();
  params.set("name", user.name || user.email);
  params.set("email", user.email);
  if (user.company) params.set("metadata[company]", user.company);
  params.set("metadata[userId]", user.id);

  const response = await fetchImpl("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: params
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ? payload.error.message : "Stripe customer creation failed.");
  }
  user.stripeCustomerId = payload.id;
  storeUsers();
  return user.stripeCustomerId;
}

async function createStripeCheckoutSession({ plan, origin, stripe, customerId, customerEmail }) {
  const secret = stripe.secretKey || process.env.STRIPE_SECRET_KEY;
  const pilotPrice = stripe.pilotPriceId || process.env.STRIPE_PRICE_ID_PILOT;
  const fetchImpl = stripe.fetchImpl || fetch;
  if (!secret || !pilotPrice) {
    return { ok: false, status: 503, payload: { error: "Stripe is not configured yet. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID_PILOT to enable checkout." } };
  }
  const priceId = plan === "pilot" ? pilotPrice : null;
  if (!priceId) {
    return { ok: false, status: 400, payload: { error: "Unsupported plan for self-serve checkout." } };
  }
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", `${origin}/checkout-success.html`);
  params.set("cancel_url", `${origin}/checkout-cancelled.html`);
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  if (customerId) params.set("customer", customerId);
  else if (customerEmail) params.set("customer_email", customerEmail);

  const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: params
  });
  const payload = await response.json();
  if (!response.ok) {
    return { ok: false, status: 502, payload: { error: payload.error ? payload.error.message : "Stripe checkout failed." } };
  }
  return { ok: true, status: 200, payload: { url: payload.url, id: payload.id } };
}

async function createStripePortalSession({ customerId, origin, stripe }) {
  const secret = stripe.secretKey || process.env.STRIPE_SECRET_KEY;
  const fetchImpl = stripe.fetchImpl || fetch;
  if (!secret) {
    return { ok: false, status: 503, payload: { error: "Stripe billing portal is not configured yet." } };
  }
  if (!customerId) {
    return { ok: false, status: 400, payload: { error: "customerId is required for the billing portal." } };
  }
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", `${origin}/billing.html`);

  const response = await fetchImpl("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body: params
  });
  const payload = await response.json();
  if (!response.ok) {
    return { ok: false, status: 502, payload: { error: payload.error ? payload.error.message : "Stripe billing portal failed." } };
  }
  return { ok: true, status: 200, payload: { url: payload.url } };
}

function getTrustedOrigin(request, allowedHosts) {
  const host = request.headers.host || "";
  const proto = request.headers["x-forwarded-proto"] || "https";
  if (allowedHosts.length > 0 && !allowedHosts.includes(host)) {
    return null;
  }
  return `${proto}://${host}`;
}

// â”€â”€ Main application server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function createAppServer({ rootDir, dataDir, sessionSecret, stripe = {}, allowedHosts }) {
  const store = createStore(dataDir);
  const secret = sessionSecret || "sim2real-dev-secret";
  const trustedHosts = allowedHosts || [];

  const limitAuth = createRateLimiter(RATE_LIMIT_AUTH_MAX, RATE_LIMIT_WINDOW_MS);
  const limitContact = createRateLimiter(RATE_LIMIT_CONTACT_MAX, RATE_LIMIT_WINDOW_MS);
  const limitGeneral = createRateLimiter(RATE_LIMIT_GENERAL_MAX, RATE_LIMIT_WINDOW_MS);
  const limitWebhook = createRateLimiter(RATE_LIMIT_WEBHOOK_MAX, RATE_LIMIT_WINDOW_MS);

  function storeUsers(users) { store.write("users", users); }

  function sessionSignature(sessionId) {
    return crypto.createHmac("sha256", secret).update(sessionId).digest("hex");
  }

  function makeSessionCookie(sessionId) {
    const signed = `${sessionId}.${sessionSignature(sessionId)}`;
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `sim2real_session=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax${secure}`;
  }

  function makeCsrfCookie(token) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    return `sim2real_csrf=${encodeURIComponent(token)}; Path=/; SameSite=Lax${secure}`;
  }

  function getSession(request) {
    const cookies = parseCookies(request.headers.cookie);
    const value = cookies.sim2real_session;
    if (!value) return null;
    const [sessionId, signature] = value.split(".");
    if (!sessionId || !signature || !timingSafeHexCompare(signature, sessionSignature(sessionId))) {
      return null;
    }
    const sessions = store.read("sessions", []);
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return null;
    if (Date.now() - new Date(session.createdAt).getTime() > SESSION_TTL_MS) return null;
    return session;
  }

  function pruneExpiredSessions(sessions) {
    const now = Date.now();
    return sessions.filter((s) => now - new Date(s.createdAt).getTime() <= SESSION_TTL_MS);
  }

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

  function loadDashboardState(user) {
    const dashboard = seededDashboardForUser(user);
    const notes = store.read("dashboard-notes", []).filter((entry) => entry.userId === user.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const acknowledgements = store.read("dashboard-recommendations", []).filter((entry) => entry.userId === user.id);
    const statuses = store.read("dashboard-deployment-statuses", []).filter((entry) => entry.userId === user.id);
    const acknowledgedIds = new Set(acknowledgements.map((entry) => entry.recommendationId));
    const statusMap = new Map(statuses.map((entry) => [entry.deploymentId, entry.status]));
    return {
      workspaceMetrics: dashboard.workspaceMetrics,
      deployments: dashboard.deployments.map((entry) => ({ ...entry, status: statusMap.get(entry.id) || entry.status })),
      failureTrends: dashboard.failureTrends,
      recommendations: dashboard.recommendations.map((entry) => ({ ...entry, acknowledged: acknowledgedIds.has(entry.id) })),
      notes
    };
  }

  const DUMMY_PASSWORD_HASH = hashPassword("timing-attack-dummy-password");

  function getClientIp(request) {
    return request.headers["x-forwarded-for"]?.split(",")[0]?.trim() || request.socket?.remoteAddress || "unknown";
  }

  async function handleApi(request, response) {
    const clientIp = getClientIp(request);
    const url = request.url;

    // Rate limiting
    const authRoutes = ["/api/auth/login", "/api/auth/signup", "/api/auth/forgot-password", "/api/auth/reset-password"];
    if (authRoutes.some((route) => url === route)) {
      if (limitAuth(clientIp)) {
        return json(response, 429, { error: "Too many requests. Please try again later." }, { "Retry-After": "60" });
      }
    } else if (url === "/api/contact") {
      if (limitContact(clientIp)) {
        return json(response, 429, { error: "Too many requests. Please try again later." }, { "Retry-After": "60" });
      }
    } else if (url === "/api/webhooks/stripe") {
      if (limitWebhook(clientIp)) {
        return json(response, 429, { error: "Too many requests." }, { "Retry-After": "60" });
      }
    } else {
      if (limitGeneral(clientIp)) {
        return json(response, 429, { error: "Too many requests. Please try again later." }, { "Retry-After": "60" });
      }
    }

    // CSRF validation
    const stateChangingMethods = ["POST"];
    const csrfExemptRoutes = ["/api/auth/login", "/api/auth/signup", "/api/auth/logout", "/api/webhooks/stripe", "/api/chat"];
    if (stateChangingMethods.includes(request.method) && !csrfExemptRoutes.includes(url)) {
      const cookies = parseCookies(request.headers.cookie);
      const csrfHeader = request.headers["x-csrf-token"] || "";
      const csrfCookie = cookies.sim2real_csrf || "";
      if (!validateCsrfToken(csrfHeader, csrfCookie)) {
        return json(response, 403, { error: "CSRF token validation failed." });
      }
    }


    // Sim2Real AI Chat endpoint

    // Conversation state management for salesbot chat
    const CHAT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
    const chatSessions = new Map();

    function getChatSessionId(body) {
      return String(body.sessionId || "anon-" + Math.random().toString(36).slice(2));
    }

    function getChatState(sessionId) {
      const now = Date.now();
      // Prune stale sessions periodically
      for (const [sid, sess] of chatSessions) {
        if (now - sess.updatedAt > CHAT_SESSION_TTL_MS) chatSessions.delete(sid);
      }
      if (!chatSessions.has(sessionId)) {
        chatSessions.set(sessionId, {
          flow: "idle",
          step: 0,
          data: {},
          updatedAt: now
        });
      }
      return chatSessions.get(sessionId);
    }

    function updateChatState(sessionId, updates) {
      const state = getChatState(sessionId);
      Object.assign(state, updates, { updatedAt: Date.now() });
    }

    const SIM2REAL_KB = [
      { q: /sim.?to.?real|sim2real|sim.to.real/i, a: "Sim2Real is a simulation-to-real transfer platform that helps robotics teams close the gap between simulation-trained models and real-world deployment behavior. It captures deployment telemetry, detects failure causes, generates improved simulation conditions, and feeds those back into your training loop -- reducing pilot failures and improving transfer reliability." },
      { q: /digital twin/i, a: "A digital twin is a virtual replica of a physical system that mirrors its behavior in real time. In robotics, digital twins let you test control policies and perception models in simulation before deploying to the real robot -- saving time and reducing risk. Sim2Real builds and maintains digital twins of your deployment environments by learning from actual robot performance data." },
      { q: /failure analysis engine/i, a: "The Failure Analysis Engine classifies deployment failures by physical cause -- perception mismatch (lighting, occlusion, glare), physics mismatch (friction, contact, inertial differences), and task mismatch (policy, sequencing, edge cases). This lets your team target the right fix instead of treating every failure as generic noise." },
      { q: /training data generation|synthetic data|retrain/i, a: "Sim2Real transforms real-world deployment failures into improved simulation training conditions. When a robot fails in the field, that failure is analyzed and used to generate new synthetic scenarios with updated perturbations -- like adjusted friction, lighting, or clutter -- so your next training run better reflects actual deployment conditions." },
      { q: /ros|ros2/i, a: "Sim2Real integrates with ROS and ROS2 for telemetry ingestion, command logging, and deployment metadata. We support topic-level data capture and can work alongside your existing robot middleware without requiring a stack swap." },
      { q: /mujoco/i, a: "Sim2Real supports MuJoCo as a simulation backend. We generate updated parameter sets and perturbation ranges that can be loaded directly into MuJoCo scenes, making it easy to retrain policies with more realistic physics." },
      { q: /isaac sim|isaacsim/i, a: "Sim2Real works with NVIDIA Isaac Sim for high-fidelity GPU-accelerated simulation. We can push updated scene descriptions, lighting configurations, and material properties back into Isaac Sim for retraining." },
      { q: /omniverse/i, a: "Sim2Real integrates with NVIDIA Omniverse for scalable, collaborative simulation workflows. We support USD scene updates and can sync digital twin parameters across Omniverse-connected environments." },
      { q: /pilot optimizer/i, a: "Pilot Optimizer is our $499/month plan designed for small fleets and pilot programs. It includes up to 3 robots, core failure analytics, baseline simulation perturbation recommendations, weekly reporting, and email support." },
      { q: /enterprise transfer|enterprise plan/i, a: "Enterprise Transfer starts at $2,500/month and is built for scaling deployments and multi-site operations. It includes multi-robot support, advanced simulation generation, custom integrations, priority support, and dedicated onboarding." },
      { q: /roi|cost savings|return on investment/i, a: "Sim2Real reduces the cost of failed pilots by shortening iteration cycles, lowering manual data collection overhead, and surfacing hidden transfer bottlenecks before they multiply. Teams typically see faster go-live decisions and fewer expensive on-site debugging sessions." },
      { q: /security|compliance|soc2|iso/i, a: "Sim2Real processes deployment telemetry in a secure environment with industry-standard encryption and access controls. We follow best practices for data handling and can discuss compliance requirements (SOC 2, ISO 27001) as part of Enterprise onboarding." },
      { q: /onboarding|setup|getting started/i, a: "Getting started with Sim2Real is straightforward: connect your telemetry pipeline, define your task and environment, and begin capturing deployment data. Pilot Optimizer includes self-serve setup; Enterprise includes dedicated onboarding with your team." },
      { q: /custom integration|api|webhook/i, a: "Enterprise plans include custom integration support and API access. We can build connectors to your existing data warehouse, MLOps platform, or fleet management system. Contact us to discuss your specific requirements." },
      { q: /team size|how many people|engineers/i, a: "Pilot Optimizer works well for small teams (2-5 engineers) running focused pilots. Enterprise Transfer is designed for larger cross-functional teams with dedicated simulation, controls, and deployment engineers." },
      { q: /manufacturing|factory|assembly line/i, a: "Sim2Real helps manufacturing teams improve reliability in repetitive but variable workflows -- catching small physical differences (surface wear, part variance, lighting changes) that create expensive downtime in production cells." },
      { q: /warehouse|logistics|fulfillment|pick and place|bin picking/i, a: "For warehouse and logistics operations, Sim2Real reduces grasp and handling failures in messy environments. We calibrate simulation assumptions against actual clutter, lighting shifts, and object variance before pilot issues compound." },
      { q: /robotics startup|early stage|seed|series a/i, a: "Robotics startups use Sim2Real to move faster from pilot to production. Instead of rebuilding workflows around repeated field failures, you learn from deployment data and iterate on simulation conditions -- preserving runway and engineering velocity." },
      { q: /enterprise pilot|proof of concept|poc/i, a: "Enterprise pilots benefit from Sim2Real's structured feedback loop: clear failure classification, repeatable calibration recommendations, and evidence-based go-live criteria. This reduces the risk of pilot programs stalling or failing to scale." },
      { q: /data privacy|gdpr|data handling/i, a: "Sim2Real processes deployment telemetry in a secure environment with industry-standard encryption and access controls. User data is handled in accordance with our Privacy Policy. We do not share customer data with third parties. Enterprise customers can request data residency and custom retention policies." },
      { q: /sla|uptime|availability/i, a: "Sim2Real is hosted on reliable cloud infrastructure with monitoring and automated failover. Enterprise plans include SLA commitments for uptime and support response times. Contact sales for specific SLA terms." },
      { q: /support|help desk|customer success/i, a: "Pilot Optimizer includes email support with weekly reports. Enterprise Transfer includes priority support with faster response times and a dedicated customer success contact. Enterprise customers also get access to our Slack channel for real-time questions." },
      { q: /failure|error|drift|gap/i, a: "Sim-to-real failures typically stem from differences between simulation assumptions and real-world conditions -- like lighting variance, surface friction changes, object clutter, sensor noise, or pose drift. Sim2Real detects these failure patterns, classifies them, and generates updated simulation parameters so you can retrain with more realistic conditions before your next deployment." },
      { q: /telemetry|sensor|camera|im[au]|force torque/i, a: "Sim2Real ingests deployment telemetry including camera feeds, force-torque sensors, IMU data, and task outcome records. This data is compared against what the simulation expected to happen, surfacing the specific conditions that caused performance divergence." },
      { q: /pricing|cost|plan|price/i, a: "Sim2Real offers two plans: the Pilot Optimizer at $499/month for up to 3 robots with core failure analytics and baseline simulation recommendations, and Enterprise Transfer starting at $2,500/month for multi-robot fleets, advanced simulation generation, custom integrations, and dedicated onboarding. All plans include a free trial." },
      { q: /integration|mujoco|omniverse|isaac|unity|unreal/i, a: "Sim2Real is designed to work alongside your existing robotics stack. Depending on your plan, integrations can include ROS/ROS2, NVIDIA Isaac Sim, Omniverse, MuJoCo, and custom APIs. Enterprise plans include dedicated onboarding." },
      { q: /pilot|production|deploy/i, a: "Sim2Real is built for teams running pilot deployments and scaling toward production fleets. It helps you identify which scenarios are most likely to break before they become expensive on-site debugging sessions -- giving your team clear evidence for go-live decisions and shorter iteration cycles." },
      { q: /demo|trial|start|sign up/i, a: "You can start a free trial of Sim2Real by visiting our signup page. No credit card is required. If you prefer a personalized walkthrough, you can book a demo with our team through the contact page -- we'll tailor it to your robotics stack and deployment environment." },
      { q: /how it works|workflow|process/i, a: "Sim2Real works in four steps: 1) Capture deployment telemetry from your robots. 2) Detect and classify failure causes. 3) Generate updated simulation parameters and synthetic scenarios. 4) Redeploy with evidence and track improvement over time." },
      { q: /closed feedback loop|feedback loop/i, a: "The closed feedback loop is the core of Sim2Real: real-world failures are captured, analyzed, and translated back into simulation conditions. This means every deployment makes your next training run more realistic, creating a compounding improvement effect." },
      { q: /domain randomization|perturbation/i, a: "Domain randomization and perturbation are techniques used to make simulation training more robust. Sim2Real automatically suggests which parameters to randomize -- lighting, friction, clutter, pose -- based on actual failure patterns observed in deployment." },
      { q: /contact sales|talk to sales|sales team/i, a: "You can reach our sales team by clicking Contact Sales in the chat, filling out the contact form on our website, or emailing hello@developer312.com. We typically respond within one business day and can tailor a demo to your specific robotics stack." }
    ];

    // Enhanced /api/chat with conversation state tracking
    if (request.method === "POST" && request.url === "/api/chat") {
      const body = await parseBody(request);
      const userMessage = String(body.message || "").trim();
      const sessionId = getChatSessionId(body);
      const state = getChatState(sessionId);
      const responsePayload = handleChatMessage(userMessage, state);
      return json(response, 200, { success: true, sessionId, ...responsePayload });
    }

    function handleChatMessage(userMessage, state) {
      const lower = userMessage.toLowerCase();

      // Quick-reply triggers (only when NOT in an active flow)
      const inFlow = state.flow && state.flow !== "idle";
      const isPricing = !inFlow && /pricing|cost|plan|price/i.test(userMessage);
      const isDemo = !inFlow && /\bdemo\b/i.test(userMessage);
      const isContact = !inFlow && /contact sales|talk to sales|sales team/i.test(userMessage);
      const isHowItWorks = !inFlow && /how it works|workflow|process/i.test(userMessage);

      // Handle active flows first
      if (state.flow === "demo_booking") {
        return handleDemoBooking(userMessage, state);
      }
      if (state.flow === "contact") {
        return handleContactFlow(userMessage, state);
      }

      // Handle explicit quick-reply clicks / intents
      if (isDemo) {
        state.flow = "demo_booking";
        state.step = 0;
        state.data = {};
        return { type: "text", text: "Great! I'd love to help you book a demo. What's your name?" };
      }
      if (isContact) {
        state.flow = "contact";
        state.step = 0;
        state.data = {};
        return { type: "text", text: "I'd be happy to connect you with our sales team. What's your name?" };
      }
      if (isPricing) {
        return {
          type: "options",
          text: "Sim2Real offers two plans:\n\n**Pilot Optimizer** — $499/month\n• Up to 3 robots\n• Core failure analytics\n• Baseline simulation recommendations\n• Weekly reports & email support\n\n**Enterprise Transfer** — Starting at $2,500/month\n• Multi-robot support\n• Advanced simulation generation\n• Custom integrations\n• Priority support & dedicated onboarding\n\nAll plans include a free trial. Which plan sounds right for you?",
          options: ["📅 Book a Demo", "📞 Contact Sales", "🚀 How it works"]
        };
      }
      if (isHowItWorks) {
        return {
          type: "options",
          text: "Sim2Real works in four steps:\n\n1️⃣ **Capture deployment telemetry** — camera, force-torque, IMU, and task outcomes.\n2️⃣ **Detect failure causes** — classify where simulation diverged from reality.\n3️⃣ **Improve future training** — generate updated simulation parameters and synthetic scenarios.\n4️⃣ **Redeploy with evidence** — track improvement and prioritize the next calibration pass.\n\nWant to see how this fits your use case?",
          options: ["📅 Book a Demo", "💰 Pricing", "📞 Contact Sales"]
        };
      }

      // Greeting / welcome
      if (lower === "hi" || lower === "hello" || lower === "hey" || lower === "start" || lower === "help") {
        return {
          type: "options",
          text: "Hi, I'm your Sim2Real guide. I can answer questions about our platform, help you book a demo, or connect you with our team. What brings you here today?",
          options: ["💰 Pricing", "📅 Book a Demo", "🚀 How it works", "📞 Contact Sales"]
        };
      }

      // Fallback to KB Q&A
      for (const entry of SIM2REAL_KB) {
        if (entry.q.test(lower)) {
          return { type: "text", text: entry.a, options: ["💰 Pricing", "📅 Book a Demo", "🚀 How it works", "📞 Contact Sales"] };
        }
      }

      return {
        type: "options",
        text: "Thanks for your question. For specific inquiries about sim-to-real transfer, digital twins, platform features, integrations, or pricing, feel free to visit our product and pricing pages, or contact us directly at hello@developer312.com. Our team typically responds within one business day.",
        options: ["💰 Pricing", "📅 Book a Demo", "📞 Contact Sales"]
      };
    }

    function handleDemoBooking(userMessage, state) {
      const steps = ["name", "email", "company", "date"];
      const currentField = steps[state.step];

      if (currentField === "name") {
        state.data.name = userMessage;
        state.step = 1;
        return { type: "text", text: "Nice to meet you, " + userMessage + "! What's your work email?" };
      }
      if (currentField === "email") {
        if (!isValidEmail(userMessage)) {
          return { type: "text", text: "That doesn't look like a valid email. Please enter a valid work email address." };
        }
        state.data.email = userMessage;
        state.step = 2;
        return { type: "text", text: "What company are you with?" };
      }
      if (currentField === "company") {
        state.data.company = userMessage;
        state.step = 3;
        return { type: "text", text: "What date works best for your demo? (e.g., 'Next Tuesday' or 'May 15')" };
      }
      if (currentField === "date") {
        state.data.date = userMessage;
        // Submit lead
        try {
          const leads = store.read("leads", []);
          leads.push({
            id: crypto.randomUUID(),
            name: String(state.data.name || "").trim().slice(0, 255),
            email: String(state.data.email || "").trim().slice(0, 255),
            company: String(state.data.company || "").trim().slice(0, 255),
            source: "chat-widget-demo",
            message: `Demo request for ${userMessage}`,
            createdAt: new Date().toISOString()
          });
          store.write("leads", leads);
        } catch (e) {
          log("error", "Failed to store demo lead: " + e.message);
        }
        state.flow = "idle";
        state.step = 0;
        return {
          type: "options",
          text: "Perfect! I've submitted your demo request. Our team will reach out to you at " + state.data.email + " within one business day to confirm the date.\n\nIn the meantime, is there anything else I can help with?",
          options: ["💰 Pricing", "🚀 How it works", "📞 Contact Sales"]
        };
      }
      return { type: "text", text: "I'm not sure I understood. Could you try rephrasing that?" };
    }

    function handleContactFlow(userMessage, state) {
      const steps = ["name", "email", "message"];
      const currentField = steps[state.step];

      if (currentField === "name") {
        state.data.name = userMessage;
        state.step = 1;
        return { type: "text", text: "Thanks, " + userMessage + "! What's your work email?" };
      }
      if (currentField === "email") {
        if (!isValidEmail(userMessage)) {
          return { type: "text", text: "That doesn't look like a valid email. Please enter a valid work email address." };
        }
        state.data.email = userMessage;
        state.step = 2;
        return { type: "text", text: "How can our sales team help you? Please share a brief message." };
      }
      if (currentField === "message") {
        state.data.message = userMessage;
        // Submit lead
        try {
          const leads = store.read("leads", []);
          leads.push({
            id: crypto.randomUUID(),
            name: String(state.data.name || "").trim().slice(0, 255),
            email: String(state.data.email || "").trim().slice(0, 255),
            company: String(state.data.company || "").trim().slice(0, 255),
            source: "chat-widget-contact",
            message: String(userMessage || "").trim().slice(0, 10000),
            createdAt: new Date().toISOString()
          });
          store.write("leads", leads);
        } catch (e) {
          log("error", "Failed to store contact lead: " + e.message);
        }
        state.flow = "idle";
        state.step = 0;
        return {
          type: "options",
          text: "Message sent! Our sales team will follow up with you at " + state.data.email + " within one business day.\n\nIs there anything else I can help with?",
          options: ["💰 Pricing", "📅 Book a Demo", "🚀 How it works"]
        };
      }
      return { type: "text", text: "I'm not sure I understood. Could you try rephrasing that?" };
    }

    // Contact form
    if (request.method === "POST" && request.url === "/api/contact") {
      const body = await parseBody(request);
      if (!body.name || !body.email || !body.message) {
        return json(response, 400, { error: "name, email, and message are required" });
      }
      if (!isValidEmail(body.email)) {
        return json(response, 400, { error: "A valid email address is required." });
      }
      const contacts = store.read("contacts", []);
      contacts.push({
        id: crypto.randomUUID(),
        name: String(body.name).trim().slice(0, 255),
        email: String(body.email).trim().slice(0, 255),
        company: String(body.company || "").trim().slice(0, 255),
        topic: String(body.topic || "").trim().slice(0, 100),
        message: String(body.message).trim().slice(0, 10000),
        createdAt: new Date().toISOString()
      });
      store.write("contacts", contacts);
      return json(response, 201, { ok: true });
    }

    if (request.method === "POST" && request.url === "/api/leads") {
      const body = await parseBody(request);
      if (!body.name || !body.email) {
        return json(response, 400, { error: "name and email are required" });
      }
      if (!isValidEmail(body.email)) {
        return json(response, 400, { error: "A valid email address is required." });
      }
      const leads = store.read("leads", []);
      leads.push({
        id: crypto.randomUUID(),
        name: String(body.name).trim().slice(0, 255),
        email: String(body.email).trim().slice(0, 255),
        company: String(body.company || "").trim().slice(0, 255),
        source: String(body.source || "chat-widget").trim().slice(0, 100),
        message: String(body.message || "").trim().slice(0, 10000),
        createdAt: new Date().toISOString()
      });
      store.write("leads", leads);
      return json(response, 201, { ok: true, leadId: leads[leads.length - 1].id });
    }

    // Signup
    if (request.method === "POST" && request.url === "/api/auth/signup") {
      const body = await parseBody(request);
      if (!body.name || !body.email || !body.password) {
        return json(response, 400, { error: "name, email, and password are required" });
      }
      if (!isValidEmail(body.email)) {
        return json(response, 400, { error: "A valid email address is required." });
      }
      if (body.password.length < MIN_PASSWORD_LENGTH) {
        return json(response, 400, { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      }
      const users = store.read("users", []);
      if (users.some((user) => user.email.toLowerCase() === body.email.toLowerCase())) {
        return json(response, 409, { error: "An account with that email already exists." });
      }
      const selectedPlan = VALID_PLANS.includes(body.plan) ? body.plan : "Pilot Optimizer";
      const trimmedName = String(body.name).trim().slice(0, NAME_MAX_LENGTH);
      const trimmedCompany = String(body.company || "").trim().slice(0, COMPANY_MAX_LENGTH);
      const user = {
        id: crypto.randomUUID(),
        name: trimmedName,
        email: body.email,
        company: trimmedCompany,
        stripeCustomerId: null,
        passwordHash: hashPassword(body.password),
        subscription: { plan: selectedPlan, status: "active", billingInterval: "monthly" },
        createdAt: new Date().toISOString()
      };
      users.push(user);
      store.write("users", users);
      return json(response, 201, { ok: true, user: sanitizeUser(user) });
    }

    // Login
    if (request.method === "POST" && request.url === "/api/auth/login") {
      const body = await parseBody(request);
      const users = store.read("users", []);
      const user = users.find((entry) => entry.email.toLowerCase() === String(body.email || "").toLowerCase());
      const hashToCompare = user ? user.passwordHash : DUMMY_PASSWORD_HASH;
      const passwordOk = verifyPassword(body.password || "", hashToCompare);
      if (!user || !passwordOk) {
        return json(response, 401, { error: "Invalid email or password." });
      }
      let sessions = store.read("sessions", []);
      sessions = pruneExpiredSessions(sessions);
      const session = { id: crypto.randomUUID(), userId: user.id, createdAt: new Date().toISOString() };
      sessions.push(session);
      store.write("sessions", sessions);
      const csrfToken = generateCsrfToken();
      return json(response, 200, { ok: true, user: sanitizeUser(user), csrfToken }, {
        "set-cookie": [makeSessionCookie(session.id), makeCsrfCookie(csrfToken)]
      });
    }

    // Logout
    if (request.method === "POST" && request.url === "/api/auth/logout") {
      const session = getSession(request);
      if (session) {
        let sessions = store.read("sessions", []);
        sessions = pruneExpiredSessions(sessions.filter((entry) => entry.id !== session.id));
        store.write("sessions", sessions);
      }
      return json(response, 200, { ok: true }, {
        "set-cookie": ["sim2real_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0", "sim2real_csrf=; Path=/; SameSite=Lax; Max-Age=0"]
      });
    }

    // Forgot password
    if (request.method === "POST" && request.url === "/api/auth/forgot-password") {
      const body = await parseBody(request);
      const users = store.read("users", []);
      const user = users.find((entry) => entry.email.toLowerCase() === String(body.email || "").toLowerCase());
      const tokens = store.read("reset-tokens", []);
      if (user) {
        const rawToken = crypto.randomBytes(24).toString("hex");
        // Invalidate any existing reset tokens for this user before issuing a new one
        const freshTokens = tokens.filter((entry) => entry.userId !== user.id);
        freshTokens.push({ id: crypto.randomUUID(), userId: user.id, tokenHash: hashResetToken(rawToken), createdAt: new Date().toISOString() });
        store.write("reset-tokens", freshTokens);
      }
      return json(response, 200, { ok: true, message: "If that account exists, a reset link has been generated." });
    }

    // Reset password
    if (request.method === "POST" && request.url === "/api/auth/reset-password") {
      const body = await parseBody(request);
      if (!body.token || !body.password) {
        return json(response, 400, { error: "Valid token and new password are required." });
      }
      if (body.password.length < MIN_PASSWORD_LENGTH) {
        return json(response, 400, { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      }
      const tokens = store.read("reset-tokens", []);
      const tokenHash = hashResetToken(body.token);
      const tokenIndex = tokens.findIndex((entry) => timingSafeHexCompare(entry.tokenHash, tokenHash));
      if (tokenIndex === -1) {
        return json(response, 400, { error: "Invalid or expired reset token." });
      }
      const token = tokens[tokenIndex];
      const remainingTokens = tokens.filter((_, i) => i !== tokenIndex);
      if (Date.now() - new Date(token.createdAt).getTime() > RESET_TOKEN_TTL_MS) {
        store.write("reset-tokens", remainingTokens);
        return json(response, 400, { error: "Reset token has expired. Please request a new one." });
      }
      const users = store.read("users", []);
      const user = users.find((entry) => entry.id === token.userId);
      if (!user) {
        return json(response, 404, { error: "User not found." });
      }
      user.passwordHash = hashPassword(body.password);
      store.write("users", users);
      store.write("reset-tokens", remainingTokens);
      return json(response, 200, { ok: true });
    }

    // Profile update
    if (request.method === "POST" && request.url === "/api/account/profile") {
      const auth = requireUser(request);
      if (auth.error) return json(response, auth.error.status, auth.error.payload);
      const body = await parseBody(request);
      const updatedName = String(body.name || auth.user.name).trim().slice(0, NAME_MAX_LENGTH) || auth.user.name;
      auth.user.name = updatedName;
      auth.user.company = String(body.company || "").trim().slice(0, COMPANY_MAX_LENGTH);
      store.write("users", auth.users);
      return json(response, 200, { ok: true, user: sanitizeUser(auth.user) });
    }

    // Password change
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
      if (body.newPassword.length < MIN_PASSWORD_LENGTH) {
        return json(response, 400, { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      }
      auth.user.passwordHash = hashPassword(body.newPassword);
      store.write("users", auth.users);
      // Invalidate ALL sessions for this user â€” force re-login after password change
      let pwSessions = store.read("sessions", []);
      pwSessions = pruneExpiredSessions(pwSessions.filter((s) => s.userId !== auth.user.id));
      store.write("sessions", pwSessions);
      return json(response, 200, { ok: true });
    }

    // Version endpoint (for forced-update watchdog)
    if (request.method === "GET" && request.url === "/api/version") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      });
      response.end(JSON.stringify({
        version: process.env.npm_package_version || process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0",
        build: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    // Account/dashboard data
    if (request.method === "GET" && request.url === "/api/account") {
      const auth = requireUser(request);
      if (auth.error) return json(response, auth.error.status, auth.error.payload);
      const dashboard = loadDashboardState(auth.user);
      return json(response, 200, {
        user: sanitizeUser(auth.user),
        subscription: auth.user.subscription,
        workspaceMetrics: dashboard.workspaceMetrics,
        deployments: dashboard.deployments,
        failureTrends: dashboard.failureTrends,
        recommendations: dashboard.recommendations,
        notes: dashboard.notes,
        invoices: [{ month: "April 2026", status: "Paid" }, { month: "March 2026", status: "Paid" }, { month: "February 2026", status: "Paid" }]
      });
    }

    // Dashboard notes
    if (request.method === "POST" && request.url === "/api/dashboard/notes") {
      const auth = requireUser(request);
      if (auth.error) return json(response, auth.error.status, auth.error.payload);
      const body = await parseBody(request);
      const message = String(body.message || "").trim();
      if (!message) {
        return json(response, 400, { error: "A note message is required." });
      }
      if (message.length > NOTE_MAX_LENGTH) {
        return json(response, 400, { error: `Note must be ${NOTE_MAX_LENGTH} characters or fewer.` });
      }
      const notes = store.read("dashboard-notes", []);
      const note = { id: crypto.randomUUID(), userId: auth.user.id, author: auth.user.name, message, createdAt: new Date().toISOString() };
      notes.push(note);
      store.write("dashboard-notes", notes);
      return json(response, 201, { ok: true, note });
    }

    // Recommendation acknowledgements
    if (request.method === "POST" && request.url.startsWith("/api/dashboard/recommendations/") && request.url.endsWith("/acknowledge")) {
      const auth = requireUser(request);
      if (auth.error) return json(response, auth.error.status, auth.error.payload);
      const recommendationId = request.url.split("/")[4];
      const acknowledgements = store.read("dashboard-recommendations", []);
      const next = acknowledgements.filter((entry) => !(entry.userId === auth.user.id && entry.recommendationId === recommendationId));
      next.push({ userId: auth.user.id, recommendationId, acknowledgedAt: new Date().toISOString() });
      store.write("dashboard-recommendations", next);
      return json(response, 200, { ok: true, recommendationId });
    }

    // Deployment status updates
    if (request.method === "POST" && request.url.startsWith("/api/dashboard/deployments/") && request.url.endsWith("/status")) {
      const auth = requireUser(request);
      if (auth.error) return json(response, auth.error.status, auth.error.payload);
      const deploymentId = request.url.split("/")[4];
      const body = await parseBody(request);
      const rawStatus = String(body.status || "").trim();
      const status = VALID_DEPLOYMENT_STATUSES.includes(rawStatus) ? rawStatus : "Monitoring";
      const statuses = store.read("dashboard-deployment-statuses", []);
      const next = statuses.filter((entry) => !(entry.userId === auth.user.id && entry.deploymentId === deploymentId));
      next.push({ userId: auth.user.id, deploymentId, status, updatedAt: new Date().toISOString() });
      store.write("dashboard-deployment-statuses", next);
      return json(response, 200, { ok: true, deploymentId, status });
    }

    // Stripe checkout
    if (request.method === "POST" && request.url === "/api/billing/checkout") {
      const body = await parseBody(request);
      const origin = getTrustedOrigin(request, trustedHosts);
      if (!origin) {
        return json(response, 400, { error: "Invalid request origin." });
      }
      let customerId = null;
      let customerEmail = null;
      const session = getSession(request);
      if (session) {
        const users = store.read("users", []);
        const user = users.find((entry) => entry.id === session.userId);
        if (user) {
          try {
            user.stripeCustomerId = await ensureStripeCustomer({ user, storeUsers: () => store.write("users", users), stripe });
            store.write("users", users);
            customerId = user.stripeCustomerId;
            customerEmail = user.email;
          } catch (error) {
            return json(response, 503, { error: error.message });
          }
        }
      }
      const result = await createStripeCheckoutSession({ plan: body.plan, origin, stripe, customerId, customerEmail });
      return json(response, result.status, result.payload);
    }

    // Stripe portal
    if (request.method === "POST" && request.url === "/api/billing/portal") {
      const origin = getTrustedOrigin(request, trustedHosts);
      if (!origin) return json(response, 400, { error: "Invalid request origin." });
      // Always require authentication â€” never accept a client-supplied customerId (IDOR risk)
      const portalSession = getSession(request);
      if (!portalSession) return json(response, 401, { error: "Authentication required." });
      const portalUsers = store.read("users", []);
      const portalUser = portalUsers.find((entry) => entry.id === portalSession.userId);
      if (!portalUser) return json(response, 404, { error: "User not found." });
      let portalCustomerId;
      try {
        portalCustomerId = await ensureStripeCustomer({ user: portalUser, storeUsers: () => store.write("users", portalUsers), stripe });
        store.write("users", portalUsers);
      } catch (error) {
        return json(response, 503, { error: error.message });
      }
      const result = await createStripePortalSession({ customerId: portalCustomerId, origin, stripe });
      return json(response, result.status, result.payload);
    }

    // Stripe webhook handler
    if (request.method === "POST" && request.url === "/api/webhooks/stripe") {
      const webhookSecret = stripe.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        log("warn", "Stripe webhook received but STRIPE_WEBHOOK_SECRET not configured");
        return json(response, 503, { error: "Webhook secret not configured." });
      }

      const rawBody = await new Promise((resolve, reject) => {
        const chunks = [];
        let totalWebhookBytes = 0;
        request.on("data", (chunk) => {
          totalWebhookBytes += chunk.length;
          if (totalWebhookBytes > WEBHOOK_MAX_BYTES) {
            request.destroy();
            const err = new Error("Webhook body too large.");
            err.statusCode = 413;
            return reject(err);
          }
          chunks.push(chunk);
        });
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        request.on("error", reject);
      });

      const signature = request.headers["stripe-signature"];
      if (!signature) {
        log("warn", "Stripe webhook received without signature");
        return json(response, 400, { error: "Missing Stripe signature." });
      }

      // Verify Stripe HMAC-SHA256 signature
      let event;
      try {
        if (stripe.validateWebhook) {
          // Test/mock hook â€” allows injection of a custom verifier in tests
          event = stripe.validateWebhook(rawBody, signature, webhookSecret);
        } else {
          // Production path: native HMAC verification (no Stripe SDK required)
          if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
            log("error", "Stripe webhook signature verification failed");
            return json(response, 400, { error: "Invalid signature." });
          }
          event = JSON.parse(rawBody);
        }
      } catch (error) {
        log("error", `Stripe webhook processing error: ${error.message}`);
        return json(response, 400, { error: "Invalid signature." });
      }

      // Handle webhook events idempotently
      const { type, data } = event;
      const customerId = data.object?.customer;

      try {
        switch (type) {
          case "customer.subscription.created":
          case "customer.subscription.updated": {
            const users = store.read("users", []);
            const user = users.find((u) => u.stripeCustomerId === customerId);
            if (user) {
              user.subscription = {
                plan: data.object.items?.data[0]?.plan?.product || user.subscription?.plan || "Pilot Optimizer",
                status: data.object.status || "active",
                billingInterval: data.object.items?.data[0]?.plan?.interval || "monthly"
              };
              store.write("users", users);
              log("info", `Subscription ${type} for user ${user.id}`);
            }
            break;
          }
          case "customer.subscription.deleted": {
            const users = store.read("users", []);
            const user = users.find((u) => u.stripeCustomerId === customerId);
            if (user) {
              user.subscription = { ...user.subscription, status: "canceled" };
              store.write("users", users);
              log("info", `Subscription canceled for user ${user.id}`);
            }
            break;
          }
          case "invoice.payment_succeeded":
            log("info", `Invoice payment succeeded for customer ${customerId}`);
            break;
          case "invoice.payment_failed":
            log("warn", `Invoice payment failed for customer ${customerId}`);
            break;
          case "checkout.session.completed":
            log("info", `Checkout session completed: ${data.object.id}`);
            break;
          default:
            log("debug", `Unhandled Stripe webhook event: ${type}`);
        }
      } catch (error) {
        log("error", `Webhook handler failed: ${error.message}`, { eventType: type });
      }

      return json(response, 200, { received: true });
    }

    return false;
  }

  // Health and readiness endpoints
  async function handleHealth(_request, response) {
    const health = {
      status: "ok",
      db: "connected",
      version: process.env.npm_package_version || "0.1.0",
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
    return json(response, 200, health, { "Cache-Control": "no-store" });
  }

  async function handleReady(_request, response) {
    const ready = {
      ready: true,
      canServeTraffic: true,
      timestamp: new Date().toISOString()
    };
    return json(response, 200, ready, { "Cache-Control": "no-store" });
  }

  // Pre-compute safe boundary paths
  const safeRoot = path.resolve(rootDir);
  const safeData = path.resolve(dataDir);
  const safeDataConvention = path.join(safeRoot, ".data");

  function isInsideDataDir(resolved) {
    return [safeData, safeDataConvention].some((dir) => resolved === dir || resolved.startsWith(dir + path.sep));
  }

  return http.createServer(async (request, response) => {
    try {
      // Health check endpoint
      if (request.url === "/health" || request.url === "/healthz") {
        return handleHealth(request, response);
      }

      // Readiness endpoint
      if (request.url === "/ready" || request.url === "/readyz") {
        return handleReady(request, response);
      }

      // API routes
      if (request.url.startsWith("/api/")) {
        const handled = await handleApi(request, response);
        if (handled !== false) return;
        return json(response, 404, { error: "Not found." });
      }

      // Serve CSRF token cookie
      const existingCookies = parseCookies(request.headers.cookie);
      if (!existingCookies.sim2real_csrf) {
        response.setHeader("set-cookie", makeCsrfCookie(generateCsrfToken()));
      }

      // Static file serving
      const cleanUrl = request.url === "/" ? "/index.html" : request.url;
      const filePath = path.join(rootDir, decodeURIComponent(cleanUrl.replace(/\?.*$/, "")));
      const resolved = path.resolve(filePath);

      const insideRoot = resolved.startsWith(safeRoot);
      const insideData = isInsideDataDir(resolved);
      if (!insideRoot || insideData) {
        return text(response, 403, "Forbidden");
      }

      let finalPath = resolved;
      if (!fs.existsSync(finalPath) || fs.statSync(finalPath).isDirectory()) {
        finalPath = path.join(rootDir, "404.html");
        response.statusCode = 404;
      }

      const body = fs.readFileSync(finalPath);
      response.setHeader("content-type", mimeType(finalPath));
      // Cache static assets with hashes for 1 year, HTML files no-cache
      if (/\.[a-f0-9]{8}\./.test(finalPath) || /\.[a-f0-9]{8}\./.test(finalPath)) {
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
      response.end(body);
    } catch (error) {
      const status = error.statusCode || 500;
      log("error", `Request failed: ${error.message}`, { url: request.url, status });
      // Never leak internal error details on server errors
      const clientMessage = status < 500 ? (error.message || "Request error.") : "Unexpected server error.";
      json(response, status, { error: clientMessage });
    }
  });
}

// â”€â”€ Server startup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (require.main === module) {
  // Production environment validation
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    console.error("FATAL: SESSION_SECRET environment variable must be set in production.");
    process.exit(1);
  }

  const rootDir = __dirname;
  const dataDir = path.join(__dirname, ".data");
  const port = Number(process.env.PORT || 3000);
  const allowedHosts = process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(",") : [];

  const stripe = {
    secretKey: process.env.STRIPE_SECRET_KEY,
    pilotPriceId: process.env.STRIPE_PRICE_ID_PILOT,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
  };

  const server = createAppServer({
    rootDir,
    dataDir,
    sessionSecret: process.env.SESSION_SECRET || "sim2real-dev-secret",
    stripe,
    allowedHosts
  });

  // Graceful shutdown handler
  let shuttingDown = false;
  function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", `Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      log("info", "HTTP server closed");
      process.exit(0);
    });
    // Force exit after 10 seconds
    setTimeout(() => {
      log("error", "Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    log("error", `Uncaught exception: ${error.message}`, { stack: error.stack });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    log("error", `Unhandled rejection: ${reason}`, { promise });
  });

  server.listen(port, "0.0.0.0", () => {
    const proto = process.env.NODE_ENV === "production" ? "https" : "http";
    log("info", `Sim2Real server running on ${proto}://0.0.0.0:${port}`, { port, env: process.env.NODE_ENV || "development" });
  });
}

module.exports = { createAppServer };
