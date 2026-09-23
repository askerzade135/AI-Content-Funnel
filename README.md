# Content Radar / AI-Content-Funnel

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
- AI: Gemini routing layer
- Discovery: YouTube first, extensible source adapters
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
