#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CoordinateTestStack } from "../lib/coordinate-test-stack.js";

const app = new cdk.App();

new CoordinateTestStack(app, "CoordinateTestStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-east-1",
  },
});
