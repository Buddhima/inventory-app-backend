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

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
