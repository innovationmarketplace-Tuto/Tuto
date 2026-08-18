# Tuto AWS Integration Plan

Last updated: 2026-08-17  
Status: Development infrastructure provisioned; production rollout remains gated

## Purpose and scope

This file is the source of truth for AWS account setup, Bedrock Data Automation (BDA), IAM, credentials, deployment, verification, incident response, and teardown.

Provider-independent product behavior, spatial contracts, learner memory, team ownership, and delivery scope remain in [`PROJECT_PLAN.md`](PROJECT_PLAN.md). Raw BDA responses must stop at the document-analyzer adapter defined there.

## Decision summary

- **Accepted:** the `coordinateTest/` spike (a disposable Lambda + API Gateway + CDK harness, since torn down) validated the synchronous BDA + Nova round trip against real photographed pages: JPEG in, normalized regions and region-referenced LaTeX out, rendered correctly in a local SVG overlay. This satisfies the mandatory sync compatibility spike below. The application itself must still call BDA from an internal Convex action, not from a standalone Lambda — the spike's own Lambda/API Gateway boundary was only a convenient harness for the test, not the accepted integration boundary (see D-15).
- Use BDA, not Textract, for text detection and spatial geometry.
- The primary MVP input is one canonical JPEG produced by the mobile device scanner before upload.
- Try synchronous BDA first: pass the JPEG bytes and receive inline JSON in one internal Convex action.
- Configure BDA image processing with text detection and bounding boxes. Force JPEG and PNG inputs to the image modality for this first spike so a photographed page is not rejected after being semantically classified as a document.
- Add an optional multimodal model pass only for mathematical interpretation and grouping detected regions into problems and steps. It must not invent UI coordinates.
- Use asynchronous BDA with S3 only if the sync spike fails or the MVP retains multi-page PDF processing.
- Keep application identity, authorization, files, learner memory, and orchestration in Convex. Do not add Cognito, Lambda, API Gateway, or DynamoDB for the initial path.
- **Implemented:** [`infra/aws/`](infra/aws/README.md) deploys the accepted
  application boundary as `TutoAwsStack`: one synchronous BDA project, one
  restricted Convex workload identity/policy, and one monthly cost budget. It
  deliberately omits the spike's Lambda and API Gateway and never creates an
  access key in CloudFormation.

AWS documentation currently describes both synchronous document limits and a sync API restriction to image processing. Because those pages are inconsistent, compatibility with a scanned handwritten-page JPEG is a mandatory spike, not an assumption. The accepted implementation is sync only after it passes the fixture gate below.

## Initial architecture

```text
Phone camera
    |
    | native document scan on device
    | edge detection, perspective correction, crop, rotation, compression
    v
Canonical JPEG preview
    |
    | confirm and upload exact bytes
    v
Convex storage + ArtifactPage revision
    |
    v
Convex internal Node action -- AWS SDK/SigV4 --> synchronous BDA
    |                                             text + line/word boxes
    v
BDA adapter normalizes output into PageRegion records
    |
    +--> optional semantic model groups regions into problems and steps
    v
Convex internal mutation stores analysis
    |
    v
Client renders annotations over the same canonical JPEG revision
```

The browser and mobile clients never receive AWS credentials and never invoke BDA directly. A student authenticates to Convex; the internal Convex action authenticates to AWS as a restricted workload identity. Lambda is not required for this path.

## Capture is not AWS analysis

The device performs the scan before anything reaches AWS:

1. Open the native iOS or Android document-scanner UI.
2. Detect the page edges and automatically capture or let the student press the shutter.
3. Correct perspective, crop, rotate, and apply restrained image cleanup locally.
4. Encode one JPEG per page. Before locking the revision, resize or compress it to the BDA image limits: no more than 5 MB and no more than 8K resolution.
5. Show that exact JPEG for confirmation.
6. Upload and persist those exact bytes as the immutable canonical page revision.
7. Send those same bytes to BDA and display the same revision behind every annotation.

Do not run another crop, rotation, or image enhancement after analysis. A rescan or edit creates a new page revision and requires new analysis. This rule is what makes BDA's normalized coordinates line up with the UI.

