const AWS = require("aws-sdk");
const {
  buildLoggedResponse,
  logApiRequest,
} = require("/opt/nodejs/userContext");
const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({});

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
      case "GET":
        console.log("Generating download link for ASN file");
        return await generateDownloadLink(sk);

      default:
        return response(400, "Unsupported method");
    }
  } catch (err) {
    console.error(err);
    return response(500, err.message);
  }
};

const generateDownloadLink = async (sk) => {
  if (!sk) {
    return response(400, "Missing sk parameter");
  }

  // Query the item by sk to get the file name
  const result = await dynamo
    .get({
      TableName: TABLE_NAME,
      Key: {
        pk: "ASN_FILE",
        sk: sk,
      },
    })
    .promise();

  if (!result.Item) {
    return response(404, "ASN file not found");
  }

  console.log("Retrieved item:", JSON.stringify(result.Item));

  const fileName = result.Item.fileName;
  const fileKey = result.Item.fileKey;

  const command = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: fileKey,
    ResponseContentDisposition: `attachment; filename="${fileName}"`, // forces download name
    ResponseContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const fileUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

  return response(200, { fileName, fileUrl });
};

const response = buildLoggedResponse;
