# Tuto Hackathon Project Plan

Last updated: 2026-08-17  
Status: Draft source of truth

## How to use this document

This file is the shared source of truth for product scope, architecture, ownership, and delivery status. Update it in the same pull request as any decision that changes those things.

Decision states:

- **Accepted**: the team is working from this decision.
- **Proposed**: the current recommendation, pending team confirmation.
- **Open**: a choice must still be made.
- **Superseded**: retained for history but no longer active.

Task states:

- `Not started`
- `In progress`
- `Blocked`
- `Done`
- `Cut`

## Product statement

Tuto is an AI-powered tutoring prototype whose defining feature is durable, inspectable memory of a student's learning. It uses prior evidence, inferred skill state, misconceptions, and goals to change how it teaches the next concept.

The prototype must demonstrate that the tutor does more than remember chat history: it maintains a structured learner model and can explain what it remembers and why.

## Confirmed constraints

- **Accepted:** This is a non-commercial hackathon prototype.
- **Accepted:** Three people will build it.
- **Accepted:** Prefer free tiers and avoid unnecessary services.
- **Accepted:** The UI is a React Native application. Convex, if selected, is backend infrastructure only.
- **Accepted:** The initial implementation should be a modular application, not microservices.
- **Accepted:** Demo data will be synthetic; the prototype is not intended to process real children's personal data.
- **Accepted:** The required input modes are chat and scanned documents.
- **Accepted:** Drawing is stretch scope only and is not required for the hackathon demo.
- **Accepted:** A scanned page is the primary workspace and tutor chat accompanies it. A blank canvas may serve as the workspace only if the drawing stretch scope is activated.
- **Accepted:** Automatic localization is the normal scan experience. Student-drawn selection is an error-recovery tool, not a required step.
- **Accepted:** A photographed notebook page is scanned and canonicalized on-device before upload. The exact resulting page image is both displayed and analyzed so annotation coordinates remain aligned.
- **Proposed:** Mobile and web should be first-class targets of one universal Expo application.

## Definition of success

The demo succeeds when it shows all of the following:

1. A student completes or discusses a learning activity.
2. The system associates the interaction with one or more explicit skills.
3. Evidence from the interaction updates the student's learner model.
4. A later tutoring response visibly changes because of that prior evidence.
5. The student can inspect what the tutor remembers and the evidence behind it.
6. An uncovered skill becomes a reviewable proposal instead of silently becoming canonical curriculum.
7. For a scanned solution, the tutor can refer to a detected step in chat and the same step visibly highlights on the page.

The strongest proof is to ask the same question as two students with different histories and receive appropriately different explanations.

## Scope

### Required for the hackathon

- One narrow subject area with a small, reviewed skill graph
- A workspace containing tutor chat and a scanned page
- Chat input and import of at least one of these formats: a photographed notebook page or a PDF page
- Automatic detection of page regions without requiring the student to draw a box
- Linked tutor annotations with at least highlight and circle treatments
- Synthetic demo students with different learning histories
- Append-only learning evidence
- Per-student, per-skill state
- Retrieval of a compact teaching brief before each tutor response
- Structured AI output containing a reply and candidate evidence
- Inspectable learner memory
- Proposed-skill creation and a minimal review flow
- A deterministic fake AI provider for local development and tests
- A scripted end-to-end demo

### Explicitly out of scope

- A broad curriculum or multiple school subjects
- Autonomous publication of AI-created canonical skills
- Production support for minors or real educational records
- Parent, teacher, school, or district administration systems
- Payments, subscriptions, or commercial deployment
- App Store publication, production signing, or a production mobile release process
- Voice or video tutoring
- Fine-tuning a model
- Microservices, Kubernetes, or self-hosted infrastructure
- Sophisticated mastery algorithms before the basic evidence loop works

### Stretch goals

- Token-by-token response streaming
- Spaced-review recommendations
- Teacher editing of the skill graph
- Rich visual explanations
- Student ink over a scanned page
- A blank drawing canvas with checkpoint-based tutor review
- Tutor arrows and short labels
- Automatic localization of an individual handwritten symbol
- Importing a small public curriculum standard
- Model/provider comparison in the evaluation harness

## Current technical direction

### Hosting decision

**Proposed:** Build one Expo/React Native application with Expo Router for iOS, Android, and web.

