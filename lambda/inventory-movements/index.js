const AWS = require("aws-sdk");
const { getUserName } = require("/opt/nodejs/userContext");
const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  const method = event.httpMethod;

  try {
    switch (method) {
      case "GET":
        return await listMovements(event.queryStringParameters || {});

      default:
        return response(400, "Unsupported method");
    }
  } catch (err) {
    console.error(err);
    return response(err.statusCode || 500, err.message);
  }
};

const listMovements = async (query) => {
  const id = query.id;
  const type = query.type ? query.type.toUpperCase() : undefined;
  const from = parseTimestamp(query.from, "from");
  const to = parseTimestamp(query.to, "to");
  const limit = parseLimit(query.limit);

  if (type && type !== "ADDED" && type !== "CONSUMED") {
    return response(400, "type must be ADDED or CONSUMED");
  }

  let lastEvaluatedKey;
  const items = [];

  do {
    const result = await dynamo
      .scan({
        TableName: TABLE_NAME,
        FilterExpression: "#pk IN (:stock, :consume)",
        ExpressionAttributeNames: {
          "#pk": "pk",
        },
        ExpressionAttributeValues: {
          ":stock": "STOCK",
          ":consume": "CONSUME",
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
      .promise();

    items.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  const movements = items
    .map(toMovement)
    .filter((movement) => {
      if (id && movement.id !== id) return false;
      if (type && movement.type !== type) return false;
      if (from !== undefined && movement.createdAt < from) return false;
      if (to !== undefined && movement.createdAt > to) return false;
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  return response(200, limit ? movements.slice(0, limit) : movements);
};

const toMovement = (item) => {
  const type = item.pk === "STOCK" ? "ADDED" : "CONSUMED";

  return {
    id: item.id,
    name: item.name || item.componentDescription,
    type,
    quantity: item.quantity || 0,
    createdAt: item.createdAt,
    source: item.pk,
    jobNumber: item.jobNumber,
    performedByName: getUserName(item.performedBy),
  };
};

const parseTimestamp = (value, fieldName) => {
  if (!value) return undefined;

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return numericValue;
  }

  const dateValue = Date.parse(value);
  if (Number.isNaN(dateValue)) {
    throw validationError(`${fieldName} must be a timestamp or date string`);
  }

  return dateValue;
};

const parseLimit = (value) => {
  if (!value) return undefined;

  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw validationError("limit must be a positive integer");
  }

  return limit;
};

const validationError = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
  },
  body: body ? JSON.stringify(body) : "",
});
