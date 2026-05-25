const AWS = require("aws-sdk");
const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  const method = event.httpMethod;
  const id = event.pathParameters?.id;
  const body = event.body ? JSON.parse(event.body) : null;

  try {
    return await listItems();

    // switch (method) {
    //   case "POST":
    //     return await createItem(body);

    //   case "GET":
    //     if (id) {
    //       return await getItem(id); // GET /items/{id}
    //     } else {
    //       return await listItems(); // GET /items
    //     }

    //   case "PUT":
    //     return await updateItem(id, body);

    //   case "DELETE":
    //     return await deleteItem(id);

    //   default:
    //     return response(400, "Unsupported method");
    // }
  } catch (err) {
    console.error(err);
    return response(500, err.message);
  }
};

const createItem = async (item) => {
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: item,
    })
    .promise();

  return response(201, item);
};

const getItem = async (id) => {
  const result = await dynamo
    .get({
      TableName: TABLE_NAME,
      Key: { id },
    })
    .promise();

  return response(200, result.Item);
};

const updateItem = async (id, data) => {
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: { id, ...data },
    })
    .promise();

  return response(200, { id, ...data });
};

const deleteItem = async (id) => {
  await dynamo
    .delete({
      TableName: TABLE_NAME,
      Key: { id },
    })
    .promise();

  return response(204);
};

const listItems = async () => {
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
    })
    .promise();
  const items = result.Items;

  // 2. Aggregate quantities
  const quantities = {};

  items.forEach((item) => {
    const id = item.id;
    const name = item.name;

    const type = item.pk.startsWith("STOCK") ? "STOCK" : "CONSUME"; // adapt prefix if needed
    const qty = item.quantity || 0;

    if (!quantities[id]) quantities[id] = { id, name, quantity: 0 };

    if (type === "STOCK") {
      quantities[id].quantity += qty;
    } else if (type === "CONSUME") {
      quantities[id].quantity -= qty;
    }
  });

  return response(200, Object.values(quantities));
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
