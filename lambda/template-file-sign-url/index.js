const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
  buildLoggedResponse,
  logApiRequest,
} = require("/opt/nodejs/userContext");

const s3 = new S3Client({ region: 'us-east-1' });

exports.handler = async (event) => {
  logApiRequest(event);

  const method = event.httpMethod;
  const body = event.body ? JSON.parse(event.body) : null;

  try {
    switch (method) {
      case "POST":
        return await getUploadUrl(body);

      default:
        return response(400, "Unsupported method");
    }
  } catch (err) {
    console.error(err);
    return response(500, err.message);
  }
};

const getUploadUrl = async (data) => {
  const { fileName, contentType } = data;

  const command = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: `uploads/${Date.now()}-${fileName}`,
    ContentType: contentType,
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 300 });

  console.log("Generated signed URL:", url);

  return response(200, { uploadUrl: url });
}

const response = buildLoggedResponse;
