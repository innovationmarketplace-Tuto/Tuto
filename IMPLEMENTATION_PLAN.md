# Tuto Implementation Plan — 3-Person Execution Sequence

Last updated: 2026-08-17
Status: Draft execution plan derived from `PROJECT_PLAN.md`

## Purpose

`PROJECT_PLAN.md` is the source of truth for product scope, architecture, and decisions. `AWS_PLAN.md` is the source of truth for AWS-specific setup. This file adds nothing new to either — it resequences their content into a concrete order of operations for three people: what must be built together before work can split, and what each person does once it splits. When scope or ownership changes, update `PROJECT_PLAN.md` first and reflect the change here.

## How to read this plan

- **Phase 0** is blocking. No individual segment work starts until Phase 0's exit criterion is met.
- **Phases 1–5** map directly to `PROJECT_PLAN.md`'s Milestones 1–5. Within each phase, three tracks run in parallel (one per person), converging at a named integration checkpoint (`I-01`–`I-04`) before the next phase begins in earnest.
- Task IDs (`P-*`, `M-*`, `A-*`, `I-*`) match the Parallel work board in `PROJECT_PLAN.md` so status can be tracked in one place.
- "Person 1 / 2 / 3" map to the three ownership areas: **Product**, **Learner memory and backend**, **Intelligence and document analysis**. Replace with real names as soon as D-09 is resolved.

## Phase 0 — Decisions and scaffold (blocking, whole team)

Nobody should start Phase 1 until this phase's exit criterion is true: **each person can run the app locally and build their area against mocks or fixtures without waiting on another person's in-progress work.**

### 0a. Lock the decisions that gate scaffolding

These `PROJECT_PLAN.md` "Open decisions" block repo setup and must be resolved first, not deferred:

| ID | Decision | Why it blocks scaffolding |
|---|---|---|
| D-01 | Repository visibility | Determines where/how the repo is created |
| D-02 | Universal Expo app vs. separate targets | Determines the repo shape and router setup |
| D-03 | Convex vs. alternative backend | Determines whether `convex/` exists at all |
| D-04 | Initial subject (fraction addition) | Determines the seeded skill graph and fixtures |
| D-05 | Demo identity model | Determines the seeded-student data shape |
| D-09 | Assign Person 1 / 2 / 3 to real names | Everything below is assigned against these roles |
| D-11 | EAS dev/preview build distribution | Determines EAS project setup, not Expo Go |

D-06 (tutor model provider), D-07 (mastery projection), D-10 (web host), D-12 (document analyzer), and D-15 (AWS boundary) can stay "Proposed" through Phase 0 — they don't block scaffolding — but must be locked before Phase 2 (D-06, D-07) and Phase 5 (D-10) respectively. Track them, don't silently let them stay open into the phase that needs them.

Output: the "Three-person ownership" table in `PROJECT_PLAN.md` filled in with names, and the resolved D-* rows updated to Accepted.

### 0b. Repository and environment

- [ ] Create the repository per the D-01 visibility choice.
- [ ] Initialize the Expo Router + TypeScript app (D-02).
- [ ] Create the proposed repo shape: `src/app`, `src/components`, `src/features/*`, `src/domain`, `convex/` (if D-03 accepts Convex), `evals/`, `docs/decisions/`.
- [ ] Configure the Convex project and connect it to the repo (D-03).
- [ ] Set up the EAS project and a development build profile that includes the selected native document-scanner module (D-11).
- [ ] Add `.env.example` with variable names and safe placeholders only — no real values, ever (see `AWS_PLAN.md` access-key handling).
- [ ] Verify the empty shell runs on web.
- [ ] Verify the empty shell runs on at least one physical mobile device via the EAS dev build.

Suggested owners: Person 1 (product) and Person 2 (memory/backend) pair on this; it's mostly Expo/Convex plumbing. Person 3 should not be blocked waiting for this — see 0d below.

### 0c. Shared domain contracts (blocking for everyone)

