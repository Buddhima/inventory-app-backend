const AWS = require("aws-sdk");
const { getUserName } = require("/opt/nodejs/userContext");
const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  const method = event.httpMethod;
  const encodedSk = event.queryStringParameters?.sk;
  const sk = encodedSk ? decodeURIComponent(encodedSk) : null;
  // const id = event.queryStringParameters?.id;
  // const timestamp = event.queryStringParameters?.timestamp;
  const body = event.body ? JSON.parse(event.body) : null;

  console.log(`sk: ${sk}`);

  try {
    switch (method) {
      case "GET":
        console.log("Listing jobs");
        return await listItems();

      default:
        return response(400, "Unsupported method");
    }
  } catch (err) {
    console.error(err);
    return response(500, err.message);
  }
};

const listItems = async () => {
  const result = await dynamo
    .query({
      TableName: TABLE_NAME,
      KeyConditionExpression: "#pk = :job",
      ExpressionAttributeNames: {
        "#pk": "pk",
      },
      ExpressionAttributeValues: {
        ":job": "JOB",
      },
      ScanIndexForward: false,
    })
    .promise();
  const items = result.Items;

  // Filter metadata only
  const itemMeta = items.map((item) => ({
    jobNumber: item.jobNumber,
    jobName: item.jobName,
    jobUuid: item.jobUuid,
    createdAt: item.createdAt,
    sk: item.sk,
    performedByName: getUserName(item.performedBy),
  }));

  return response(200, itemMeta);
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
