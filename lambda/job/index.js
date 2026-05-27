const AWS = require("aws-sdk");
const { getUserContext } = require("/opt/nodejs/userContext");
const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;
const { createJob, createJobCosts } = require("./services/workflowmaxApi");
const Job = require("./models/Job");

const ssm = new AWS.SSM();
let cachedConfig;

exports.handler = async (event) => {
  const method = event.httpMethod;
  const id = event.pathParameters?.id;
  const body = event.body ? JSON.parse(event.body) : null;

  try {
    switch (method) {
      case "POST":
        return await createItem(body, getUserContext(event));

      default:
        return response(400, "Unsupported method");
    }
  } catch (err) {
    console.error(err);
    return response(500, err.message);
  }
};

const createItem = async (item, performedBy) => {
  // 1. Call endppoint to create job
  const job = Job.fromRequest(item);
  console.log("Job Model:", JSON.stringify(job));

  const jobName = `${job.bomHeader} ${job.bomHeaderDescription}`;
  const components = job.components || [];
  const d = getCurrentDate();
  const appConfig = await getAppConfig();

  console.log("Creating job in WorkflowMax with name:", jobName);

  // TODO: use models
  const jobPayload = {
    clientUUID: appConfig.clientUUID,
    jobName: jobName,
    budget: 0,
    description: "Add job description here",
    startDate: `${d.year}-${d.month}-${d.date}`,
    dueDate: `${d.year}-${d.month}-${d.date}`,
    priority: appConfig.priority,
    statusUUID: appConfig.statusUUID,
    customFields: [
      {
        uuid: appConfig.customFieldUUIDs.bomEAN,
        value: job.bomEAN,
      },
      {
        uuid: appConfig.customFieldUUIDs.signature,
        value: job.signature,
      },
      {
        uuid: appConfig.customFieldUUIDs.supplier,
        value: job.supplier,
      },
    ],
  };

  let jobNumber;
  let jobUuid;

  try {
    const jobResponse = await createJob(jobPayload);
    console.log("WorkflowMax Job Creation Response:", jobResponse);

    jobNumber = jobResponse?.jobNumber;
    jobUuid = jobResponse?.uuid;

    console.log("Created Job Number:", jobNumber, "UUID:", jobUuid);

    if (!jobNumber) {
      await recordFailedJob(
        job,
        `Failed to find job number in WorkflowMax response`
      );

      throw new Error("Failed to find job number in WorkflowMax response");
    }
  } catch (err) {
    console.error("Error creating job in WorkflowMax:", err);
    await recordFailedJob(
      job,
      `Error creating job in WorkflowMax: ${err.message}`
    );

    throw new Error("Failed to create job in WorkflowMax");
  }

  // 2. Call cost items endpoint

  for (const component of components) {
    const costPayload = {
      costName: component.componentDescription,
      date: `${d.year}-${d.month}-${d.date}`,
      actual: true,
      unitCost: component.unitCost,
      unitPrice: 0,
      quantity: component.componentQuantity,
      type: "Service",
      billable: true,
      customFields: [
        {
          uuid: appConfig.customFieldUUIDs.componentCode,
          value: component.componentCode,
        },
        {
          uuid: appConfig.customFieldUUIDs.componentEAN,
          value: component.componentEAN,
        },
      ],
    };

    const costResponse = await createJobCosts(jobUuid, costPayload);
    console.log("WorkflowMax Job Cost Creation Response:", costResponse);

    if (!costResponse.uuid) {
      console.error(
        "Failed to create job cost for component:",
        component.componentCode
      );
      throw new Error("Failed to create job-cost in WorkflowMax");
    }
  }

  // 3. Record job in DynamoDB with job_number
  const timeStamp = Date.now();
  const data = {
    pk: `JOB`,
    sk: `${jobNumber}`,
    ...job,
    jobNumber: jobNumber,
    jobName: jobName,
    jobUuid: jobUuid,
    status: "CREATED",
    ...(performedBy ? { performedBy } : {}),
    createdAt: timeStamp,
  };
  console.log("Storing job item:", JSON.stringify(data));
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: data,
    })
    .promise();

  // 4. Create CONSUME items in DynamoDB for cost items
  for (const costItem of components) {

    if(costItem.isAdditionalCost) {
      console.log(`Skipping CONSUME item creation for additional cost component: ${costItem.componentCode}`);
      continue;
    }

    const consumeData = {
      pk: `CONSUME`,
      sk: `${costItem.componentCode}#${timeStamp}`,
      ...costItem,
      id: costItem.componentCode,
      quantity: costItem.componentQuantity,
      jobNumber: jobNumber,
      ...(performedBy ? { performedBy } : {}),
      createdAt: timeStamp,
    };
    await dynamo
      .put({
        TableName: TABLE_NAME,
        Item: consumeData,
      })
      .promise();
  }
  // 5. Handle and store failed jobs

  return response(201, job);
};

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": "*", // allow your frontend origin here if needed
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
  },
  body: body ? JSON.stringify(body) : "",
});

const getCurrentDate = () => {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");

  return { year, month, date };
};

const getAppConfig = async () => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const paramName = process.env.APP_CONFIG_PARAM_NAME;
  const param = await ssm
    .getParameter({
      Name: paramName,
    })
    .promise();

  if (!param.Parameter || !param.Parameter.Value) {
    throw new Error(`App config parameter ${paramName} not found`);
  }

  cachedConfig = JSON.parse(param.Parameter.Value);
  return cachedConfig;
};

const recordFailedJob = async (item, reason) => {
  const timeStamp = Date.now();

  console.error(
    `Recording failed job: ${JSON.stringify(item)} Reason: ${reason}`
  );

  const data = {
    pk: `FAILED_JOB`,
    sk: `${timeStamp}`,
    payload: JSON.stringify(item),
    status: "FAILED",
    failureReason: reason,
    createdAt: timeStamp,
  };
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: data,
    })
    .promise();

  throw new Error(reason);
};
