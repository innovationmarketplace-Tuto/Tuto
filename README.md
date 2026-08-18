# Tuto

Tuto is a universal Expo (React Native + web) tutoring application for a
student's own private learning workspace, with persistent tutoring sessions,
durable learner memory, and analyzed worksheet context.

Project references:

- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — product scope, architecture, decisions,
  and milestones.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — phase sequence and
  integration checkpoints.
- [`AWS_PLAN.md`](AWS_PLAN.md) — optional Bedrock Data Automation setup and
  credential-handling rules.
- [`infra/aws/`](infra/aws/README.md) — deployable CDK stack for BDA, the
  restricted Convex workload identity, and cost alerts.
- [`coordinateTest/`](coordinateTest/README.md) — disposable BDA/Nova spike
  reference; its deployed stack was torn down.

## Local setup

Use Node.js 22.13 or newer (the minimum for Expo SDK 57) and pnpm:

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm web
```

The primary `/` route is account-backed. Set `EXPO_PUBLIC_CONVEX_URL` and
`EXPO_PUBLIC_CONVEX_SITE_URL` to the same Convex deployment, initialize Convex
Auth for that deployment, and keep every provider credential in Convex
environment variables instead of the Expo bundle.

The app now uses Convex Auth's email/password provider for web and native
sessions. Before accepting real accounts, configure the deployment's site URL
and generate the deployment-scoped `JWT_PRIVATE_KEY`/`JWKS` values described in
the Convex Auth setup guide; no auth secret belongs in this repository. The
Expo client reads `EXPO_PUBLIC_CONVEX_SITE_URL` only for the public deployment
origin. Password reset and email verification remain disabled until an email
delivery provider is configured.

Useful commands:

```bash
pnpm start             # Expo development server
pnpm web               # Expo web development server
pnpm web:export        # static web bundle in dist/
pnpm web:serve         # serve an existing dist/ bundle locally
pnpm typecheck         # TypeScript check
pnpm lint              # Expo ESLint flat config
pnpm test              # deterministic TypeScript tests
pnpm check             # typecheck + lint + test
npx convex dev         # watch and push Convex functions during development
npx convex dev --once  # validate and push Convex functions once
```

## Student flow

This product starts with one account and one student. There is no roster, class
directory, or teacher/admin setup step. After signing in, the student continues
their own saved tutor session or asks a new question. The thread and messages
are scoped to that account and return after a reload.

The student can use **Upload page** to store a JPEG/PNG in Convex Storage, start
analysis, and attach a detected region to a later tutor turn. The tutor may
refer to that region while explaining the next step. The student progress
surface (`StudentProgressView`) presents skill status, practice signals, and
private memory in first-person language; an unassessed skill remains “not
started yet” rather than being presented as zero progress.

For the clean demo path, sign in, ask about the fraction-addition activity,
upload an attempt when useful, and return to the progress surface to see what
the tutor learned from the practice.

## Providers and secrets

The shared development deployment is provisioned for the real providers through
`infra/aws`; configure every preview/production Convex deployment independently
with the server-side variables from `.env.example` (for example, with
`npx convex env set`):

- Tutor: `TUTOR_MODEL_PROVIDER=bedrock`, `TUTOR_MODEL_ID`, `AWS_REGION`, and
  server-side AWS credentials.
- Documents: `DOCUMENT_ANALYSIS_PROVIDER=aws_bda`, `AWS_BDA_MODE=sync`, and the
  reviewed BDA project/profile ARNs and stage.
- Nova semantic mapping is optional via `NOVA_MODEL_ID`.

Never put AWS keys in source code, the client bundle, or committed files.
`DOCUMENT_ANALYSIS_KILL_SWITCH=true` disables the AWS analyzer; the fake
provider remains available for offline development and tests. Follow
[`AWS_PLAN.md`](AWS_PLAN.md) for account, IAM, quota, and cost steps.

## Mobile builds and web hosting

`eas.json` contains development and internal preview profiles, but deliberately
does not contain an EAS project ID, app identifiers, credentials, or signing
material. After the team creates or selects its EAS project, an authorized
developer can run:

```bash
npx eas-cli@latest login
pnpm eas:development
pnpm eas:preview
```

Those account/device/signing actions are not complete in this repository. The
selected native document-scanner module and its build-time plugin must be
confirmed before the physical-device demo.

For a deployable web artifact, run `pnpm web:export` and host `dist/` on the
team's chosen static host. The web-host decision and deployed verification are
still human/external steps; no deployment is implied by this scaffold.

## Notes for Expo changes

Expo APIs change between SDK versions. Read [`AGENTS.md`](AGENTS.md) and the
[Expo SDK 57 docs](https://docs.expo.dev/versions/v57.0.0/) before changing
Expo-specific code.