- Use an EAS development/preview build for the hackathon mobile demo because native document scanning is not an Expo Go-compatible capability.
- Export the web target and host it on Cloudflare Pages, Vercel Hobby, or EAS Hosting.
- Prefer Cloudflare Pages for a private repository and Vercel Hobby for a public repository if the team already prefers Vercel.
- Convex Free for backend data and functions.
- External tutor and document-analysis APIs behind provider-neutral interfaces.
- **Proposed:** Use AWS only as a document-intelligence provider from a server-side Convex action; do not move application auth, learner data, or UI hosting to AWS for the initial prototype.

The frontend host must not own learner state or tutoring domain logic.

If the universal Expo proposal is accepted, do not create separate web and mobile applications for the hackathon. Share domain logic, data hooks, design tokens, and core screens. Use platform-specific components where mobile and desktop genuinely need different navigation or layout.

### Runtime boundary

```text
Mobile camera
        |
        | native scan: detect edges, correct perspective, crop, rotate
        v
Canonical JPEG preview in React Native UI
        |
        | confirm and upload exact page bytes
        v
Backend orchestration
        |
        +--> retrieve skills, evidence, and learner state
        |
        +--> call tutor model with a bounded teaching brief
        |
        +--> call document analyzer for page regions when needed
        |
        +--> validate and persist reply, regions, annotations, and candidate evidence
        v
React Native UI updates from stored result
```

### Backend recommendation

**Proposed:** Convex Free.

Reasons:

- It covers database, backend functions, scheduling, realtime subscriptions, and text/vector search.
- Its free plan supports the three-person team.
- It avoids operating a separate API server, queue, and vector database during the hackathon.

Guardrails:

- Do not let Convex abstractions dictate the UI architecture.
- Keep shared domain contracts separate from persistence details.
- Keep an export path for skills, evidence, and learner-state projections.
- Do not use a generic agent-memory abstraction as the canonical learner model.
- Invoke external document services only from internal backend actions, never from the mobile or web client.

### Frontend recommendation

**Proposed:** Expo, React Native, Expo Router, React Native Web, and TypeScript.

- Treat the student experience as universal across mobile and web.
- Allow the dense skill-review interface to have a web-specific layout.
- Use responsive containers so the web version does not look like a stretched phone screen.
- Use platform-specific files for navigation, keyboard behavior, and other real platform differences.
- Use an EAS development build and a thin React Native wrapper around the native iOS and Android document scanners.
- On mobile, return one canonical JPEG per captured page after edge detection, perspective correction, cropping, and rotation. Ordinary camera/photo-library import remains a fallback.
- On web, initially support file upload and camera capture; do not make browser-based automatic document scanning a demo dependency.
- Defer a separate Next.js marketing or administration application until after the hackathon.
- Use responsive workspace layouts: side-by-side page and chat on desktop or tablet landscape, a collapsible bottom panel on tablet portrait, and a tutor bottom sheet on phones.
- Render tutor annotations as structured overlays; do not ask the model to generate arbitrary pen strokes.

### AI recommendation

**Proposed:** Use a small provider interface so hackathon credits or model availability can change without rewriting tutoring logic.

```ts
interface TutorModel {
  generateTurn(input: TutorModelInput): Promise<TutorModelOutput>;
}

interface DocumentAnalyzer {
  analyze(input: DocumentAnalysisInput): Promise<AnalyzedPage[]>;
}
```

Development and automated tests use a deterministic fake implementation. Real inference is opt-in through environment configuration.

AWS-specific account setup, IAM, credentials, service deployment, and verification are isolated in [`AWS_PLAN.md`](AWS_PLAN.md). The rest of the team should be able to build against the contracts below without knowing AWS response formats.

## Multimodal workspace and spatial tutoring

### Workspace layout

The scanned document is primary. Tutor chat is a linked explanatory channel rather than a separate experience. A blank canvas can take the document's place only if the drawing stretch scope is activated.

```text
Desktop or tablet landscape

┌─────────────────────────────────┬──────────────────┐
│                                 │ Tutor            │
│      Document                   │                  │
│                                 │ “Check the sign  │
│      [ highlighted step ] <─────┤ in this step.”   │
│                                 │                  │
└─────────────────────────────────┴──────────────────┘
```

Tutor messages reference annotations. Tapping a message pulses and focuses its annotation; tapping an annotation opens or scrolls to its explanation.

