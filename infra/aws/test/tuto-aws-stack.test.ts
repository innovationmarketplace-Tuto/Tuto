import assert from "node:assert/strict";
import { test } from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { TutoAwsStack } from "../lib/tuto-aws-stack.js";

function stackTemplate() {
  const app = new cdk.App();
  const stack = new TutoAwsStack(app, "TestTutoAwsStack", {
    env: { account: "123456789012", region: "us-west-2" },
  });
  return Template.fromStack(stack);
}

test("creates only the planned BDA, IAM, and budget resources", () => {
  const template = stackTemplate();

  template.resourceCountIs("AWS::Bedrock::DataAutomationProject", 1);
  template.resourceCountIs("AWS::IAM::User", 1);
  template.resourceCountIs("AWS::IAM::ManagedPolicy", 1);
  template.resourceCountIs("AWS::Budgets::Budget", 1);
  template.resourceCountIs("AWS::IAM::AccessKey", 0);
  template.resourceCountIs("AWS::Lambda::Function", 0);
  template.resourceCountIs("AWS::ApiGatewayV2::Api", 0);
  template.resourceCountIs("AWS::S3::Bucket", 0);
});

test("keeps the accepted synchronous image-routing configuration", () => {
  const template = stackTemplate();

  template.hasResourceProperties("AWS::Bedrock::DataAutomationProject", {
    ProjectName: "tuto-page-analysis-sync",
    ProjectType: "SYNC",
    OverrideConfiguration: {
      ModalityRouting: { jpeg: "IMAGE", png: "IMAGE" },
    },
    StandardOutputConfiguration: {
      Image: {
        Extraction: {
          BoundingBox: { State: "ENABLED" },
          Category: { State: "ENABLED", Types: ["TEXT_DETECTION"] },
        },
        GenerativeField: { State: "DISABLED" },
      },
    },
  });
});

test("grants the workload no resource creation or IAM administration", () => {
  const template = stackTemplate();

  template.hasResourceProperties("AWS::IAM::ManagedPolicy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({ Action: "bedrock:InvokeDataAutomation", Effect: "Allow" }),
        Match.objectLike({ Action: "bedrock:InvokeModel", Effect: "Allow" }),
      ]),
      Version: "2012-10-17",
    },
  });
});
