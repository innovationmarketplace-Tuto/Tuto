# Tuto AWS infrastructure

This stack provisions only the AWS resources used directly by Tuto:

- a synchronous Bedrock Data Automation project for image text detection and geometry;
- a least-privilege IAM user and managed runtime policy for Convex;
- a monthly AWS cost budget with warning and critical email alerts; and
- CloudFormation outputs used as Convex server configuration.

It intentionally creates no access keys, Lambda functions, API Gateways, S3
buckets, or client-visible credentials. The BDA settings are reused from the
accepted `coordinateTest` spike; its disposable Lambda/API harness is not.

## Validate

```bash
pnpm install --frozen-lockfile
pnpm check
```

## Bootstrap and deploy

Use a named human administrator profile. Replace the account ID and email;
choose an explicit budget amount.

```bash
export TUTO_AWS_PROFILE=tuto-admin
export TUTO_AWS_REGION=us-west-2

aws sts get-caller-identity --profile "$TUTO_AWS_PROFILE"

pnpm exec cdk bootstrap \
  --profile "$TUTO_AWS_PROFILE" \
  "aws://ACCOUNT_ID/$TUTO_AWS_REGION"

AWS_REGION="$TUTO_AWS_REGION" pnpm deploy -- \
  --profile "$TUTO_AWS_PROFILE" \
  --parameters TutoAwsStack:BudgetAlertEmail=owner@example.com \
  --parameters TutoAwsStack:MonthlyBudgetUsd=25
```

The generated `cdk-outputs.json` is ignored by Git. Set its project/profile
ARNs and model ID as ordinary Convex server configuration. Create exactly one
access key for the output workload username separately, then pipe its values
into `convex env set` without committing or pasting the secret into chat.

## Teardown

Delete the workload access key first, then destroy the stack:

```bash
AWS_REGION="$TUTO_AWS_REGION" pnpm destroy -- \
  --profile "$TUTO_AWS_PROFILE"
```