This is the actual boundary the three people build against. It must be agreed upon literally, not just conceptually, before feature code starts.

- [ ] Write `src/domain/tutoring.ts`, `artifacts.ts`, `regions.ts`, `annotations.ts`, `skills.ts`, `evidence.ts`, `memory.ts` directly from the "Core contracts" and "Shared spatial contracts" sections of `PROJECT_PLAN.md`.
- [ ] Circulate for review from all three people before any feature branch depends on them — the working agreements require both sides of a boundary to review shared-contract changes.

Owner: Person 2 drafts (the learner-memory owner coordinates schema/contract changes per `PROJECT_PLAN.md`); Person 1 and Person 3 review same day.

### 0d. Deterministic fakes and fixtures (the thing that actually lets three people split)

Without these, Person 1 and Person 2 cannot build ahead of Person 3's real AI/document-analysis work — so this cannot slip to "whenever Person 3 gets to it." Prioritize it inside Phase 0, in parallel with 0b/0c.

- [ ] Deterministic fake AI tutor provider (`A-01`), implementing the `TutorModel` interface with canned, believable output.
- [ ] Fake document analyzer plus one golden fixture page with known regions (`A-06`), implementing the `DocumentAnalyzer` interface.
- [ ] Shared synthetic demo fixtures: two seeded students with different learning histories, and a small seeded skill graph for the chosen subject (D-04).

Owner: Person 3, started on day one — not after Phase 0's other scaffolding lands. Person 3 does not need the Phase 0b repo work finished to write these; they only need the domain contracts from 0c, so 0c should be drafted first-thing.

### 0e. AWS account setup and compatibility spike (parallel, no code dependency)

Nothing here depends on app code, so it should start immediately alongside 0a–0d rather than waiting for Phase 3. Full detail lives in `AWS_PLAN.md`.

- [ ] Confirm AWS account, credits, Region, and BDA quotas; create a cost budget (`AWS_PLAN.md` "Account and cost setup").
- [ ] Create the sync BDA project (`tuto-page-analysis-sync`) with text detection and bounding boxes enabled.
- [ ] Run the mandatory five-fixture sync compatibility spike.
- [ ] Record sync-accepted or async-fallback-activated as a decision (updates D-12).

Owner: Person 3 (the AWS owner per `AWS_PLAN.md`). This can run entirely decoupled from 0a–0d and should not wait on them.

**Phase 0 exit criterion:** all of 0a–0d done; 0e in progress or done. Each person can run the app locally and develop against mocks/fixtures.

---

## Phase 1 — Non-AI vertical slice (Milestone 1)

Goal: prove the learner-memory loop without a model. Tracks run in parallel; converge at `I-01`.

| Track | Tasks | Depends on |
|---|---|---|
| Person 1 (Product) | `P-01` seeded tutor conversation shell; `P-02` memory inspector against fixtures; `P-06` render the fixture page and a linked fixture annotation with no external call | Core contracts (0c) |
| Person 2 (Memory) | `M-01` skill/edge storage; `M-02` evidence storage; `M-03` deterministic skill-state projection; `M-06` artifact/page/region/scan-job storage | Backend decision, spatial contracts |
| Person 3 (Intelligence) | Harden `A-01`/`A-06` fixtures from Phase 0 into the full seeded-conversation shape; begin `A-05` golden-eval harness skeleton | A-01, A-06 |

**Checkpoint `I-01` — end-to-end fake integration:** Person 1's shell, Person 2's evidence/projection storage, and Person 3's fake provider connect into one working seeded flow: two students, same seeded activity, visibly different next-step guidance and memory-inspector state. This is Milestone 1's exit criterion — do not start Phase 2 work before it passes.

---

## Phase 2 — AI tutoring turn (Milestone 2)

Goal: replace the fake turn with one bounded, structured model call. Requires D-06 (model provider) and D-07 (mastery projection) locked before this phase starts in earnest.

