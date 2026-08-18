#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TutoAwsStack } from "../lib/tuto-aws-stack.js";

const app = new cdk.App();

new TutoAwsStack(app, "TutoAwsStack", {
  description: "Tuto Bedrock Data Automation, least-privilege workload identity, and cost budget",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-west-2",
  },
});

