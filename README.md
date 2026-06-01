# Inventory & Job Template Management Application

## 📌 Overview
This application manages inventory records and streamlines job creation using reusable job templates. It integrates with **WorkflowMax** to ensure accurate job costing based on available stock and predefined templates. The solution is secure, scalable, and built using cloud-native AWS services.

---

## ✨ Features

### Inventory Management
- Store and manage inventory records
- Upload bulk inventory via file upload
- Add and manage individual inventory items

### Job Template Management
- Import and manage job templates
- Use templates to standardize job creation
- Retrieve and update template details for WorkflowMax jobs

### WorkflowMax Integration
- Job template components are created as **job cost items** in WorkflowMax
- Job cost quantities are limited by available inventory stock
- Supports updating templates to match WorkflowMax workflows

### Security & Access Control
- Only **authenticated users** can access the application
- Authentication is managed via AWS Cognito

---

## 🛠 Technology Stack

### Backend
- Node.js
- AWS CDK
- AWS Lambda
- Amazon API Gateway
- Amazon DynamoDB
- Amazon Cognito
- Amazon EventBridge

### Frontend
- React  
- Communicates with the backend via exposed REST APIs

---

## 🏗 Architecture Overview
- **API Gateway** exposes REST endpoints
- **Lambda functions** handle application logic
- **DynamoDB** stores inventory and job template data
- **Cognito** manages authentication and authorization
- **EventBridge** supports event-driven processing
- **React frontend** consumes backend APIs

---

## ⚙️ Configuration

### WorkflowMax
- Configuration must match your **WorkflowMax instance**
- Ensure the **WorkflowMax API token** is valid and up to date

### AWS Setup
Update the following configuration files with correct credentials and values:
- `workflowmax-api.config`
- `aws-app-stack`

These files are required for proper AWS resource provisioning and WorkflowMax integration.

---

## 🔐 Authentication
- User authentication is handled using **AWS Cognito**
- All application features require authenticated access

---

## 🚀 Usage
1. Authenticate with valid user credentials
2. Manage inventory (bulk upload or individual items)
3. Import job templates
4. Create jobs using templates
5. Jobs, Job cost items are created in WorkflowMax with quantities limited by available stock
6. View previous jobs created at WorkflowMax and linking them

---

## 📝 Notes
- Ensure all configuration values are set correctly before deployment
- Keep WorkflowMax credentials updated to prevent integration issues
- The frontend React application consumes APIs exposed by this backend

## Backend Traffic Logs

Backend API request and response payloads are written by each API Gateway Lambda
handler to Amazon CloudWatch Logs. Open the AWS Console, go to **CloudWatch >
Log groups**, and check the Lambda log groups for this stack. Lambda log groups
use the format `/aws/lambda/<lambda-function-name>`.

Useful CloudWatch Logs Insights search strings:

- `Backend API request`
- `Backend API response`
- `WorkflowMax request`
- `WorkflowMax response`
- `WorkflowMax error response`

WorkflowMax request and response logs are emitted from the job and ASN Lambda
functions because those are the functions that call WorkflowMax. These logs
include HTTP headers and payloads.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## Dev and Prod Deployments

The app supports two deployment environments from the `master` branch:

- `dev`
- `prod`

GitHub Actions deploys `dev` first. The `prod` deployment runs after `dev` succeeds and should be protected with a required approval on the GitHub `prod` environment.

API Gateway uses the matching deployment stage name for each environment: `/dev` for dev and `/prod` for prod.

The API Gateway REST API names are `Inventory App Backend API dev` and `Inventory App Backend API prod`.

### GitHub repository setup

Create GitHub Environments named `dev` and `prod`.

Add these environment secrets to both environments:

- `AWS_ROLE_ARN`: IAM role ARN that GitHub Actions can assume in that AWS account.
- `AWS_REGION`: AWS region to deploy to.
- `WFM_CONFIG_JSON`: Full JSON content for `configs/workflowmax-config.json`.

