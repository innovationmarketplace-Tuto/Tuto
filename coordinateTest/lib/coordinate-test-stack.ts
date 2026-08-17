import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export class CoordinateTestStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const functionName = `${this.stackName.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-analyze`;
    const bdaProject = new bedrock.CfnDataAutomationProject(this, "CoordinateBdaProject", {
      projectName: `${this.stackName.replace(/[^a-zA-Z0-9-_]/g, "-")}-bda`,
      projectDescription: "Synchronous image text detection and geometry for handwritten coordinate testing.",
      projectType: "SYNC",
      overrideConfiguration: {
        // Notebook photos are intentionally treated as images so the synchronous
        // runtime can accept inline bytes without an S3 staging bucket.
        modalityRouting: { jpeg: "IMAGE", png: "IMAGE" },
      },
      standardOutputConfiguration: {
        image: {
          extraction: {
            category: { state: "ENABLED", types: ["TEXT_DETECTION"] },
            boundingBox: { state: "ENABLED" },
          },
        },
      },
    });
    const bdaProfileArn = process.env.BDA_PROFILE_ARN ?? this.formatArn({
      service: "bedrock",
      resource: "data-automation-profile",
      resourceName: "us.data-automation-v1",
      region: this.region,
      account: cdk.Aws.ACCOUNT_ID,
    });

    const analyzer = new nodejs.NodejsFunction(this, "AnalyzerFunction", {
      functionName,
      entry: path.join(currentDir, "../src/api.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      memorySize: 1536,
      timeout: Duration.seconds(29),
      environment: {
        NOVA_MODEL_ID: process.env.NOVA_MODEL_ID ?? "us.amazon.nova-2-lite-v1:0",
        BDA_PROJECT_ARN: bdaProject.attrProjectArn,
        BDA_PROJECT_STAGE: process.env.BDA_PROJECT_STAGE ?? "LIVE",
        BDA_PROFILE_ARN: bdaProfileArn,
        ANALYSIS_PROVIDER: process.env.ANALYSIS_PROVIDER ?? "aws",
        MAX_ANNOTATIONS: process.env.MAX_ANNOTATIONS ?? "12",
      },
      bundling: {
        // Keep the deploy path Docker-free. The Linux x64 sharp binary is an explicit
        // dependency, and the stack pins the Lambda architecture to x86_64 below.
        forceDockerBundling: false,
        externalModules: ["sharp"],
        minify: false,
        sourceMap: true,
        target: "node22",
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir, outputDir) => [
            `mkdir -p "${outputDir}/node_modules/@img"`,
            `cp -RL "${inputDir}/node_modules/sharp" "${outputDir}/node_modules/sharp"`,
            `cp -RL "${inputDir}/node_modules/@img/sharp-linux-x64" "${outputDir}/node_modules/@img/sharp-linux-x64"`,
            `cp -RL "${inputDir}/node_modules/@img/sharp-libvips-linux-x64" "${outputDir}/node_modules/@img/sharp-libvips-linux-x64"`,
            `cp -RL ${inputDir}/node_modules/.pnpm/@img+colour@*/node_modules/@img/colour "${outputDir}/node_modules/@img/colour"`,
            `cp -RL ${inputDir}/node_modules/.pnpm/detect-libc@*/node_modules/detect-libc "${outputDir}/node_modules/detect-libc"`,
            `cp -RL ${inputDir}/node_modules/.pnpm/semver@*/node_modules/semver "${outputDir}/node_modules/semver"`,
          ],
        },
      },
    });

    analyzer.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "bedrock:InvokeDataAutomation",
        "bedrock:Converse",
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:GetInferenceProfile",
        "bedrock:ListInferenceProfiles",
      ],
      resources: ["*"],
    }));

    analyzer.node.addDependency(bdaProject);

    const api = new apigwv2.HttpApi(this, "CoordinateApi", {
      apiName: `${this.stackName}-api`,
      createDefaultStage: true,
      corsPreflight: {
        allowHeaders: ["content-type"],
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowOrigins: ["*"],
        maxAge: Duration.hours(1),
      },
    });

    api.addRoutes({
      path: "/analyze",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration("AnalyzeIntegration", analyzer),
    });

    new cdk.CfnOutput(this, "AnalyzeUrl", {
      value: `${api.apiEndpoint}/analyze`,
      description: "POST a JSON image request to this URL",
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.apiEndpoint,
      description: "HTTP API base URL",
    });
  }
}