The web MVP may upload an existing JPEG or PNG. PDF import uses the asynchronous fallback unless the compatibility spike proves the synchronous document path reliable.

## Initial AWS service boundary

| Service | Initial status | Purpose |
|---|---|---|
| Amazon Bedrock Data Automation | Required, proposed | Detect text and return normalized line/word bounding boxes from canonical page images |
| AWS IAM | Required | Authenticate and restrict the Convex workload |
| AWS Budgets | Required | Alert before accidental spend grows |
| Amazon Bedrock Runtime model | Optional | Interpret handwritten mathematics and group BDA regions semantically |
| Amazon S3 | Deferred | Required only for asynchronous BDA input and output |
| AWS Lambda | Deferred | Optional hardened AWS boundary if the prototype continues |
| API Gateway | Deferred | Entry point only if the Lambda boundary is built |
| EventBridge/SNS/SQS | Deferred | Optional async completion mechanism; Convex polling is simpler initially |
| Cognito, DynamoDB, AppSync, Amplify | Not planned | Application auth, data, realtime state, and hosting remain outside AWS |

Do not introduce a deferred service merely because AWS credits are available.

## Ownership and team access

- The Intelligence and document-analysis owner is the AWS owner and owns the BDA adapter.
- The Learner memory and backend owner reviews the Convex job boundary and normalized result contract.
- The Product owner builds against fake `PageRegion` fixtures and does not need AWS access.
- Do not share the AWS root user or root credentials.
- Require MFA on the root account and every human administrator.
- Prefer one human AWS administrator for the hackathon. Add named IAM Identity Center access only when another teammate genuinely needs the console.
- Record any console change that affects the application in this file.

Personal Convex deployments use the fake analyzer by default. Real AWS credentials belong only in the AWS owner's integration deployment and the shared demo deployment.

## Account and cost setup

Before creating programmatic credentials:

1. Confirm the promotional-credit balance, expiration date, and eligible services.
2. Select one AWS account for the prototype.
3. Choose and record one BDA source Region.
4. Confirm BDA availability and quotas in that Region.
5. Create a monthly AWS Cost Budget with warning and critical email thresholds.
6. Confirm cross-Region inference is acceptable for the synthetic demo data.
7. Record the current BDA and optional model quotas.

Proposed configuration:

```text
AWS account ID: <record securely>
AWS source Region: us-west-2, subject to the BDA smoke test
BDA geography: US
BDA profile ARN: arn:aws:bedrock:us-west-2:<ACCOUNT_ID>:data-automation-profile/us.data-automation-v1
BDA sync project name: tuto-page-analysis-sync
BDA sync project stage: LIVE
Cost budget warning: <team-selected amount>
Cost budget critical: <team-selected amount>
AWS owner: <name>
```

The development stack is deployed in `us-west-2`. Its generated project/profile
ARNs and approved Nova model ID are stored as Convex development environment
configuration. The workload has one active access key stored only in Convex;
provider smoke tests passed through that least-privilege policy. Budget contact
details remain a NoEcho CloudFormation parameter and are not committed here.

Budgets are alerts, not hard spending caps. The backend must also have a kill switch, idempotency, and per-user scan limits.

## BDA synchronous project setup

Create one `SYNC` BDA project named `tuto-page-analysis-sync`. Create it as an administrator; the Convex workload identity must not have project-creation permissions.

Configure standard image output as follows:

```json
{
  "image": {
    "extraction": {
      "category": {
        "state": "ENABLED",
        "types": ["TEXT_DETECTION"]
      },
      "boundingBox": {
        "state": "ENABLED"
      }
    },
    "generativeField": {
      "state": "DISABLED"
    }
  }
}
```

Also configure modality routing so JPEG and PNG files use the `IMAGE` modality during the sync-first spike. This avoids relying on the currently inconsistent synchronous-document behavior. Record the resulting project ARN after its status is `COMPLETED`.

Do not add a custom blueprint initially. Standard output already supplies text lines, words, confidence, polygons, and bounding boxes. A blueprint is useful only if an evaluation later proves it improves a stable, well-defined extraction task.

The runtime request uses:

