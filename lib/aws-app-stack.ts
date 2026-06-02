import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as path from "path";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as fs from "fs";
import * as ssm from "aws-cdk-lib/aws-ssm";

export type StageName = "dev" | "prod";

export interface AwsAppStackProps extends cdk.StackProps {
  stageName: StageName;
}

export class AwsAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AwsAppStackProps) {
    super(scope, id, props);

    const { stageName } = props;
    const isProd = stageName === "prod";
    const removalPolicy = isProd
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;
    const autoDeleteObjects = !isProd;

    // Reading & adding configs
    const configJson = fs.readFileSync(
      "configs/workflowmax-config.json",
      "utf8"
    );
    const workflowMaxConfig = JSON.parse(configJson) as {
      wfmAccountId?: string;
    };
    const wfmAccountId = workflowMaxConfig.wfmAccountId;

    if (!wfmAccountId) {
      throw new Error(
        "Missing wfmAccountId in configs/workflowmax-config.json"
      );
    }

    const appConfigParameter = new ssm.StringParameter(
      this,
      "AppConfigParameter",
      {
        parameterName: `/inventory-app/${stageName}/config`,
        stringValue: configJson,
      }
    );

    // Access token config
    const wfmConfigParam = ssm.StringParameter.fromStringParameterName(
      this,
      "WfmConfigParam",
      `/inventory-app/${stageName}/wfm_token`
    );

    // SSCC Number postfix
    const ssccPostfixParam = ssm.StringParameter.fromStringParameterName(
      this,
      "SsccPostfixParam",
      `/inventory-app/${stageName}/sscc_number_postfix`
    );

    // Lambda Layer
    const commonLayer = new lambda.LayerVersion(this, "CommonLayer", {
      code: lambda.Code.fromAsset(path.join(__dirname, "../layers/common")),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: "Common dependencies for lambdas",
    });

    // S3 Buckets
    const uploadBucket = new s3.Bucket(this, "UploadBucket", {
      removalPolicy,
      autoDeleteObjects,
      cors: [
        {
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
        },
      ],
    });

    const templateUploadBucket = new s3.Bucket(this, "TemplateUploadBucket", {
      removalPolicy,
      autoDeleteObjects,
      cors: [
        {
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
        },
      ],
    });

    const asnFileUploadBucket = new s3.Bucket(this, "AsnFileUploadBucket", {
      removalPolicy,
      autoDeleteObjects,
      cors: [
        {
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
        },
      ],
    });

