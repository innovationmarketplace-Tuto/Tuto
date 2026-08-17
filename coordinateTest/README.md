# coordinateTest

An API-only AWS spike for validating the coordinate round-trip:

```text
local Vite UI
    -> API Gateway HTTP API
       -> Node.js Lambda
          -> Bedrock Data Automation: text detection + polygons
          -> Nova 2: corrected page transcription + LaTeX linked to regions
    <- JSON transcription + geometry regions
local UI -> SVG overlay in the same normalized coordinate space
```

There is no S3 bucket, database, CloudFront distribution, or hosted frontend. The deployed footprint is one HTTP API, one Lambda, and one CDK-managed BDA project. The synchronous BDA request sends the canonical JPEG inline, so a request does not need an S3 staging step.

## Requirements

- Node.js 22+
- PNPM 11+
- AWS CLI with credentials configured
- AWS CDK CLI (`pnpm exec cdk` also works)
- Bedrock Data Automation and the configured Nova model available in the deployment region
- A Linux-compatible `sharp` binary is included as a direct dependency; Docker is optional

## Deploy

From this directory:

```bash
pnpm install
export AWS_REGION=us-west-2
pnpm exec cdk bootstrap                 # once per account/region
pnpm deploy
```

The deploy writes `cdk-outputs.json`. Copy `AnalyzeUrl` into the UI's `Hosted API endpoint` field.

The stack creates a synchronous BDA project configured for image text detection and bounding boxes. JPEG and PNG inputs are explicitly routed to image processing, which lets this notebook-photo spike use the inline-byte sync API. The default US BDA profile is generated for the deployment region:

```text
arn:aws:bedrock:us-west-2:ACCOUNT_ID:data-automation-profile/us.data-automation-v1
```

Override it only when needed:

```bash
BDA_PROFILE_ARN=arn:aws:bedrock:us-west-2:ACCOUNT_ID:data-automation-profile/us.data-automation-v1 \
NOVA_MODEL_ID=us.amazon.nova-2-lite-v1:0 \
AWS_REGION=us-west-2 pnpm deploy
```

The API Gateway integration has a 29-second Lambda timeout for quick notebook-photo requests. If real pages exceed that budget, the next step is an asynchronous S3/job endpoint.

## If AWS says the access key needs a subscription

Check that the credentials resolve to the intended account and region:

```bash
AWS_PROFILE=your-profile AWS_REGION=us-west-2 aws sts get-caller-identity
AWS_PROFILE=your-profile AWS_REGION=us-west-2 aws bedrock list-foundation-models --by-provider amazon
```

This app no longer calls Textract. The Lambda role needs `bedrock:InvokeDataAutomation` for BDA and the Bedrock model actions for Nova; those permissions are in `lib/coordinate-test-stack.ts`. If BDA or Nova is not enabled for the account, activate the service/model in the Bedrock console or ask the Organizations administrator to remove the applicable account or SCP restriction, then redeploy.

## Run the local UI

```bash
pnpm dev
```

Open the printed `http://127.0.0.1:5173` URL, paste the deployed `AnalyzeUrl`, choose a photo, and run the analysis. The browser creates a canonical JPEG; the API displays and analyzes that same image, so the overlay remains in the correct coordinate space.

## Throw requests at it

```bash
pnpm request https://YOUR_API_ID.execute-api.us-west-2.amazonaws.com/analyze ./notebook.jpg "Transcribe everything on the page"
```

The response includes:

- `regions`: stable BDA `line-001` and `line-001-word-01` artifacts with normalized polygons and boxes
- `annotations`: page-content region IDs and renderer instructions
- `document.pages[0].imageUrl`: the exact canonical image whose coordinates are rendered
- `document.latex`: Nova's page-level LaTeX transcription
- `document.regions[].latex`: Nova's LaTeX for each localized artifact when available
- `providers`: BDA counts, Nova status, model ID, and raw model text when available
- `warnings`: BDA/Nova failures or unverified symbol-level targets

Equivalent request shape:

```json
{
  "imageBase64": "...",
  "mimeType": "image/jpeg",
  "question": "Transcribe everything on the page"
}
```

The response also includes a plan-shaped `document` object:

```json
{
  "document": {
    "transcription": "x = 6\ny = x + 2",
    "latex": "x = 6\\ny = x + 2",
    "pages": [{
      "id": "page-001",
      "artifactId": "request-id",
      "pageNumber": 1,
      "imageUrl": "data:image/jpeg;base64,...",
      "naturalWidth": 1800,
      "naturalHeight": 1350,
      "revision": 1
    }],
    "regions": [{
      "id": "line-001",
      "pageId": "page-001",
      "revision": 1,
      "kind": "equation",
      "polygon": [{ "x": 0.14, "y": 0.35 }, { "x": 0.62, "y": 0.35 }],
      "bounds": { "x": 0.14, "y": 0.35, "width": 0.48, "height": 0.06 },
      "transcription": "x = 6",
      "latex": "x = 6",
      "confidence": 0.96,
      "source": "text_detector"
    }],
    "annotations": [],
    "messages": [{
      "id": "message-001",
      "text": "x = 6\ny = x + 2",
      "annotationIds": []
    }]
  }
}
```

For a no-Bedrock smoke test, deploy with `ANALYSIS_PROVIDER=mock`. BDA still runs when configured; region selection is deterministic and uses the first detected line.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm synth
```

The BDA standard output supplies candidate line and word geometry with bounding boxes/polygons. The adapter in `src/geometry.ts` handles both normalized and pixel-style geometry, then emits a stable 0–1 coordinate contract. Nova is always called in the AWS path after BDA and is the authoritative transcription/LaTeX pass; BDA OCR text is only a fallback if Nova is unavailable. Nova returns region IDs instead of display coordinates, and its documented `[0, 1000]` boxes are included in the prompt only as reference. The UI renders stored normalized polygons with an SVG `viewBox="0 0 1 1"`.

References: [BDA API](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-using-api.html), [BDA output](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-output-documents.html), [BDA cross-Region profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/bda-cris.html), and [Nova boxes](https://docs.aws.amazon.com/nova/latest/nova2-userguide/prompting-multimodal.html).