- `InvokeDataAutomation`
- the exact sync project ARN and `LIVE` stage
- the US data-automation profile ARN for the source Region
- inline canonical JPEG bytes in `inputConfiguration.bytes`
- no S3 output configuration, so JSON returns inline

## Mandatory sync compatibility spike

Before building the complete adapter, run a small vertical spike with at least five synthetic photographed notebook pages:

- clear and messy handwriting
- pencil and pen
- lined and blank paper
- fractions, exponents, negative signs, and crossed-out work
- good and poor lighting

The spike passes only if:

1. Every canonical JPEG is accepted by `InvokeDataAutomation` as an image.
2. The response contains useful line or word text and normalized geometry.
3. Stored boxes render over the same words on the exact canonical JPEG.
4. Median latency is acceptable for a user waiting on a single-page analysis.
5. Errors can be surfaced without losing the uploaded page.

If the sync image path passes, it is the MVP implementation. If it fails because of modality routing, output quality, input limits, or latency, activate the asynchronous BDA fallback. Do not add Textract as a fallback.

## Mathematical interpretation

BDA is the source of detected text geometry, but its transcription is not mathematical ground truth. Start by grouping nearby BDA lines deterministically using reading order, vertical gaps, and containment. If that is insufficient, send the canonical page plus a compact list of BDA region IDs and transcriptions to a multimodal model.

The semantic model may return:

- the likely problem statement
- solution-step groupings
- normalized mathematical transcription or LaTeX
- likely error and explanation
- references to existing BDA region IDs

It may not return arbitrary display coordinates. The adapter derives any composite step bounds from the BDA regions it references. Prefer a larger verified equation or step over a falsely precise symbol box.

Tutor-model IAM and configuration remain separate from the BDA workload policy. If Nova is selected for this optional pass, grant only `bedrock:InvokeModel` for the approved inference profile and its destination model resources.

## IAM authentication for Convex

### Hackathon workload identity

Create a dedicated programmatic IAM user for the shared demo deployment:

```text
tuto-convex-demo
```

Optionally create `tuto-convex-dev` for the AWS owner's integration deployment. Each identity has:

- no console password
- one active access key under normal operation
- no IAM administration or resource-creation permissions
- no access to unrelated AWS resources
- only the approved BDA runtime action and resources

This access-key approach is acceptable for the hackathon because Convex runs outside AWS and cannot assume an AWS execution role directly. If the project continues, move the AWS boundary to a Lambda execution role or another short-lived-credential design.

### Synchronous BDA invocation policy

Create a customer-managed policy named `TutoBdaInvokeSync`. Replace `<ACCOUNT_ID>`, `<SOURCE_REGION>`, and `<SYNC_PROJECT_ID>` with resolved values.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeApprovedSyncProject",
      "Effect": "Allow",
      "Action": "bedrock:InvokeDataAutomation",
      "Resource": [
        "arn:aws:bedrock:<SOURCE_REGION>:<ACCOUNT_ID>:data-automation-project/<SYNC_PROJECT_ID>",
        "arn:aws:bedrock:us-east-1:<ACCOUNT_ID>:data-automation-profile/us.data-automation-v1",
        "arn:aws:bedrock:us-east-2:<ACCOUNT_ID>:data-automation-profile/us.data-automation-v1",
        "arn:aws:bedrock:us-west-1:<ACCOUNT_ID>:data-automation-profile/us.data-automation-v1",
        "arn:aws:bedrock:us-west-2:<ACCOUNT_ID>:data-automation-profile/us.data-automation-v1"
      ]
    }
  ]
}
```

BDA requires cross-Region inference. Keep the request's profile ARN in the chosen source Region, while allowing the data-automation profile resources required for its US destinations. Confirm the current destination list in AWS documentation before deploying rather than copying this list indefinitely.

Do not attach `AmazonBedrockFullAccess`, `PowerUserAccess`, or `AdministratorAccess` to the workload identity. The AWS administrator creates and updates the BDA project; the Convex identity only invokes it.

### Access-key handling

1. Attach only the reviewed invoke policy to the workload IAM user.
2. Create an access key for an application running outside AWS.
3. Enter the access-key ID and secret interactively into the intended Convex deployment.
4. Never place the secret in chat, source code, `.env.example`, a ticket, or repository history.
5. Confirm the keys are absent from the client bundle.
6. Record the creation and planned deletion dates without recording the secret.

## Convex configuration

Configure these server-side environment variables per deployment:

```text
DOCUMENT_ANALYSIS_PROVIDER=fake|aws_bda
DOCUMENT_ANALYSIS_KILL_SWITCH=false
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=<server-side secret>
AWS_SECRET_ACCESS_KEY=<server-side secret>
AWS_BDA_MODE=sync
AWS_BDA_PROJECT_ARN=arn:aws:bedrock:<REGION>:<ACCOUNT_ID>:data-automation-project/<PROJECT_ID>
AWS_BDA_PROJECT_STAGE=LIVE
AWS_BDA_PROFILE_ARN=arn:aws:bedrock:<REGION>:<ACCOUNT_ID>:data-automation-profile/us.data-automation-v1
```

Set secrets interactively:

```bash
npx convex env set AWS_ACCESS_KEY_ID
npx convex env set AWS_SECRET_ACCESS_KEY
```

Set ordinary configuration separately and target the intended deployment explicitly. The eventual `.env.example` contains names and safe placeholders only.

## Convex implementation boundary

Use the AWS SDK only inside a Convex Node action:

```text
submitScan                 public authenticated mutation
  |
  +--> verify ownership of canonical ArtifactPage revision
  +--> create pending analysis job
  +--> schedule internal.awsDocumentAnalysis.analyze

