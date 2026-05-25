const AWS = require("aws-sdk");
const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME;
const XLSX = require("xlsx");
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const { getJobDetails, getJobCosts } = require("./services/workflowmaxApi");
const {
  getSsccPostfix,
  setSsccPostfix,
} = require("./services/ssccNumberHandler");

const s3 = new S3Client({});
const PALLET_QUANTITY = 150; // Example: 10 units per pallet

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
      case "POST":
        console.log("Generating ASN file");
        return await generateAsnFile(body);

      default:
        return response(400, "Unsupported method");
    }
  } catch (err) {
    console.error(err);
    return response(500, err.message);
  }
};

const generateAsnFile = async (body) => {
  console.log("Received body:", body);

  // Validate input
  if (!body || !body.params.sk) {
    return response(400, "Missing required field: jobUuid");
  }

  const sk = body.params.sk;

  try {
    const jobResult = await dynamo
      .get({
        TableName: TABLE_NAME,
        Key: {
          pk: "JOB",
          sk: sk,
        },
      })
      .promise();

    const jobItem = jobResult.Item;

    if (!jobItem) {
      throw new Error("Job not found");
    }

    const jobUuid = jobItem.jobUuid;
    const jobNumber = jobItem.jobNumber;
    const timeStamp = Date.now();

    console.log(`Generating ASN file for jobUuid: ${jobUuid}`);

    const wfmJobData = await getJobDetails(jobUuid); // Implement this function to call WFM API and get job details
    const wfmJobCosts = await getJobCosts(jobUuid); // Implement this function to call WFM API and get job costs

    console.log("Retrieved WFM job data:", wfmJobData);

    const asnFileContent = await generateAsnFileContent(
      jobItem,
      wfmJobData,
      wfmJobCosts,
    );

    console.log("Generated ASN file content:", asnFileContent);

    const fileName = `ASN_${jobItem.jobName}_${timeStamp}.xlsx`;
    const fileKey = `asn-files/${fileName}`;

    const fileUrl = await uploadAndGetLink(fileKey, asnFileContent);

    console.log(`ASN file uploaded to S3: ${fileUrl}`);

    // Store the generated file URL in DynamoDB for reference
    const consumeData = {
      ...jobItem,
      pk: `ASN_FILE`,
      sk: `${jobNumber}#${timeStamp}`,
      fileName,
      fileKey,
      createdAt: timeStamp,
    };
    await dynamo
      .put({
        TableName: TABLE_NAME,
        Item: consumeData,
      })
      .promise();

    return response(200, { fileName, fileUrl });
  } catch (err) {
    console.error("Error generating ASN file:", err);
    return response(500, "Error generating ASN file");
  }
};