### Canonical pages and layers

Every captured notebook page becomes a canonical page image before upload. The mobile native scanner performs edge detection, perspective correction, cropping, and rotation locally, then returns one JPEG per page for preview and confirmation. This is image preparation, not OCR; text and geometry extraction happen after upload.

An imported PDF is a separate input path. Each displayed PDF page must be rasterized into a canonical page image before spatial annotations are attached to it. For the fastest hackathon path, prove the single photographed-page JPEG flow first and add PDF import only if time permits within the required document-import scope.

The exact canonical page revision uploaded for analysis must also be the immutable base image rendered in the workspace. Never crop, rotate, deskew, or replace it after analysis. A rescan or edit creates a new revision and invalidates the prior analysis.

```text
Mobile capture
    |
    v
Native document scanner on device
    |
    | edge detection + perspective correction + crop + rotation
    v
Canonical JPEG preview
    |
    | student confirms
    v
Upload and persist exact bytes
    |                         \
    v                          v
Workspace base image       Document analyzer
    |                          |
    +---------- same revision-+
                               |
                               v
                     normalized page regions
```

```text
Interaction and fallback-selection layer
Tutor annotation layer
Student ink layer (stretch scope)
Canonical base layer: scan or PDF page; blank canvas in stretch scope
```

The base page is immutable. Student ink and tutor annotations are separate, removable records.

### Automatic localization pipeline

```text
Canonical page
      |
      v
Document analyzer returns text and geometry; a semantic pass groups mathematical work when needed
      |
      v
Provider adapter normalizes all coordinates to 0–1
      |
      v
Application groups regions into problem, step, line, term, and diagram
      |
      v
Tutor chooses stable region IDs
      |
      v
Client deterministically renders highlight, circle, underline, arrow, or focus
```

The proposed AWS analyzer is Bedrock Data Automation (BDA) standard output with text detection and bounding boxes enabled. The sync-first path treats the canonical JPEG as an image and converts BDA line and word locations into the contracts below. An asynchronous document-mode fallback can additionally return page and layout elements for PDFs. A separate multimodal model pass may interpret mathematical meaning and group detected regions into problems and solution steps, but it must reference normalized regions rather than inventing display coordinates.

The AI normally returns a `targetRegionId`, not display coordinates. If an exact subterm is required, analyze a high-resolution crop, convert the crop-local bounds into page coordinates, store the result as a child region, and verify it before rendering. If precision is low, highlight the containing equation or step rather than pretending to identify one symbol.

### Shared spatial contracts

```ts
type NormalizedPoint = {
  x: number; // 0–1 from the canonical page's left edge
  y: number; // 0–1 from the canonical page's top edge
};

type NormalizedBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ArtifactPage = {
  id: string;
  artifactId: string;
  pageNumber: number;
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  revision: number;
};

type PageRegion = {
  id: string;
  pageId: string;
  parentRegionId?: string;
  revision: number;
  kind: "problem" | "solution_step" | "equation" | "term" | "prose" | "diagram";
  polygon: NormalizedPoint[];
  bounds: NormalizedBounds;
  transcription?: string;
  latex?: string;
  confidence?: number;
  source: "document_analyzer" | "text_detector" | "combined" | "derived";
};

type TutorAnnotation = {
  id: string;
  pageId: string;
  targetRegionId: string;
  messageId: string;
  kind: "highlight" | "circle" | "underline" | "arrow" | "focus" | "label";
  label?: string;
};

type TutorMessage = {
  id: string;
  text: string;
  annotationIds: string[];
};
```

Raw provider responses stop at the document-analyzer adapter. Persist and expose only these shared contracts so a provider can change without rewriting the workspace.

### Rendering strategy

Use a lightweight SVG overlay for the initial annotation renderer. Highlights, ellipses, paths, arrows, and labels are deterministic transformations of a stored region. The page and every overlay layer must share the same zoom and pan transform.

Do not require a full drawing engine for the annotation MVP. Add a richer canvas implementation only if the drawing stretch scope is activated. Drawing analysis should be checkpoint-based: the student taps “Check my work,” the application snapshots the canvas, and the tutor responds to that revision.

## Learner-memory model

The system separates facts from estimates.

### Session memory

Temporary context for the current conversation or activity.

Examples:

