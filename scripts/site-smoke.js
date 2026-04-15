const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

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
  "reset-password.html",
  "billing.html",
  "404.html",
  "checkout-success.html",
  "checkout-cancelled.html",
  "robots.txt",
  "sitemap.xml",
  "site.webmanifest",
  "assets/og-image.svg",
  "assets/favicon.svg"
];

const checks = [
  ["index.html", "Book a Demo"],
  ["index.html", "site.webmanifest"],
  ["product.html", "ROS"],
  ["pricing.html", "Prices are listed in USD unless otherwise noted."],
  ["contact.html", "Developer312, a subsidiary of NIGHT LITE USA LLC"],
  ["terms.html", "Terms of Service"],
  ["privacy.html", "Privacy Policy"],
  ["signup.html", "By creating an account, you agree to the Terms of Service and Privacy Policy."],
  ["login.html", "Forgot your password?"],
  ["forgot-password.html", "Reset password"],
  ["reset-password.html", "Set a new password"],
  ["billing.html", "Operations overview"],
  ["billing.html", "Deployment telemetry"],
  ["billing.html", "Simulation recommendations"],
  ["billing.html", "Operator notes"],
  ["billing.html", "Account settings"],
  ["billing.html", "Manage subscription"],
  ["404.html", "Page not found"],
  ["404.html", "assets/favicon.svg"],
  ["checkout-success.html", "Checkout Success"],
  ["checkout-cancelled.html", "Checkout Cancelled"],
  ["robots.txt", "Sitemap: https://sim2real.dev/sitemap.xml"],
  ["sitemap.xml", "https://sim2real.dev/pricing"],
  ["site.webmanifest", "\"name\": \"Sim2Real\""],
  ["assets/og-image.svg", "Sim2Real"],
  ["assets/favicon.svg", "#132744"]
];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  requiredPages.forEach((file) => {
    assert(fs.existsSync(path.join(root, file)), `Missing required page: ${file}`);
  });

  checks.forEach(([file, needle]) => {
    const content = read(file);
    assert(content.includes(needle), `Expected "${needle}" in ${file}`);
  });

  console.log("Sim2Real smoke test passed.");
}

main();
