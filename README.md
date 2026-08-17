# Tuto

An AI-tutoring prototype with durable, inspectable learner memory. Built as a universal Expo (React Native + web) application over Convex.

Start here:

- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — product scope, architecture, decisions, and delivery milestones (source of truth).
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — the three-person execution sequence: what to build before splitting into individual work, then phase-by-phase tracks.
- [`AWS_PLAN.md`](AWS_PLAN.md) — AWS-specific setup for the document-analysis provider (Bedrock Data Automation).
- [`coordinateTest/`](coordinateTest/README.md) — a disposable spike that validated the BDA + Nova coordinate round trip; its deployed AWS stack has been torn down, but the adapter code remains as a reference for the real `DocumentAnalyzer` implementation.

## Get started

```bash
npm install
npx expo start
```

This project uses [Expo Router](https://docs.expo.dev/router/introduction) file-based routing under `src/app`. Shared, provider-independent contracts live in `src/domain`; feature code lives in `src/features/*`.

## Backend

Convex functions and schema live in `convex/`. See `PROJECT_PLAN.md` for the backend and AI provider contracts.

## Notes for AI agents

Expo APIs change quickly between SDK versions — read [`AGENTS.md`](AGENTS.md) before writing Expo-specific code.
