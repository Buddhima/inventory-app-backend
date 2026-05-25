# Agent Instructions

- Create a feature branch before making any change.
- Before starting a new feature, switch to `master`, update it from `origin/master`, then create the feature branch from updated `master`.
- Show the plan and get explicit permission before changing files.
- Ignore `.DS_Store` workflow noise unless explicitly asked to handle it.

## Project Context

- This repository is the backend for an inventory management app.
- It is a serverless AWS CDK application. Treat infrastructure edits carefully because they can change deployed AWS resources.
- The backend uses AWS Lambda, API Gateway, Cognito authorizers, DynamoDB, S3, S3 event notifications, and SSM parameters.
- The API supports inventory, stock, jobs, job templates, job history, upload URL generation, uploaded file processing, ASN generation, ASN file history, and ASN file download URL flows.
- WorkflowMax integration is part of the backend. Keep WorkflowMax account/config values out of Git; use ignored local config or AWS-managed configuration such as SSM/Secrets Manager.
