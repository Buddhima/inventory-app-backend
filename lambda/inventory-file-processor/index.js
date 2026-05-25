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

    // Convert S3 Body (stream) to Buffer
    const chunks = [];
    for await (const chunk of Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks); // TODO: potential memory issue with large files

    // Read Excel workbook
    const workbook = XLSX.read(buffer, { type: "buffer" }); // TODO: potential memory issue with large files

    // Get the first sheet name
    const sheetName = workbook.SheetNames[0];

    // Convert sheet to JSON array
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const data = rawData.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key.trim(), value])
      )
    );

    console.log("Parsed data:", data);

    // Process each row (example: create stock items)
    for (const row of data) {
      try {
        // console.log(`Type of row: ${typeof row}, row data: ${JSON.stringify(row)}, Code: ${row["Code"]}`);
        if (!row["Code"]) {
          console.warn(`Skipping row without Code: ${JSON.stringify(row)}`);
          continue;
        }
        await createItem(row);
        await createMetadataItem({ fileName: key, item: row });
      } catch (error) {
        console.error(`Error processing row ${JSON.stringify(row)}:`, error);
      }
    }

    console.log(`Finished processing file: ${key}`);

    return true;
  }
};

const createItem = async (item) => {
  const timeStamp = Date.now();
  const id = item["Code"];
  const name = item["Code description"];
  const quantity = item["Pallet QTY"] || 0;

  const data = {
    pk: `STOCK`,
    sk: `${id}#${timeStamp}`,
    id,
    name,
    quantity,
    createdAt: timeStamp,
  };
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: data,
    })
    .promise();

  return true;
};

const createMetadataItem = async ({ fileName, item }) => {
  const timeStamp = Date.now();
  const id = item["Code"];
  const name = item["Code description"];
  const quantity = item["Pallet QTY"] || 0;

  const data = {
    pk: `ITEM_METADATA`,
    sk: `${id}`,
    id,
    name,
    quantity,
    ...item,
    fileName,
    createdAt: timeStamp,
  };
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: data,
    })
    .promise();

  return true;
};