- Current problem
- Current learning objective
- Hints already shown

### Learning evidence

Append-only observations from student interactions.

Examples:

- Correct answer without assistance
- Correct answer after two hints
- Explanation that reveals a misconception
- Student self-report, clearly marked as self-report

### Student skill state

A derived estimate for one student and one skill.

```ts
type StudentSkillState = {
  studentId: string;
  skillId: string;
  mastery: number | null;
  confidence: number;
  evidenceCount: number;
  lastPracticedAt?: string;
  misconceptionIds: string[];
  supportingEvidenceIds: string[];
  modelVersion: string;
};
```

`mastery: null` means unknown. A student with no evidence must not be treated as having zero mastery.

### Durable learner facts and preferences

Explicit or high-confidence information that can affect teaching, such as a current goal or an accessibility preference. Preferences must be editable and must not become permanent stereotypes such as a fixed "learning style."

### Episodic summaries

Compact summaries of important past interactions. Embed summaries selectively; do not embed every chat message.

## Skill model

A skill is a shared curriculum object. A student skill state is the student's relationship to that object.

```ts
type Skill = {
  id: string;
  namespace: string;
  status: "proposed" | "active" | "merged" | "deprecated";
  name: string;
  objective: string;
  subject: string;
  level?: string;
  aliases: string[];
  version: number;
  createdBy: "human" | "ai";
  sourceReference?: string;
};
```

Skills should be atomic, observable, assessable, and reusable. Relationships are stored separately:

```ts
type SkillEdge = {
  fromSkillId: string;
  toSkillId: string;
  kind: "requires" | "part_of" | "related_to";
  confidence: number;
  rationale?: string;
};
```

### Unknown-skill lifecycle

```text
Extract atomic learning objective
        |
        v
Search aliases and active skill text
        |
        v
Retrieve semantic candidates if needed
        |
        v
AI returns existing, ambiguous, or proposed
        |
        +--> existing: attach evidence to stable skill ID
        +--> ambiguous: retain for review without a mastery claim
        +--> proposed: create a provisional skill record
                              |
                              v
                   approve, edit, merge, or reject
```

Runtime AI may create a proposal. It may not activate a canonical skill automatically.

When a proposal is merged, retain a redirect to the canonical skill so historical references remain explainable.

## Core contracts

These contracts form the boundaries between the three work areas and should be agreed upon before major implementation.

```ts
type TutorTurnInput = {
  studentId: string;
  threadId: string;
  message: string;
  activityId?: string;
  artifactContext?: {
    artifactId: string;
    pageId: string;
    activeRegionIds?: string[];
  };
};

type TeachingBrief = {
  currentSkillIds: string[];
  skillStates: StudentSkillState[];
  prerequisiteGaps: StudentSkillState[];
  activeMisconceptions: string[];
  relevantEpisodes: string[];
};

type NewSkillProposal = {
  suggestedName: string;
  objective: string;
  whyExistingSkillsDoNotFit: string;
  prerequisiteCandidateIds: string[];
  aliases: string[];
  positiveExamples: string[];
  sourceMessageIds: string[];
};

type SkillResolution =
  | { decision: "existing"; skillId: string; confidence: number }
  | { decision: "ambiguous"; candidateIds: string[]; reason: string }
  | { decision: "proposed"; proposal: NewSkillProposal };

type CandidateLearningEvidence = {
  skillId: string;
  outcome: "correct" | "partial" | "incorrect" | "unclear";
  independence: "independent" | "hinted" | "demonstrated";
  confidence: number;
  rationale: string;
};

type TutorTurnResult = {
  reply: string;
  skillResolutions: SkillResolution[];
  candidateEvidence: CandidateLearningEvidence[];
  annotations: TutorAnnotation[];
};
```

AI-produced evidence is a candidate. Application code validates it before persistence, and deterministic projection code updates skill state.

## Three-person ownership

Replace role labels with names when the team assigns them.

| Work area | Primary owner | Responsibilities | Main consumers |
|---|---|---|---|
| Product experience | Person 1 | Workspace UI, chat, annotation renderer, memory inspector, responsive layouts, accessibility, demo flow | Memory, artifact, and AI contracts |
| Learner memory and backend | Person 2 | Schema, application authorization, artifacts, scan jobs, skills, evidence, projections, retrieval, exports | Product and AI |
| Intelligence and document analysis | Person 3 | Tutor and document-analyzer adapters, prompts, region interpretation, skill resolution, evidence extraction, evaluations, AWS integration | Product and memory |

