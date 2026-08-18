import * as cdk from "aws-cdk-lib";
import { Stack, type StackProps } from "aws-cdk-lib";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

const US_BDA_REGIONS = ["us-east-1", "us-east-2", "us-west-1", "us-west-2"] as const;
const NOVA_INFERENCE_PROFILE_ID = "us.amazon.nova-2-lite-v1:0";
const NOVA_FOUNDATION_MODEL_ID = "amazon.nova-2-lite-v1:0";

export class TutoAwsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const budgetAlertEmail = new cdk.CfnParameter(this, "BudgetAlertEmail", {
      type: "String",
      description: "Email address that receives Tuto AWS budget warnings.",
      allowedPattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
      constraintDescription: "Enter a valid email address.",
      noEcho: true,
    });
    const monthlyBudgetUsd = new cdk.CfnParameter(this, "MonthlyBudgetUsd", {
      type: "Number",
      default: 25,
      minValue: 1,
      description: "Monthly Tuto AWS cost budget in USD. Alerts do not stop usage.",
    });

    const bdaProject = new bedrock.CfnDataAutomationProject(this, "PageAnalysisProject", {
      projectName: "tuto-page-analysis-sync",
      projectDescription: "Synchronous text detection and normalized geometry for canonical Tuto page images.",
      projectType: "SYNC",
      overrideConfiguration: {
        modalityRouting: { jpeg: "IMAGE", png: "IMAGE" },
      },
      standardOutputConfiguration: {
        image: {
          extraction: {
            category: { state: "ENABLED", types: ["TEXT_DETECTION"] },
            boundingBox: { state: "ENABLED" },
          },
          generativeField: { state: "DISABLED" },
        },
      },
      tags: [
        { key: "Application", value: "Tuto" },
        { key: "Environment", value: "demo" },
        { key: "ManagedBy", value: "CDK" },
      ],
    });

    const bdaProfileArns = US_BDA_REGIONS.map((region) =>
      `arn:${this.partition}:bedrock:${region}:${this.account}:data-automation-profile/us.data-automation-v1`,
    );
    const bdaSourceProfileArn = `arn:${this.partition}:bedrock:${this.region}:${this.account}:data-automation-profile/us.data-automation-v1`;
    const novaProfileArn = `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${NOVA_INFERENCE_PROFILE_ID}`;
    const novaModelArns = US_BDA_REGIONS.map((region) =>
      `arn:${this.partition}:bedrock:${region}::foundation-model/${NOVA_FOUNDATION_MODEL_ID}`,
    );

    const workloadPolicy = new iam.ManagedPolicy(this, "ConvexWorkloadPolicy", {
      managedPolicyName: "TutoConvexBedrockRuntime",
      description: "Invoke only Tuto's BDA project and approved Nova inference profile from Convex.",
      statements: [
        new iam.PolicyStatement({
          sid: "InvokeApprovedBdaProject",
          effect: iam.Effect.ALLOW,
          actions: ["bedrock:InvokeDataAutomation"],
          resources: [bdaProject.attrProjectArn, ...bdaProfileArns],
        }),
        new iam.PolicyStatement({
          sid: "InvokeApprovedNovaProfile",
          effect: iam.Effect.ALLOW,
          actions: ["bedrock:InvokeModel"],
          resources: [novaProfileArn, ...novaModelArns],
        }),
        new iam.PolicyStatement({
          sid: "InspectApprovedNovaProfile",
          effect: iam.Effect.ALLOW,
          actions: ["bedrock:GetInferenceProfile"],
          resources: [novaProfileArn],
        }),
      ],
    });

    const workloadUser = new iam.User(this, "ConvexWorkloadUser", {
      userName: "tuto-convex-demo",
    });
    workloadUser.addManagedPolicy(workloadPolicy);

    new budgets.CfnBudget(this, "MonthlyCostBudget", {
      budget: {
        budgetName: "tuto-monthly-cost",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: {
          amount: monthlyBudgetUsd.valueAsNumber,
          unit: "USD",
        },
        costTypes: {
          includeCredit: true,
          includeDiscount: true,
          includeOtherSubscription: true,
          includeRecurring: true,
          includeRefund: true,
          includeSubscription: true,
          includeSupport: true,
          includeTax: true,
          includeUpfront: true,
          useAmortized: false,
          useBlended: false,
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: "GREATER_THAN",
            notificationType: "ACTUAL",
            threshold: 50,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ address: budgetAlertEmail.valueAsString, subscriptionType: "EMAIL" }],
        },
        {
          notification: {
            comparisonOperator: "GREATER_THAN",
            notificationType: "ACTUAL",
            threshold: 90,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ address: budgetAlertEmail.valueAsString, subscriptionType: "EMAIL" }],
        },
      ],
    });

    cdk.Tags.of(this).add("Application", "Tuto");
    cdk.Tags.of(this).add("Environment", "demo");
    cdk.Tags.of(this).add("ManagedBy", "CDK");

    new cdk.CfnOutput(this, "BdaProjectArn", {
      value: bdaProject.attrProjectArn,
      description: "Set as AWS_BDA_PROJECT_ARN in the Convex server environment.",
    });
    new cdk.CfnOutput(this, "BdaProfileArn", {
      value: bdaSourceProfileArn,
      description: "Set as AWS_BDA_PROFILE_ARN in the Convex server environment.",
    });
    new cdk.CfnOutput(this, "NovaModelId", {
      value: NOVA_INFERENCE_PROFILE_ID,
      description: "Approved model ID for NOVA_MODEL_ID or TUTOR_MODEL_ID.",
    });
    new cdk.CfnOutput(this, "WorkloadUserName", {
      value: workloadUser.userName,
      description: "Create one access key for this user outside CloudFormation.",
    });
    new cdk.CfnOutput(this, "WorkloadPolicyArn", {
      value: workloadPolicy.managedPolicyArn,
    });
  }
}
