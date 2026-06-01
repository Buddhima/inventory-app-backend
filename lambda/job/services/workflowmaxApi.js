const axios = require("axios");
const AWS = require("aws-sdk");
const ssm = new AWS.SSM();

const BASE_URL = process.env.WFM_BASE_URL;
const ACCOUNT_ID = process.env.WFM_ACCOUNT_ID;

if (!BASE_URL || !ACCOUNT_ID) {
  throw new Error("WorkflowMax environment variables are missing");
}

const logWorkflowMaxRequest = ({ method, url, headers, payload }) => {
  console.log("WorkflowMax request", {
    method,
    url,
    headers,
    payload,
  });
};

const logWorkflowMaxResponse = ({ method, url, status, headers, payload }) => {
  console.log("WorkflowMax response", {
    method,
    url,
    status,
    headers,
    payload,
  });
};

const logWorkflowMaxErrorResponse = ({ method, url, error }) => {
  if (!error.response) {
    console.error("WorkflowMax request failed before receiving response", {
      method,
      url,
      message: error.message,
    });
    return;
  }

  console.error("WorkflowMax error response", {
    method,
    url,
    status: error.response.status,
    headers: error.response.headers,
    payload: error.response.data,
  });
};

/**
 * Retrieve WorkflowMax API token from SSM Parameter Store
 */
const getWfmToken = async () => {
  const paramName = process.env.WFM_CONFIG_PARAM_NAME;

  const param = await ssm
    .getParameter({
      Name: paramName,
    })
    .promise();

  if (!param.Parameter || !param.Parameter.Value) {
    throw new Error(`App config parameter ${paramName} not found`);
  }

  console.log("Fetched WorkflowMax config parameter");
  const cachedConfig = JSON.parse(param.Parameter.Value);

  return cachedConfig.access_token;
};

/**
 * Generic POST request to WorkflowMax API
 */
async function postToWorkflowMax(endpoint, data) {
  try {
    const API_TOKEN = await getWfmToken();

    const url = `${BASE_URL}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      "account-id": ACCOUNT_ID,
      Authorization: `Bearer ${API_TOKEN}`,
    };

    logWorkflowMaxRequest({
      method: "POST",
      url,
      headers,
      payload: data,
    });

    const response = await axios.post(url, data, {
      headers,
    });

    logWorkflowMaxResponse({
      method: "POST",
      url,
      status: response.status,
      headers: response.headers,
      payload: response.data,
    });

    if (response.status < 200 || response.status >= 300) {
      console.error("WorkflowMax non-2xx response", {
        endpoint,
        status: response.status,
        payload: response.data,
      });

      throw new Error(
        `WorkflowMax returned ${response.status} for ${endpoint} with response payload: ${JSON.stringify(response.data || {})}`
      );
    }

    return response.data;
  } catch (err) {
    const url = `${BASE_URL}${endpoint}`;
    logWorkflowMaxErrorResponse({ method: "POST", url, error: err });
    console.error(`WorkflowMax API call failed: ${endpoint}`, err.message);
    throw new Error(`WorkflowMax API call failed: ${endpoint}`);
  }
}

/**
 * Create a job
 * Docs: https://api-docs.workflowmax.com/job-1/post-v2-jobs
 */
async function createJob(jobData) {
  return postToWorkflowMax("jobs", jobData);
}

/**
 * Create job costs
 * Docs: https://api-docs.workflowmax.com/job-cost/post-v2-jobs-uuid-costs-copy
 */
async function createJobCosts(jobUuid, costData) {
  return postToWorkflowMax(`jobs/${jobUuid}/costs`, costData);
}

module.exports = { createJob, createJobCosts };
