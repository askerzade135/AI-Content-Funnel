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
- Discovery: YouTube + optional OpenAI Web Search, with extensible source adapters
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


## OpenAI + Web Search

OpenAI is server-only and opt-in. Free/included LLM candidates remain first in the routing order. Set `ALLOW_PAID_AI_FALLBACK=true` to allow OpenAI after the existing free/Gemini fallback chain. Web Search is a separate Discovery source and requires both `OPENAI_API_KEY` and `OPENAI_WEB_SEARCH_ENABLED=true`.

Cloud Run keeps OpenAI disabled unless the GitHub variable `OPENAI_ENABLED=true` is set; when enabled, add `OPENAI_API_KEY` in Google Secret Manager. No OpenAI key is shipped to the browser.