Shared-contract changes require review from both sides of the boundary. The learner-memory owner coordinates schema changes because the schema is a likely merge hotspot.

## Proposed repository shape

```text
src/
  app/                         # Expo Router routes
  components/                  # Product experience
  features/
    tutor/
    workspace/
    annotations/
    document-import/
    learner-memory/
    skill-review/
  domain/                      # Shared contracts
    tutoring.ts
    artifacts.ts
    regions.ts
    annotations.ts
    skills.ts
    evidence.ts
    memory.ts

convex/                        # Present only if Convex is accepted
  schema.ts
  skills/
  learners/
  tutoring/
  artifacts/
  document-analysis/
  ai/

evals/
  fixtures/
  skill-resolution/
  personalization/

docs/
  decisions/

AWS_PLAN.md                    # AWS-only setup, IAM, deployment, and operations
```

This is a proposed shape, not permission to scaffold it before the hosting and framework decisions are accepted.

## Delivery plan

### Milestone 0: Decisions and scaffold

Goal: all three people can work independently without waiting for live integrations.

- [ ] Decide whether the repository is public or private.
- [ ] Accept or replace the Expo universal-app proposal.
- [ ] Select the web host for the Expo web export.
- [ ] Accept or replace Convex as the backend.
- [ ] Select the initial subject and skill set.
- [ ] Assign names to the three ownership areas.
- [ ] Agree on the core contracts.
- [ ] Agree on the canonical page, region, and annotation contracts.
- [ ] Create the repository scaffold and developer setup.
- [ ] Verify the empty shell on web and at least one physical mobile device.
- [ ] Configure an EAS development build that includes the selected native document-scanner module.
- [ ] Add a deterministic fake AI provider.
- [ ] Add a fake document analyzer and a fixture page with known regions.
- [ ] Add shared synthetic demo fixtures.

Exit criterion: each person can run the application locally and develop their area against mocks or fixtures.

### Milestone 1: Non-AI vertical slice

Goal: prove the learner-memory loop without relying on a model.

- [ ] Show a seeded tutor conversation.
- [ ] Record a learning-evidence event.
- [ ] Recalculate a student skill state deterministically.
- [ ] Display the state and supporting evidence in the memory inspector.
- [ ] Show different next-step guidance for two seeded students.
- [ ] Render a fixture page and a linked fixture annotation without calling an external service.

Exit criterion: the differentiating memory behavior works using deterministic fixtures.

### Milestone 2: AI tutoring turn

Goal: replace the fake turn with one bounded, structured model call.

- [ ] Retrieve a teaching brief.
- [ ] Generate a student-facing response.
- [ ] Return structured candidate evidence.
- [ ] Validate and persist the result.
- [ ] Handle timeout, invalid output, and quota failure gracefully.
- [ ] Log provider, model, latency, token usage, and prompt version.

Exit criterion: a real model completes the same flow demonstrated in Milestone 1.

### Milestone 3: Scanned workspace

Goal: demonstrate the tutor referring to the student's handwritten work spatially.

- [ ] Capture and canonicalize one photographed notebook page on-device into a JPEG.
- [ ] Preview and confirm the canonical JPEG before upload.
- [ ] Persist and display the exact bytes sent for document analysis.
- [ ] Keep ordinary photo upload as a fallback; add PDF import only after the JPEG path works.
- [ ] Create and persist a document-analysis job.
- [ ] Normalize provider geometry into `PageRegion` records.
- [ ] Group detected content into at least problem and solution-step regions.
- [ ] Have the tutor return an annotation referencing a region ID.
- [ ] Render linked highlight and circle treatments over the canonical page.
- [ ] Focus or pulse an annotation from its chat message.
- [ ] Fall back to a broader region when exact localization confidence is low.
- [ ] Cache document analysis by page revision.

Exit criterion: a scanned handwritten solution opens in the workspace, the tutor explains one step, and the referenced step highlights without student selection.

### Milestone 4: Unknown skills

Goal: demonstrate controlled curriculum growth.