analyze                    internal Node action
  |
  +--> enforce kill switch and idempotency
  +--> retrieve exact canonical JPEG bytes
  +--> verify MIME type and BDA size/resolution limits
  +--> invoke synchronous BDA with inline bytes
  +--> validate and normalize inline output
  +--> optionally run semantic grouping
  +--> call internal completion mutation

completeScan               internal mutation
  |
  +--> persist PageRegion records and job metadata
```

Required SDK package after scaffold approval:

```text
@aws-sdk/client-bedrock-data-automation-runtime
```

Add `@aws-sdk/client-bedrock-runtime` only if a Bedrock model performs the optional semantic pass. The action must use the Convex Node runtime with `"use node"`. Use modular v3 clients, and configure them as Convex external packages if bundling becomes an issue.

Instantiate the client with only the Region. The default Node credential provider reads the server-side AWS variables and signs the request with SigV4.

The internal action must not accept arbitrary project ARNs, profile ARNs, stages, model IDs, prompts, S3 paths, or AWS operations from a client. Those values come from server configuration and versioned adapter code.

## Job safety and authorization

The public mutation must:

1. Require the current application identity.
2. Verify the artifact belongs to that identity.
3. Accept only the already-confirmed canonical page revision.
4. Enforce supported MIME types, dimensions, resolution, and the 5 MB BDA image limit.
5. Create a pending job with a unique idempotency key.
6. Apply per-user and global scan limits.
7. Schedule an internal action; never expose the AWS action to the client.

The internal action must:

- skip another provider call when the same page revision is complete
- record provider, project ARN, project stage, adapter version, page revision, latency, and usage metadata
- never log credentials, full images, or real student content
- validate all provider output before persistence
- distinguish retryable from terminal failures and cap retries
- return stored fixture output when the demo kill switch is active

## BDA output normalization

BDA response geometry is adapter input, not application state.

- Map BDA `text_lines` and `text_words` into provider-neutral detected regions.
- Retain BDA coordinates that are already normalized to `0–1`.
- Convert BDA polygons to `NormalizedPoint[]` and bounding boxes to `NormalizedBounds`.
- Clamp coordinates to `0–1` and reject inverted, empty, non-finite, or implausible boxes.
- Preserve BDA confidence, reading order, and source IDs as adapter metadata useful for debugging.
- Derive problem and solution-step regions from one or more detected regions.
- Persist the canonical page ID and revision with every region.
- Reject analysis whose page count, dimensions, or revision does not match the stored page.

The client receives only the shared contracts from `PROJECT_PLAN.md`, never the raw BDA response.

## Asynchronous BDA fallback

Activate this only if the sync compatibility spike fails or multi-page PDF support remains required for the demo.

The fallback adds:

- a separate `ASYNC` BDA project configured for document output
- page, element, line, and word granularity
- bounding boxes enabled
- generative fields disabled
- one private S3 bucket for transient input and output
- `@aws-sdk/client-s3`
- `InvokeDataAutomationAsync` and `GetDataAutomationStatus`
- a scheduled Convex action that polls status with capped retries

```text
Convex action
    |
    +--> put canonical input in private S3 prefix
    +--> invoke async BDA with input and output S3 URIs
    +--> persist invocation ARN
    +--> schedule status check
             |
             +--> incomplete: reschedule with capped backoff
             +--> complete: read JSON, normalize, persist, delete transient objects
