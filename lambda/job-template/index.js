const AWS = require("aws-sdk");
const {
  buildLoggedResponse,
  logApiRequest,
} = require("/opt/nodejs/userContext");
const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  logApiRequest(event);

  const method = event.httpMethod;
  const encodedSk = event.queryStringParameters?.sk;
  const sk = encodedSk ? decodeURIComponent(encodedSk) : null;
  // const id = event.queryStringParameters?.id;
  // const timestamp = event.queryStringParameters?.timestamp;
  const body = event.body ? JSON.parse(event.body) : null;

  console.log(`sk: ${sk}`);

  try {
    switch (method) {
      case "POST":
        return await createItem(body);

      case "GET":
        if (sk) {
          console.log("Getting specific item");
          return await getItem(sk); // GET /job-template?sk={sk}
        } else {
          console.log("Listing items");
          return await listItems();
        }

      default:
        return response(400, "Unsupported method");
    }
  } catch (err) {
    console.error(err);
    return response(500, err.message);
  }
};

const getRemainingStock = async (componentCode) => {
  // Simulated stock quantity retrieval
  console.log(`Retrieving stock quantity for cost item ID: ${componentCode}`);

  const pks = ["STOCK", "CONSUME"];

  const results = await Promise.all(
    pks.map((pk) =>
      dynamo
        .query({
          TableName: TABLE_NAME,
          KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
          ExpressionAttributeNames: {
            "#pk": "pk",
            "#sk": "sk",
          },
          ExpressionAttributeValues: {
            ":pk": pk,
            ":skPrefix": `${componentCode}#`,
          },
        })
        .promise()
    )
  );

  console.log(`Query results for cost item ID: ${componentCode}:`, results);

  const items = results.flatMap((r) => r.Items);
  console.log(
    `Retrieved ${items.length} items for cost item ID: ${componentCode}`
  );

  const totalStock = items
    .filter((item) => item.pk === "STOCK")
    .reduce((sum, item) => sum + (item.quantity || 0), 0);
  const totalConsumed = items
    .filter((item) => item.pk === "CONSUME")
    .reduce((sum, item) => sum + (item.quantity || 0), 0);

  console.log(
    `Total stock: ${totalStock}, Total consumed: ${totalConsumed} for cost item ID: ${componentCode}`
  );

  const remainingStock = totalStock - totalConsumed;
  console.log(
    `Remaining stock for cost item ID ${componentCode}: ${remainingStock}`
  );

  return remainingStock;
};

const createItem = async (item) => {
  const jobTemplateName = `${item.id}#${item.description}`;

  const timeStamp = Date.now();
  const data = {
    pk: `JOB_TEMPLATE`,
    sk: `${jobTemplateName}`,
    ...item,
    createdAt: timeStamp,
  };
  console.log("raw item:", JSON.stringify(item));
  console.log("Storing job template item:", JSON.stringify(data));
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: data,
    })
    .promise();

  return response(201, item);
};

const getItem = async (sk) => {
  console.log("Getting item:", sk);

  const result = await dynamo
    .get({
      TableName: TABLE_NAME,
      Key: {
        pk: "JOB_TEMPLATE",
        sk: sk,
      },
    })
    .promise();

  const item = result.Item;
  console.log("Retrieved item:", JSON.stringify(item));

  if (item.components) {
    console.log("Components:", JSON.stringify(item.components));

    // Map async and wait for all
    item.components = await Promise.all(
      item.components.map(async (component) => ({
        ...component,
        stockQty: await getRemainingStock(component.componentCode),
      }))
    );
  }

  return response(200, item);
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
        ":job": "JOB_TEMPLATE",
      },
    })
    .promise();
  const items = result.Items;

  // Filter metadata only
  const itemMeta = items.map((item) => ({
    bomHeader: item.bomHeader,
    bomHeaderDescription: item.bomHeaderDescription,
    sk: item.sk,
  }));

  return response(200, itemMeta);
};

const response = buildLoggedResponse;
