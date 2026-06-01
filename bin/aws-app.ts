#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AwsAppStack, StageName } from "../lib/aws-app-stack";

const app = new cdk.App();
const stageName = process.env.DEPLOY_ENV;

if (stageName !== "dev" && stageName !== "prod") {
  throw new Error("DEPLOY_ENV must be set to either 'dev' or 'prod'");
}

new AwsAppStack(app, `InventoryApp-${stageName}`, {
  stageName: stageName as StageName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