In the `prod` environment, enable required reviewers so GitHub Actions pauses before production deployment. The expected flow is:

1. Push or merge to `master`.
2. Build and test.
3. Deploy `dev`.
4. Wait for approval on the GitHub `prod` environment.
5. Deploy `prod`.

The workflow writes `WFM_CONFIG_JSON` to `configs/workflowmax-config.json` during deployment. This file is ignored locally and must not be committed.

The config JSON must include `wfmAccountId`:

```json
{
  "clientUUID": "",
  "priority": "Normal",
  "statusUUID": "",
  "customFieldUUIDs": {
    "bomEAN": "",
    "signature": "",
    "supplier": "",
    "componentCode": "",
    "componentEAN": ""
  },
  "client_id": "",
  "client_secret": "",
  "scope": "openid email profile workflowmax offline_access",
  "wfmAccountId": ""
}
```

### AWS account setup

Each AWS account used by GitHub Actions needs a GitHub OIDC identity provider and an IAM deploy role.

Create the IAM OIDC provider in the target AWS account:

- Provider type: OpenID Connect
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

Create an IAM role for GitHub Actions to assume. The trust relationship should allow GitHub's OIDC provider and restrict access to this repository and GitHub Environment.

For the initial setup, attach the AWS managed `AdministratorAccess` policy to the deploy role so CDK can create and update all required resources. This is broad access, so treat the role as deployment-only and keep the trust policy restricted to this repository and the matching GitHub Environment. After the deployment process is stable, the role permissions can be reduced to a least-privilege policy.

Example trust policy for the `dev` role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<DEV_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:Buddhima/inventory-app-backend:environment:dev"
        }
      }
    }
  ]
}
```

Example trust policy for the `prod` role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<PROD_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:Buddhima/inventory-app-backend:environment:prod"
        }
      }
    }
  ]
}
```

Attach permissions that allow the role to deploy the CDK stack. For first setup, confirm the target account and region have been bootstrapped:

```bash
npx cdk bootstrap aws://<ACCOUNT_ID>/<AWS_REGION>
```

Deploy manually from a local shell by setting `DEPLOY_ENV`:

```bash
DEPLOY_ENV=dev npx cdk deploy InventoryApp-dev
DEPLOY_ENV=prod npx cdk deploy InventoryApp-prod
```

The target AWS account expects these SSM parameters to exist:

- `/inventory-app/dev/wfm_token`
- `/inventory-app/dev/sscc_number_postfix`
- `/inventory-app/prod/wfm_token`
- `/inventory-app/prod/sscc_number_postfix`

### Replication checklist

Use this checklist when setting up another environment, especially production:

- Create or confirm access to the target AWS account.
- Bootstrap CDK in the target account and region.
- Create the GitHub OIDC provider in IAM.
- Create the GitHub Actions deploy role and attach `AdministratorAccess` for the initial setup.
- Configure the role trust policy with the matching GitHub Environment name.
- Add `AWS_ROLE_ARN`, `AWS_REGION`, and `WFM_CONFIG_JSON` to the matching GitHub Environment.
- For `prod`, enable required reviewers on the GitHub Environment.
- Create or verify `/inventory-app/<env>/wfm_token` and `/inventory-app/<env>/sscc_number_postfix` in SSM Parameter Store for the target environment.
- Rerun the GitHub Actions workflow from `master`.
- Approve the `prod` deployment when the `dev` deployment has succeeded.

### Common setup errors

- `No OpenIDConnect provider found`: create the IAM OIDC provider in the target AWS account.
- `Could not assume role with OIDC`: check the role trust policy, `AWS_ROLE_ARN`, repository name, and GitHub Environment name.
- Missing GitHub secret: confirm the secret exists on the GitHub Environment, not only at repository level.
- Missing SSM parameter: create `/inventory-app/<env>/wfm_token` and `/inventory-app/<env>/sscc_number_postfix` in the target AWS account.
- `DEPLOY_ENV must be set`: run CDK with `DEPLOY_ENV=dev` or `DEPLOY_ENV=prod`.