- [ ] Search existing skills by alias and text.
- [ ] Retrieve semantic candidates when needed.
- [ ] Resolve to existing, ambiguous, or proposed.
- [ ] Store proposed skills without affecting canonical mastery.
- [ ] Review, edit, merge, approve, or reject a proposal.
- [ ] Resolve provisional evidence after approval or merge.

Exit criterion: an uncovered objective can be handled without creating an unchecked canonical skill.

### Milestone 5: Demo hardening

Goal: deliver a reliable, understandable hackathon demonstration.

- [ ] Script the full demo.
- [ ] Seed resettable demo students.
- [ ] Add loading, empty, and error states.
- [ ] Add per-user and global inference limits.
- [ ] Verify the deployed app from a clean browser.
- [ ] Run the golden personalization scenarios.
- [ ] Remove or hide incomplete features.
- [ ] Prepare a short architecture explanation.

Exit criterion: the demo can be repeated from a known starting state without manual database repair.

## Parallel work board

| ID | Task | Owner | Status | Depends on |
|---|---|---|---|---|
| P-01 | Tutor conversation shell | Product | Not started | Core contracts |
| P-02 | Learner-memory inspector | Product | Not started | Memory fixtures |
| P-03 | Skill proposal review screen | Product | Not started | Proposal contract |
| P-04 | Responsive web/native application shell | Product | Not started | Frontend decision |
| P-05 | Scanned-document workspace | Product | Not started | Artifact contract |
| P-06 | Region-based annotation renderer | Product | Not started | Region and annotation fixtures |
| P-07 | Responsive tutor side panel and bottom sheet | Product | Not started | P-05 |
| M-01 | Skill and edge storage | Memory | Not started | Backend decision |
| M-02 | Learning-evidence storage | Memory | Not started | Core contracts |
| M-03 | Deterministic learner-state projection | Memory | Not started | M-02 |
| M-04 | Teaching-brief retrieval | Memory | Not started | M-01, M-03 |
| M-05 | Skill proposal lifecycle | Memory | Not started | M-01 |
| M-06 | Artifact, page, region, and scan-job storage | Memory | Not started | Spatial contracts |
| M-07 | Internal document-analysis scheduling flow | Memory | Not started | M-06 |
| A-01 | Fake model provider | Intelligence | Not started | Core contracts |
| A-02 | Real provider adapter | Intelligence | Not started | Model decision |
| A-03 | Structured tutor-turn prompt | Intelligence | Not started | A-01, M-04 contract |
| A-04 | Skill resolver | Intelligence | Not started | M-01 candidate contract |
| A-05 | Golden personalization evaluations | Intelligence | Not started | Shared fixtures |
| A-06 | Fake document analyzer and golden region fixture | Intelligence | Not started | Spatial contracts |
| A-07 | Real document-analyzer adapter | Intelligence | Not started | A-06, document provider decision |
| A-08 | Region grouping and crop-verification logic | Intelligence | Not started | A-07 |
| I-01 | End-to-end fake integration | Shared | Not started | P-01, M-02, A-01 |
| I-02 | End-to-end real-model integration | Shared | Not started | I-01, A-02, A-03, M-04 |
| I-03 | Deployed demo verification | Shared | Not started | Hosting decision, I-02 |
| I-04 | Scanned-page spatial tutoring integration | Shared | Not started | P-05, P-06, M-07, A-07 |

## Demo scenario

Initial narrow scenario: fraction addition, subject to team confirmation.

1. Student A previously added numerators and denominators directly.
2. Student B understands equivalent fractions but makes arithmetic slips.
3. Student A uploads a handwritten attempt at `1/2 + 1/3`; Student B asks about the same problem in chat.
4. Student A receives a visual prerequisite explanation and the incorrect handwritten step highlights on the page.
5. Student B receives a shorter procedural reminder and a check-your-work prompt.
6. The memory inspector shows the evidence supporting each choice.
7. A question from an uncovered topic creates a proposed skill for review.

## Working agreements

- Keep `main` runnable and deployable.
- Prefer small pull requests that change one owned boundary.
- Review across boundaries: Product reviews user-visible behavior, Memory reviews persistence, and Intelligence reviews AI behavior and evaluations.
- Do not commit API keys or real student information.
- Do not expose document-provider credentials or raw provider APIs to the client.
- Keep `.env.example` current once the scaffold exists.
- Use fake inference by default in automated tests.
- Do not run paid or quota-limited evaluations automatically on every commit.
- Add prompt versions to logged AI results.
- Version canonical pages and reject annotations whose region revision does not match the displayed page revision.
- Keep one checked-in synthetic page plus expected region JSON so Product, Memory, and Intelligence can integrate independently.
- Update this plan when scope, ownership, or architecture changes.
- Record important irreversible decisions under `docs/decisions/` once that directory exists.

