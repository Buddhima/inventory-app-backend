const XLSX = require("xlsx");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
// const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");
const AWS = require("aws-sdk");
const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;

const s3 = new S3Client({});
// const ddb = new DynamoDBClient({});

exports.handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const rawKey = record.s3.object.key;
    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));

    console.log(`Processing file: ${key} from bucket: ${bucket}`);

    // Get object from S3
    const { Body } = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    // console.log(`Step 1: Retrieved object from S3: ${key}`);

    // Convert S3 Body (stream) to Buffer
    const chunks = [];
    for await (const chunk of Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks); // TODO: potential memory issue with large files

    // console.log(`Step 2: Converted S3 object to buffer for file: ${key}`);

    // Read Excel workbook
    const workbook = XLSX.read(buffer, { type: "buffer" }); // TODO: potential memory issue with large files

    // console.log(`Step 3: Read Excel workbook for file: ${key}`);

    // Get the first sheet name
    const sheetName = workbook.SheetNames[0];

    // console.log(`Step 4: Retrieved sheet for file: ${key}`);

    // Convert sheet to JSON array
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // console.log(`Step 5: Converted sheet to JSON array for file: ${key}`);

    const data = rawData.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key.trim(), value])
      )
    );

    // console.log("Parsed data:", data);

    const groupedBOMs = {};

    // Process each row (example: create stock items)
    for (const row of data) {
      try {
        // console.log(`Type of row: ${typeof row}, row data: ${JSON.stringify(row)}, BOM Header: ${row["BOM Header"]}`);
        if (!row["BOM Header"]) {
          console.warn(
            `Skipping row without BOM Header: ${JSON.stringify(row)}`
          );
          continue;
        }

        const bomHeader = row["BOM Header"];

        if (!groupedBOMs[bomHeader]) {
          groupedBOMs[bomHeader] = {
            bomHeader: bomHeader,
            supplier: row["Supplier"],
            bomHeaderDescription: row["BOM Header Description"],
            bomEAN: row["EAN Code BOM header"],
            signature: row["Signature"],
            components: [],
          };
        }

        // Add component as sub-item
        groupedBOMs[bomHeader].components.push({
          componentCode: row["Component"],
          componentDescription: row["Component Description"],
          componentEAN: row["Component EAN"],
          unitCost: row["Unit Cost"],
        });
      } catch (error) {
        console.error(`Error processing row ${JSON.stringify(row)}:`, error);
      }
    }

    // Convert grouped object to array if needed
    const result = Object.values(groupedBOMs);

    console.log(`Finished processing file: ${key}`);

    console.log(`resulting BOM items: ${JSON.stringify(result)}`);

    await ensureStockItemsForComponents(result);

    for (const bomItem of result) {
      await createItem(bomItem);
    }

    console.log(`Storing BOM items to DynamoDB completed for file: ${key}`);

    return true;
  }
};

const ensureStockItemsForComponents = async (bomItems) => {
  const processedComponentCodes = new Set();

  for (const bomItem of bomItems) {
    for (const component of bomItem.components || []) {
      const componentCode = component.componentCode;

      if (!componentCode || processedComponentCodes.has(componentCode)) {
        continue;
      }

      processedComponentCodes.add(componentCode);
      await ensureZeroQuantityStockItem(component);
    }
  }
};

const ensureZeroQuantityStockItem = async (component) => {
  const componentCode = component.componentCode;
  const existingRecords = await Promise.all(
    ["STOCK", "CONSUME"].map((pk) =>
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
          Limit: 1,
        })
        .promise()
    )
  );

  const hasExistingStockOrConsumption = existingRecords.some(
    (record) => record.Items && record.Items.length > 0
  );

  if (hasExistingStockOrConsumption) {
    console.log(
      `Skipping the already existing component in the inventory: ${componentCode}`
    );
    return;
  }

  const timeStamp = Date.now();
  const data = {
    pk: "STOCK",
    sk: `${componentCode}#${timeStamp}`,
    id: componentCode,
    name: component.componentDescription,
    componentEAN: component.componentEAN,
    quantity: 0,
    source: "JOB_TEMPLATE_UPLOAD",
    createdAt: timeStamp,
  };

  console.log(
    `Creating zero quantity STOCK item for uploaded component: ${componentCode}`
  );

  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: data,
    })
    .promise();
};

const createItem = async (item) => {
  const timeStamp = Date.now();
  const id = item.bomHeader;

  console.log(`Creating JOB_TEMPLATE item with ID: ${id}, item: ${JSON.stringify(item)}`);

  const data = {
    pk: `JOB_TEMPLATE`,
    sk: `${id}#${timeStamp}`,
    ...item,
    createdAt: timeStamp,
  };
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: data,
    })
    .promise();

  console.log(`Successfully created JOB_TEMPLATE item with ID: ${id}`);

  return true;
};
