const AWS = require("aws-sdk");
const { getUserContext } = require("/opt/nodejs/userContext");
const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;

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
  const timeStamp = Date.now();
  const data = {
    pk: `STOCK`,
    sk: `${item.id}#${timeStamp}`,
    ...item, // only final quantity should be stored here
    ...(performedBy ? { performedBy } : {}),
    createdAt: timeStamp,
  };
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: data,
    })
    .promise();

  // Also store item metadata separately
  const metadata = {
    pk: `ITEM_METADATA`,
    sk: `${item.id}`,
    ...item,
    ...(performedBy ? { updatedBy: performedBy } : {}),
  };
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: metadata,
    })
    .promise();

  return response(201, item);
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