## Cost and quota guardrails

- One model call per normal tutor turn for the initial implementation.
- Use deterministic code for mastery projection.
- Use exact and text search before vector search.
- Embed canonical skills once and episodic summaries selectively.
- Never embed every message by default.
- Add per-user turn limits and a global demo kill switch.
- Store model name, token usage, latency, and failure reason for each real call.
- Analyze a page once per canonical revision and reuse its stored regions across tutor turns.
- Run high-resolution crop analysis only when a tutor response needs finer localization.
- Keep synthetic fallback responses so the demo survives provider failure.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Scope expands beyond one learning domain | Core memory loop remains unfinished | Enforce required versus stretch scope |
| AI creates duplicate or vague skills | Skill graph becomes unusable | Proposal state, candidate retrieval, and human review |
| AI inference fails during the demo | Demo stops | Recorded/fake fallback and resettable scenarios |
| Team blocks on integration | Work converges too late | Contract-first interfaces and daily integration |
| Free-tier quota is exhausted | Backend or model calls fail | Usage limits, compact context, selective embeddings |
| Learner state appears arbitrary | Personalization is unconvincing | Preserve evidence and show provenance in the UI |
| No-evidence students are labeled weak | Misleading teaching behavior | Represent mastery as unknown until evidence exists |
| Real student information enters the prototype | Privacy and policy exposure | Synthetic demo identities and explicit data rule |
| Handwritten maths is transcribed incorrectly | Tutor explains the wrong work | Preserve the image, record confidence, verify important crops, and avoid treating transcription as ground truth |
| Annotation coordinates drift after crop, resize, or zoom | Tutor points at the wrong location | Use one canonical page revision, normalized coordinates, and a shared render transform |
| Precise symbol localization is unreliable | Spatial feature feels deceptive | Prefer step or equation highlights and require verification before symbol-level circles |

## Open decisions

| ID | Decision | Options | Owner | Status |
|---|---|---|---|---|
| D-01 | Repository visibility | Public / Private | Team | Accepted: Public |
| D-02 | Frontend architecture | Universal Expo React Native app / separate React Native targets | Product owner | Proposed: Universal Expo React Native app |
| D-03 | Backend | Convex / Supabase / other | Memory owner | Proposed: Convex |
| D-04 | Initial subject | Fraction addition / other narrow area | Team | Proposed: Fraction addition |
| D-05 | Demo identity | Seeded anonymous users / invite-code accounts | Product owner | Proposed: Seeded anonymous users |
| D-06 | Tutor model provider | Bedrock / hackathon sponsor / capped external API | Intelligence owner | Open |
| D-07 | Mastery projection | Transparent weighted score / simpler evidence labels | Memory owner | Open |
| D-08 | Response streaming | Deferred / required | Product owner | Proposed: Deferred |
| D-09 | Team ownership names | Assign Person 1, 2, and 3 | Team | Open |
| D-10 | Web host for Expo export | Cloudflare Pages / Vercel Hobby / EAS Hosting | Product owner | Open |
| D-11 | Mobile demo distribution | Expo Go / EAS development and preview builds | Product owner | Proposed: EAS development and preview builds; required by native document scanning |
| D-12 | Document analyzer | AWS BDA / another provider | Intelligence owner | Accepted: synchronous AWS BDA standard output plus a Nova transcription/LaTeX pass, validated by the `coordinateTest` spike; async BDA remains a tested fallback |
| D-13 | Annotation renderer | SVG overlay / richer canvas engine | Product owner | Proposed: SVG overlay |
| D-14 | Drawing scope | Student ink over scans / blank canvas / both | Team | Accepted: Stretch scope only; implementation form remains open |
| D-15 | AWS integration boundary | Direct internal Convex action / Lambda scan service | Intelligence owner | Proposed: Direct Convex action for hackathon |

## Decision log