    // DynamoDB Table
    const table = new dynamodb.Table(this, "ItemsTable", {
      partitionKey: {
        name: "pk",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
    });

    // Cognito User Pool
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireSymbols: false,
      },
    });

    new cognito.CfnUserPoolGroup(this, "AdminUserGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "admin",
    });

    new cognito.CfnUserPoolGroup(this, "UserGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "user",
    });

    const userPoolClient = new cognito.UserPoolClient(this, "UserPoolClient", {
      userPool,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: ["http://localhost:8100/auth/callback"],
        logoutUrls: ["http://localhost:8100/"],
      },
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "ItemsApiAuthorizer",
      {
        cognitoUserPools: [userPool],
        identitySource: "method.request.header.Authorization",
      }
    );

    const domain = userPool.addDomain("CognitoDomain", {
      cognitoDomain: {
        domainPrefix: `inventory-app-${stageName}-auth`,
      },
    });

    // Lambda Functions
    const inventoryHandler = new lambda.Function(this, "InventoryHandler", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/inventory"),
      handler: "index.handler",
      layers: [commonLayer],
      environment: {
        TABLE_NAME: table.tableName,
      },
      memorySize: 3008,
      timeout: cdk.Duration.minutes(5),
    });

    const stockHandler = new lambda.Function(this, "StockHandler", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/stock"),
      handler: "index.handler",
      layers: [commonLayer],
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    const consumeHandler = new lambda.Function(this, "ConsumeHandler", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/consume"),
      handler: "index.handler",
      layers: [commonLayer],
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    const jobHandler = new lambda.Function(this, "JobHandler", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/job"),
      handler: "index.handler",
      layers: [commonLayer],
      environment: {
        TABLE_NAME: table.tableName,
        APP_CONFIG_PARAM_NAME: appConfigParameter.parameterName,
        WFM_BASE_URL: "https://api.workflowmax.com/v2/",
        WFM_ACCOUNT_ID: wfmAccountId,
        WFM_CONFIG_PARAM_NAME: wfmConfigParam.parameterName,
      },
      memorySize: 3008,
      timeout: cdk.Duration.minutes(5),
    });

    const jobTemplateHandler = new lambda.Function(this, "JobTemplateHandler", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/job-template"),
      handler: "index.handler",
      layers: [commonLayer],
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    const fileSignUrlHandler = new lambda.Function(this, "fileSignUrlHandler", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/file-sign-url"),
      handler: "index.handler",
      layers: [commonLayer],
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: uploadBucket.bucketName,
      },
    });

    const invFileProcessorHandler = new lambda.Function(
      this,
      "InvFileProcessorHandler",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset("lambda/inventory-file-processor"),
        handler: "index.handler",
        layers: [commonLayer],
        environment: {
          TABLE_NAME: table.tableName,
        },
        memorySize: 3008,
        timeout: cdk.Duration.minutes(5),
      }
    );

    const templateFileSignUrlHandler = new lambda.Function(
      this,
      "templateFileSignUrlHandler",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset("lambda/template-file-sign-url"),
        handler: "index.handler",
        layers: [commonLayer],
        environment: {
          TABLE_NAME: table.tableName,
          BUCKET_NAME: templateUploadBucket.bucketName,
        },
      }
    );

    const templateFileProcessorHandler = new lambda.Function(
      this,
      "templateFileProcessorHandler",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset("lambda/template-file-processor"),
        handler: "index.handler",
        layers: [commonLayer],
        environment: {
          TABLE_NAME: table.tableName,
        },
        memorySize: 3008,
        timeout: cdk.Duration.minutes(5),
      }
    );

    const jobHistoryHandler = new lambda.Function(this, "JobHistoryHandler", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/job-history"),
      handler: "index.handler",
      layers: [commonLayer],
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    const asnFileHandler = new lambda.Function(this, "AsnFileHandler", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/asn-file-processor"),
      handler: "index.handler",
      layers: [commonLayer],
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: asnFileUploadBucket.bucketName,
        APP_CONFIG_PARAM_NAME: appConfigParameter.parameterName,
        WFM_BASE_URL: "https://api.workflowmax.com/v2/",
        WFM_ACCOUNT_ID: wfmAccountId,
        WFM_CONFIG_PARAM_NAME: wfmConfigParam.parameterName,
        SSCC_POSTFIX_PARAM_NAME: ssccPostfixParam.parameterName,
      },
      memorySize: 3008,
      timeout: cdk.Duration.minutes(5),
    });

    const asnFileHistoryHandler = new lambda.Function(this, "AsnFileHistoryHandler", {
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/asn-file-history"),
      handler: "index.handler",
      layers: [commonLayer],
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    const asnFileSignUrlHandler = new lambda.Function(
      this,
      "AsnFileSignUrlHandler",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset("lambda/asn-file-sign-url"),
        handler: "index.handler",
        layers: [commonLayer],
        environment: {
          TABLE_NAME: table.tableName,
          BUCKET_NAME: asnFileUploadBucket.bucketName,
        },
      }
    );

    const inventoryMovementsHandler = new lambda.Function(
      this,
      "InventoryMovementsHandler",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        code: lambda.Code.fromAsset("lambda/inventory-movements"),
        handler: "index.handler",
        layers: [commonLayer],
        environment: {
          TABLE_NAME: table.tableName,
        },
      }
    );

    // Permissions
    table.grantReadWriteData(inventoryHandler);
    table.grantReadWriteData(stockHandler);
    table.grantReadWriteData(consumeHandler);
    table.grantReadWriteData(jobHandler);
    table.grantReadWriteData(jobTemplateHandler);
    table.grantReadWriteData(invFileProcessorHandler);
    table.grantReadWriteData(templateFileProcessorHandler);
    table.grantReadWriteData(jobHistoryHandler);
    table.grantReadWriteData(asnFileHandler);
    table.grantReadWriteData(asnFileHistoryHandler);
    table.grantReadWriteData(asnFileSignUrlHandler);
    table.grantReadData(inventoryMovementsHandler);

    uploadBucket.grantReadWrite(invFileProcessorHandler);
    uploadBucket.grantPut(fileSignUrlHandler);

    templateUploadBucket.grantReadWrite(templateFileProcessorHandler);
    templateUploadBucket.grantPut(templateFileSignUrlHandler);

    asnFileUploadBucket.grantReadWrite(asnFileHandler);
    asnFileUploadBucket.grantPut(asnFileHandler);
    asnFileUploadBucket.grantReadWrite(asnFileSignUrlHandler);

    appConfigParameter.grantRead(jobHandler);
    wfmConfigParam.grantRead(jobHandler);
    appConfigParameter.grantRead(asnFileHandler);
    wfmConfigParam.grantRead(asnFileHandler);
    ssccPostfixParam.grantRead(asnFileHandler);
    ssccPostfixParam.grantWrite(asnFileHandler);

    // API Gateway
    const api = new apigateway.RestApi(this, "InventoryAppBackendApi", {
      restApiName: `Inventory App Backend API ${stageName}`,
      deployOptions: {
        stageName,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const inventory = api.root.addResource("inventory");
    const jobs = api.root.addResource("jobs");
    const jobTemplates = api.root.addResource("job-templates");
    const stockItems = api.root.addResource("stock");
    const consumeItems = api.root.addResource("consume");
    const uploadFile = api.root.addResource("upload-url");
    const uploadTemplateFile = api.root.addResource("job-template-upload-url");
    const jobHistory = api.root.addResource("job-history");
    const generateAsnFileUrl = api.root.addResource("generate-asn");
    const asnFileHistory = api.root.addResource("asn-file-history");
    const asnFileDownloadUrl = api.root.addResource("asn-file-download-url");
    const inventoryMovements = api.root.addResource("inventory-movements");

    const inventoryIntegration = new apigateway.LambdaIntegration(inventoryHandler);
    const stockIntegration = new apigateway.LambdaIntegration(stockHandler);
    const consumeIntegration = new apigateway.LambdaIntegration(consumeHandler);
    const jobIntegration = new apigateway.LambdaIntegration(jobHandler);
    const uploadIntegration = new apigateway.LambdaIntegration(
      fileSignUrlHandler
    );
    const templateUploadIntegration = new apigateway.LambdaIntegration(
      templateFileSignUrlHandler
    );
    const jobHistoryIntegration = new apigateway.LambdaIntegration(
      jobHistoryHandler
    );
    const asnFileIntegration = new apigateway.LambdaIntegration(asnFileHandler);
    const asnFileHistoryIntegration = new apigateway.LambdaIntegration(asnFileHistoryHandler);
    const asnFileDownloadIntegration = new apigateway.LambdaIntegration(asnFileSignUrlHandler);
    const inventoryMovementsIntegration = new apigateway.LambdaIntegration(inventoryMovementsHandler);

    const authorizationOptions = {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
    };

    inventory.addMethod("GET", inventoryIntegration, authorizationOptions);
    stockItems.addMethod("POST", stockIntegration, authorizationOptions);
    consumeItems.addMethod("POST", consumeIntegration, authorizationOptions);
    jobs.addMethod("POST", jobIntegration, authorizationOptions);
    jobTemplates.addMethod(
      "POST",
      new apigateway.LambdaIntegration(jobTemplateHandler),
      authorizationOptions
    );
    jobTemplates.addMethod(
      "GET",
      new apigateway.LambdaIntegration(jobTemplateHandler),
      authorizationOptions
    );
    uploadFile.addMethod("POST", uploadIntegration, authorizationOptions);
    uploadTemplateFile.addMethod(
      "POST",
      templateUploadIntegration,
      authorizationOptions
    );
    jobHistory.addMethod("GET", jobHistoryIntegration, authorizationOptions);
    generateAsnFileUrl.addMethod("POST", asnFileIntegration, authorizationOptions);
    asnFileHistory.addMethod("GET", asnFileHistoryIntegration, authorizationOptions);
    asnFileDownloadUrl.addMethod("GET", asnFileDownloadIntegration, authorizationOptions);
    inventoryMovements.addMethod("GET", inventoryMovementsIntegration, authorizationOptions);

    // S3 Event Notification to trigger Lambda on file upload

    uploadBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(invFileProcessorHandler),
    );
    templateUploadBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(templateFileProcessorHandler),
    );
  }
}
