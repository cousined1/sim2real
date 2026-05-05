---
type: audit-remediation
tags: [seo, compliance, gdpr, google-tag-manager]
confidence: HIGH
created: 2026-05-04
source: Google-audit-fix.txt
---

# SEO and Compliance Audit Learnings

## Context
A technical SEO and compliance audit identified critical issues across the Sim2Real static marketing site. The primary findings were a canonical domain mismatch (split between `sim2real.dev` and `sim2real.com`), missing cookie consent mechanisms, and indexability conflicts.

## Interventions
1. **Canonical Domain Unification:** 
   - Standardized all `canonical`, `og:url`, `og:image`, `robots.txt` directives, and `sitemap.xml` entries to use the definitive domain `https://sim-2-real.com`.
   - Stripped the canonical tag from `404.html` (which was also marked as `noindex`) to prevent conflict.
   
2. **GDPR/CCPA Consent Mode:**
   - Injected Google Consent Mode v2 default snippet into all HTML `<head>` blocks before Google Tag Manager. Defaults `ad_storage` and `analytics_storage` to `denied`.
   - Created a persistent, responsive cookie banner (`js/cookie-banner.js`) that correctly pushes updated consent grants to the `dataLayer` without triggering a reload.

## Compounding Knowledge for Future Work
- **Domain Drift is Expensive:** Ensure that environment variables (if building static files from templates in the future) bind tightly to `https://sim-2-real.com` and not developer placeholders like `.dev`.
- **Consent-First Architecture:** Any future integration of tracking scripts (like LinkedIn Pixel, Meta Pixel, or alternative analytics) *must* be routed through GTM and bound to the Consent Mode triggers. No raw script tags should bypass the banner.
- **Static File Iterations:** Global updates across multiple `.html` files in this architecture require mass Regex replacement or PowerShell scripting, indicating that a template engine or SSG (e.g., Astro, Eleventy) might be a valuable future abstraction to reduce update friction.