| Date | ID | Decision | State | Rationale |
|---|---|---|---|---|
| 2026-08-17 | DEC-001 | Build a non-commercial hackathon prototype with three people | Accepted | Defines cost, scope, and collaboration priorities |
| 2026-08-17 | DEC-002 | Treat structured learner memory as the product differentiator | Accepted | Chat history alone does not provide reliable personalization |
| 2026-08-17 | DEC-003 | Keep the React Native presentation layer independent of backend services | Accepted | Prevents backend tooling from dictating UI architecture |
| 2026-08-17 | DEC-004 | AI-created skills begin as proposals | Accepted | Prevents uncontrolled and duplicate curriculum growth |
| 2026-08-17 | DEC-005 | Prefer a modular application over microservices | Accepted | Minimizes hackathon infrastructure and integration work |
| 2026-08-17 | DEC-006 | Build one universal Expo application for mobile and web | Proposed | Avoids duplicating product UI while mobile is still a first-class goal |
| 2026-08-17 | DEC-007 | Make the scanned page primary and link tutor chat to spatial annotations; keep the blank canvas in stretch scope | Accepted | Preserves reliable chat while making visual tutoring materially different from an image attachment |
| 2026-08-17 | DEC-008 | Automatically localize scanned work and use student selection only as recovery | Accepted | Manual region selection creates unnecessary friction and weakens the product experience |
| 2026-08-17 | DEC-009 | Normalize provider geometry into stable page-region IDs before tutor use | Accepted | Keeps coordinates deterministic, provider-independent, and renderable across screen sizes |
| 2026-08-17 | DEC-010 | Keep AWS as a replaceable document-analysis subsystem for the prototype | Proposed | Uses available AWS credits without forcing app data, auth, hosting, or UI onto AWS |
| 2026-08-17 | DEC-011 | Canonicalize photographed pages on-device before upload and display the exact analyzed image revision | Accepted | Native scanning gives a clean page while preserving one coordinate system from analysis through rendering |
| 2026-08-17 | DEC-012 | Use BDA standard output as the AWS text-and-geometry extractor, trying sync first for canonical page images | Proposed | Single-page JPEGs do not justify S3 job orchestration unless the sync compatibility spike fails |
| 2026-08-17 | DEC-013 | Adopt the public repository visibility for the main application | Accepted | Simplifies Vercel Hobby hosting for the Expo web export if selected |
| 2026-08-17 | DEC-014 | Accept synchronous BDA plus a Nova transcription/LaTeX pass as the document-analysis path | Accepted | The `coordinateTest` spike proved the inline-byte sync round trip and Nova region-referenced LaTeX end to end against real photographed pages |

## Reference links

- [Convex free-tier limits](https://docs.convex.dev/production/state/limits)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel collaboration behavior](https://vercel.com/docs/deployments/troubleshoot-project-collaboration)
- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Supabase pricing](https://supabase.com/pricing)
- [Expo Router](https://docs.expo.dev/router/introduction/)
- [Expo web static rendering](https://docs.expo.dev/router/web/static-rendering/)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Google ML Kit document scanner](https://developers.google.com/ml-kit/vision/doc-scanner/android)
- [Convex React Native quickstart](https://docs.convex.dev/quickstart/react-native)
- [AWS integration and deployment plan](AWS_PLAN.md)

## Change log

- **2026-08-17:** Created the initial written source of truth from the product, architecture, hosting, memory, skill-creation, and three-person collaboration discussions.
- **2026-08-17:** Proposed Expo and React Native Web as the universal frontend so the hackathon can target mobile and web without separate applications.
- **2026-08-17:** Added the scanned-document workspace, automatic region localization, normalized spatial contracts, linked tutor annotations, and checkpoint-based drawing scope.
- **2026-08-17:** Separated provider-independent product architecture from AWS-specific IAM and deployment instructions in `AWS_PLAN.md`.
- **2026-08-17:** Clarified that drawing is stretch-only, the required document import may be either a photographed page or a PDF page, and the frontend is React Native.
- **2026-08-17:** Defined on-device document capture, canonical JPEG revision handling, EAS development builds, and synchronous BDA-first document analysis with an asynchronous fallback.
- **2026-08-17:** Accepted public repository visibility (D-01) and accepted synchronous BDA plus a Nova transcription/LaTeX pass (D-12) after the `coordinateTest` spike validated the round trip; the spike's deployed AWS stack was torn down afterward.