const generateAsnFileContent = async (jobItem, wfmJobData, wfmJobCosts) => {
  console.log(
    "Generating ASN file content with jobItem:",
    JSON.stringify(jobItem),
    "and wfmJobData:",
    JSON.stringify(wfmJobData),
    "and wfmJobCosts:",
    JSON.stringify(wfmJobCosts),
  );

  // Lookup WFM matching cost quantity to identify the accurate quantity for the ASN file
  // TODO: improve job savng to capture the quntity at the time of storing the job
  const initialComponent = jobItem.components[0];

  if (!initialComponent) {
    throw new Error("No components found in job item");
  }

  if (!wfmJobCosts || !wfmJobCosts.data) {
    console.log("No cost data found in WFM response:", wfmJobCosts);
    throw new Error("No cost data found in WFM response");
  }
  const matchingCost = wfmJobCosts.data.find(
    (cost) => cost.costName === initialComponent.componentDescription,
  );

  if (!matchingCost) {
    throw new Error(
      "Unable to find matching cost item in WFM data for component: " +
        initialComponent.componentDescription,
    );
  }

  const wfmQuantity = matchingCost.quantity || 0;

  if (wfmQuantity === 0) {
    return (
      "Matching cost item found in WFM data but quantity is zero for component: " +
      initialComponent.componentDescription
    );
  }

  const jobQuantity = wfmQuantity;

  console.log(
    `Using quantity ${jobQuantity} from WFM cost data for ASN file generation`,
  );

  const ssccPostfixStr = await getSsccPostfix();
  console.log(`Retrieved SSCC postfix from SSM: ${ssccPostfixStr}`);
  let ssccPostfix = parseInt(ssccPostfixStr, 10);

  if (isNaN(ssccPostfix)) {
    throw new Error(`Invalid SSCC postfix value in SSM: ${ssccPostfixStr}`);
  }

  const { year, month, day } = await getTodayParts();

  const VENDOR_NUMBER = "126757"; // Example vendor number, can be made dynamic if needed
  const numPallets = Math.floor(jobQuantity / PALLET_QUANTITY);
  const remainder = jobQuantity % PALLET_QUANTITY;

  const defaultRecord = {
    purchasingOrg: "N001",
    vendor: VENDOR_NUMBER,
    plant: "N001",
    companyCode: "N001",
    sapMaterialCode: jobItem.bomHeader,
    quantity: PALLET_QUANTITY,
    vendorMaterialCode: jobItem.bomHeader,
    materialCodeDescription: jobItem.bomHeaderDescription,
    shipmentNumber: "",
    shipmentDate: `${day}.${month}.${year}`,
    poNumber: wfmJobData.clientOrderNumber || "",
    batchNumber: "7MA11W",
  };

  const records = [];

  for (let i = 0; i < numPallets; i++) {
    records.push({
      ...defaultRecord,
      manualPallet: i + 1,
      ssccNumber: `${VENDOR_NUMBER}${day}${month}${year}${String(ssccPostfix)}`,
    });

    ssccPostfix++;
  }

  if (remainder > 0) {
    records.push({
      ...defaultRecord,
      manualPallet: numPallets + 1,
      ssccNumber: `${VENDOR_NUMBER}${day}${month}${year}${String(ssccPostfix)}`,
      quantity: remainder,
    });

    ssccPostfix++;
  }

  console.log(`Generated ASN file records: ${JSON.stringify(records)}`);

  try {
    const fieldOrder = [
      "purchasingOrg",
      "vendor",
      "plant",
      "companyCode",
      "sapMaterialCode",
      "quantity",
      "manualPallet",
      "ssccNumber",
      "vendorMaterialCode",
      "materialCodeDescription",
      "shipmentNumber",
      "shipmentDate",
      "poNumber",
      "batchNumber",
    ];

    const worksheet = XLSX.utils.json_to_sheet(records, { header: fieldOrder });

    const customHeaders = [
      [
        "Purchasing Org",
        "Vendor",
        "Plant",
        "Company Code",
        "SAP Material Code",
        "Quantity",
        "Manual pallet",
        "SSCC Number",
        "Vendor Material Code",
        "Material Code Description",
        "Shipment #",
        "Shipment Date",
        "PO Number",
        "Batch Number",
      ],
    ];

    XLSX.utils.sheet_add_aoa(worksheet, customHeaders, { origin: "A1" });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet);

    // Return as buffer (not file)
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  } catch (err) {
    console.error("Error generating ASN excel file content:", err);
    throw new Error("Error generating ASN excel file content");
  } finally {
    // Update SSCC postfix in SSM for next use
    await setSsccPostfix(ssccPostfix);
  }
};

async function uploadAndGetLink(key, buffer) {
  const bucketName = process.env.BUCKET_NAME;

  // Upload file
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );

  // Create signed URL (valid 1 hour)
  const command = new GetObjectCommand({ Bucket: bucketName, Key: key });

  const signedUrl = await getSignedUrl(s3, command, {
    expiresIn: 3600,
  });

  console.log("Generated signed URL for ASN file:", signedUrl);

  return signedUrl;
}

async function getTodayParts() {
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");

  return {
    year: now.getFullYear().toString(),
    month: pad2(now.getMonth() + 1),
    day: pad2(now.getDate()),
  };
}

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": "*", // allow your frontend origin here if needed
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
  },
  body: body ? JSON.stringify(body) : "",
});
