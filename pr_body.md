## Summary
Adds a floating AI chatbot to SIM2Real with a rule-based knowledge base covering sim-to-real, digital twins, robotics, and platform pricing.

### Changes
- **js/chatbot-widget.js** - Self-contained vanilla JS widget injected via script tag. Floats bottom-right, brand-blue (#1256d6), no build step needed.
- **server.js** - New POST /api/chat endpoint with a knowledge-base router (10 topics: sim-to-real, digital twins, failures, training, telemetry, pricing, integrations, pilots, privacy, demos). Falls back to a helpful default response.
- **index.html, pricing.html, product.html, contact.html** - Widget script injected before </body>.

### Widget features
- Session persistence via localStorage
- Typing indicator + loading state
- Error handling with user-friendly messages
- Responsive (full-width on mobile)
- Accessible (ARIA labels, keyboard support)

### To deploy
```bash
railway init --name sim2real --workspace "cousined1's Projects"
railway up
```