| Track | Tasks | Depends on |
|---|---|---|
| Person 3 (Intelligence) | `A-02` real provider adapter; `A-03` structured tutor-turn prompt | A-01, `M-04` contract |
| Person 2 (Memory) | `M-04` teaching-brief retrieval | M-01, M-03 (done in Phase 1) |
| Person 1 (Product) | Wire the UI to the real call path; add timeout, invalid-output, and quota-failure states | I-01 |

**Checkpoint `I-02` — end-to-end real-model integration:** a real model completes the same flow demonstrated at `I-01`, with provider/model/latency/token usage/prompt version logged.

---

## Phase 3 — Scanned workspace (Milestone 3)

Goal: the tutor refers to the student's handwritten work spatially. This is the largest phase — start Person 3's AWS adapter work as early as the Phase 0e spike allows, since it does not need to wait for Person 1's UI work.

| Track | Tasks | Depends on |
|---|---|---|
| Person 1 (Product) | Capture/canonicalize a photographed page on-device; preview/confirm flow; `P-05` scanned-document workspace; `P-06` region-based annotation renderer (now against real regions); `P-07` responsive tutor side panel / bottom sheet | Artifact contract, M-06 |
| Person 2 (Memory) | `M-07` internal document-analysis scheduling flow (submit/schedule/complete mutations per `AWS_PLAN.md`'s Convex implementation boundary) | M-06 |
| Person 3 (Intelligence) | `A-07` real document-analyzer adapter (AWS BDA, per `AWS_PLAN.md`); `A-08` region grouping and crop-verification logic | A-06, Phase 0e spike result, document-provider decision (D-12) |

**Checkpoint `I-04` — scanned-page spatial tutoring integration:** a scanned handwritten solution opens in the workspace, the tutor explains one step, and the referenced step highlights on the canonical page without student selection. Depends on P-05, P-06, M-07, A-07 all landing.

---

## Phase 4 — Unknown skills (Milestone 4)

Goal: controlled curriculum growth. Can run partly overlapped with the tail of Phase 3 since it touches a different part of the schema.

| Track | Tasks | Depends on |
|---|---|---|
| Person 3 (Intelligence) | `A-04` skill resolver (existing / ambiguous / proposed) | M-01 candidate contract |
| Person 2 (Memory) | `M-05` skill proposal lifecycle (store, approve, edit, merge, reject; resolve provisional evidence) | M-01 |
| Person 1 (Product) | `P-03` skill proposal review screen | Proposal contract (M-05) |

Exit criterion: an uncovered objective is handled without creating an unchecked canonical skill.

---

## Phase 5 — Demo hardening (Milestone 5)

Goal: a reliable, repeatable demo. All three people converge here — treat it as shared work, not a fourth solo track.

- [ ] Script the full demo (fraction-addition scenario from `PROJECT_PLAN.md`).
- [ ] Seed resettable demo students.
- [ ] Add loading, empty, and error states across all screens.
- [ ] Add per-user and global inference limits (kill switch).
- [ ] Deploy and verify from a clean browser — `I-03`, depends on the web host decision (D-10).
- [ ] Run the golden personalization scenarios (`A-05`).
- [ ] Remove or hide incomplete features.
- [ ] Prepare a short architecture explanation for the demo.

**Checkpoint `I-03` — deployed demo verification.** This is the last gate before the demo is considered ready.

---

## Critical-path notes

- The Phase 0e AWS spike has no code dependency and the longest external lead time (account/credit confirmation, IAM setup, quota checks). Start it on day one, not when Phase 3 begins — starting it late is the most likely way to lose the spatial-tutoring demo feature.
- Phase 0c (domain contracts) is the true fork point. Everything in Phases 1–4 that runs in parallel depends on it being stable; treat changes to it after Phase 0 as requiring the same cross-boundary review as the working agreements specify, not a quick fix-up.
- D-06 and D-07 are still "Open," not just "Proposed" — resolve them before Phase 2 starts, or Person 3 and Person 2's Phase 2 tracks will stall on an unresolved model/projection choice.
