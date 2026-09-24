# Content Radar

Content Radar is a creator workflow for discovering relevant source content, learning from explicit feedback, extracting content opportunities, generating scripts, and scheduling publication.

## Core flow

```
My Radar → Discover → Feedback → Analysis → Ideas → Save → Script → Calendar → Publish
```

## Documentation

- [Product flow](docs/product-flow.md) — central end-to-end product specification and source of truth for the user journey.
- [Radar personalization model](docs/radar-personalization-model.md) — Topics, Avoid, tasteVersion, eligibility, ranking, feedback and refresh rules.
- [Radar E2E audit](docs/radar-e2e-audit.md) — QA findings, regression coverage and remaining production smoke.
- [Technical debt](docs/technical-debt.md) — intentionally deferred engineering work.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind
- Backend: Node.js / TypeScript
- Auth / infrastructure: Firebase
- AI: free-first multi-provider routing (Gemini / Groq / OpenRouter) with optional paid OpenAI fallback
- Discovery: source-selectable YouTube/Web; Web uses sequential SearchRouter (Google grounding → Tavily → Brave → OpenAI fallback)
- Integrations: Google Calendar and other source/integration workspaces

## Development

```bash
npm install
npm run dev
```

Verification:

```bash
npm run lint
npm test
npm run build
```

For product behavior, do not rely on this README alone. Start with `docs/product-flow.md`.


## AI and Web Search routing

My Radar chooses **where** to search (YouTube/Web; X remains unavailable until its adapter is ready). Output format is chosen later per Idea by AI and can be overridden during generation.

Web Search is provider-neutral and sequential:

```
Google grounding → Tavily → Brave → OpenAI Web Search
```

The router starts with Google grounding when the existing Gemini key is available, then falls back to Tavily, Brave and finally OpenAI. It stops once it has enough unique results; it does not call every provider in parallel. Provider quota/auth failures enter a temporary cooldown. Search results are deduplicated by canonical URL and enriched from the article page with title, author/date, main text and `og:image`.

OpenAI remains the paid last-resort Web Search fallback. LLM routing is separate: included/free providers first, optional paid platform fallback afterward. BYOK mode keeps the user's selected provider/key isolated and never silently switches to a platform-paid key.

Relevant server configuration is documented in `.env.example`. Provider keys stay server-side and Settings API responses return only masked connection state.