```

S3 rules:

- enable Block Public Access
- use environment-scoped prefixes such as `input/demo/` and `output/demo/`
- enable default encryption
- configure short lifecycle deletion for transient objects
- never give the client AWS credentials
- scope workload access to the exact bucket and prefixes

Extend the workload policy only when the fallback is activated. It then needs the approved async project/profile resources, `bedrock:InvokeDataAutomationAsync`, `bedrock:GetDataAutomationStatus`, and the minimal S3 object/list operations for the named prefixes. Review the exact policy from deployed ARNs; do not pre-attach broad async or S3 access.

Lambda, API Gateway, SNS, and SQS are still unnecessary for this fallback. Add them only if the project outgrows Convex polling or needs an AWS-native security boundary.

## Deployment workflow

1. Product and backend development proceeds against the fake analyzer.
2. AWS owner creates the sync BDA project and records its ARN and configuration.
3. AWS owner runs the mandatory compatibility spike through the CLI or a disposable local script using synthetic pages.
4. Team records sync as accepted or activates the async fallback.
5. AWS owner creates the restricted workload policy and integration IAM user.
6. AWS owner configures credentials only in their Convex integration deployment.
7. Intelligence owner implements the BDA adapter behind `DocumentAnalyzer`.
8. Run golden scan fixtures and visually render the returned regions.
9. Merge only after fake-provider tests continue to pass.
10. Create a separate restricted demo identity and configure the shared demo deployment.
11. Run one deployed end-to-end scan using synthetic data.
12. Leave other personal deployments on `DOCUMENT_ANALYSIS_PROVIDER=fake`.

IAM policy changes require backend-owner review. Do not broaden permissions to work around an unexplained `AccessDeniedException`.

## Verification checklist

### Device and canonical image

- [ ] Native scanner works in an EAS development build on one physical device
- [ ] Edge correction, crop, and rotation finish before upload
- [ ] Canonical JPEG is at most 5 MB and 8K resolution
- [ ] Previewed, uploaded, analyzed, and displayed bytes are identical
- [ ] Rescanning creates a new page revision

### AWS setup

- [ ] Root and human administrator MFA enabled
- [ ] Credits, expiration, budget alerts, and quotas checked
- [ ] Source Region and BDA profile ARN recorded
- [ ] Sync BDA project status is `COMPLETED`
- [ ] JPEG and PNG modality routing is verified
- [ ] Text detection and bounding boxes are enabled
- [ ] Generative fields are disabled
- [ ] Workload identity has no console access or broad managed policy

### Convex integration

- [ ] AWS action is internal and cannot be called directly by a client
- [ ] Public mutation checks application identity and artifact ownership
- [ ] Secrets exist only in intended Convex deployments
- [ ] Fake analyzer remains the default for tests and personal sandboxes
- [ ] Kill switch returns fixture output without invoking AWS
- [ ] Re-running a completed page revision does not invoke BDA again

### Spatial result

- [ ] BDA output validates against the adapter schema
- [ ] Stored regions use normalized `0–1` coordinates
- [ ] Region revision matches the displayed canonical page revision
- [ ] A BDA region renders over the intended handwritten line on web
- [ ] The same region renders correctly on one physical mobile device
- [ ] Low-confidence localization falls back to a containing line or step

### Permission-negative tests

- [ ] Workload identity cannot create, update, or delete BDA projects
- [ ] Workload identity cannot invoke an unapproved BDA project
- [ ] Workload identity cannot access S3 while async fallback is disabled
- [ ] Deactivated credentials cause a controlled backend error

## Operational runbook

### Emergency inference stop

1. Set `DOCUMENT_ANALYSIS_KILL_SWITCH=true` in the shared Convex deployment.
2. Confirm new jobs use fixture or graceful fallback output.
3. If credentials may be compromised, deactivate the IAM key immediately.
4. Review AWS cost and CloudTrail activity.
5. Rotate credentials before re-enabling analysis.

### Credential rotation

1. Create a second key on the same restricted identity.
2. Update the intended Convex deployment interactively.
3. Run one synthetic scan.
4. Deactivate the old key.
5. Observe the demo deployment for failures.
6. Delete the old key.

### Common failures

| Symptom | Likely cause | Response |
|---|---|---|
| `AccessDeniedException` | Missing project or cross-Region data-automation profile ARN | Compare the request with the exact deployed ARNs; do not attach full access |
| Image classified as a document | JPEG/PNG modality routing is missing or ineffective | Verify the sync project override; if unresolved, activate async document mode |
| Payload rejected | JPEG exceeds 5 MB, 8K, or supported encoding | Recreate the canonical revision within limits before invoking BDA |
| Poor math transcription | OCR is being treated as semantic truth | Use geometry as evidence and add the bounded semantic pass or broader highlight |
| Annotation is offset | Displayed bytes or revision differ from analyzed input | Reject the annotation and restore the exact canonical revision |
| High spend | Duplicate jobs or uncapped retry | Activate kill switch and inspect idempotency and retry records |

## Deferred Lambda boundary

Build a Lambda/API Gateway boundary only if the prototype continues and long-lived AWS access keys in Convex are no longer acceptable, or if AWS-native orchestration materially simplifies a required async workload.

At that point:

- deploy through TypeScript CDK or AWS SAM in a dedicated `infra/aws/` directory
- give Lambda an execution role with short-lived credentials
- authenticate Convex-to-AWS requests explicitly and protect against replay
- keep input/output buckets private and narrowly scoped
- make every callback and completion operation idempotent

Do not create a public Lambda Function URL and rely on obscurity.

## End-of-hackathon teardown

Unless the team explicitly continues the project:

1. Set the application provider to `fake`.
2. Deactivate and delete every `tuto-convex-*` access key.
3. Delete workload IAM users and customer-managed policies after confirming they are unused.
4. Remove AWS secrets from every Convex deployment.
5. Delete BDA projects and any fallback S3 objects/buckets after retaining only synthetic fixtures and normalized expected results.
6. Delete any deferred Lambda, API Gateway, EventBridge, SNS, or SQS resources that were created.
7. Confirm no provisioned Bedrock capacity or SageMaker endpoint exists.
8. Review the next AWS bill and remaining credits.

## Reference links

- [BDA prerequisites and sync limits](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-limits.html)
- [BDA CLI workflow and sync/async project types](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-cli-guide.html)
- [BDA API workflow and inline bytes](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-using-api.html)
- [BDA document output and bounding boxes](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-output-documents.html)
- [BDA cross-Region inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-cris.html)
- [BDA project API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_data-automation_CreateDataAutomationProject.html)
- [AWS Bedrock service authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazonbedrock.html)
- [AWS cost-budget setup](https://docs.aws.amazon.com/cost-management/latest/userguide/create-cost-budget.html)
- [Convex actions and Node runtime](https://docs.convex.dev/functions/actions)
- [Convex environment variables](https://docs.convex.dev/production/environment-variables)

## Change log

- **2026-08-17:** Created the AWS-specific integration plan.
- **2026-08-17:** Replaced the Textract design with BDA, made canonical on-device JPEG capture explicit, selected a synchronous image-mode spike as the primary path, and retained asynchronous BDA with S3 as the fallback.
- **2026-08-17:** Ran the mandatory sync compatibility spike as `coordinateTest/` (deployed Lambda + API Gateway + CDK harness with a Nova transcription/LaTeX pass); it passed, so sync BDA plus Nova is accepted rather than proposed. The spike's AWS stack was torn down after validation; only its adapter code and this record remain.
