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

const {
  getSsccPostfix,
  setSsccPostfix,
} = require("./services/ssccNumberHandler");

const s3 = new S3Client({});

exports.handler = async (event) => {
  const method = event.httpMethod;

  try {
    const body = event.body ? JSON.parse(event.body) : null;

    switch (method) {
      case "POST":
        console.log("Generating ASN file");
        return await generateAsnFile(body);

      default:
        return response(400, "Unsupported method");
    }
  } catch (err) {
    console.error(err);
    if (err instanceof SyntaxError) {
      return response(400, "Invalid JSON request body");
    }

    return response(500, err.message);
  }
};

const generateAsnFile = async (body) => {
  console.log("Received body:", body);

  const validationError = validateGenerateAsnRequest(body);
  if (validationError) {
    return response(400, validationError);
  }

  const jobNumber = body.jobNumber;

  try {
    const jobResult = await dynamo
      .get({
        TableName: TABLE_NAME,
        Key: {
          pk: "JOB",
          sk: jobNumber,
        },
      })
      .promise();

    const jobItem = jobResult.Item;
    const timeStamp = Date.now();

    console.log(`Generating ASN file for jobNumber: ${jobNumber}`);

    const asnFileContent = await generateAsnFileContent(body, jobItem);

    console.log("Generated ASN file content:", asnFileContent);

    const fileNamePart = jobItem?.jobName || jobNumber;
    const fileName = `ASN_${fileNamePart}_${timeStamp}.xlsx`;
    const fileKey = `asn-files/${fileName}`;

    const fileUrl = await uploadAndGetLink(fileKey, asnFileContent);

    console.log(`ASN file uploaded to S3: ${fileUrl}`);

    // Store the generated file URL and original request payload for reference.
    const asnFileData = {
      ...(jobItem || {}),
      pk: `ASN_FILE`,
      sk: `${jobNumber}#${timeStamp}`,
      jobNumber,
      purchasingDoc: body.purchasingDoc,
      supplier: body.supplier,
      fileName,
      fileKey,
      createdAt: timeStamp,
      requestPayload: body,
    };
    await dynamo
      .put({
        TableName: TABLE_NAME,
        Item: asnFileData,
      })
      .promise();

    return response(200, { fileName, fileUrl });
  } catch (err) {
    console.error("Error generating ASN file:", err);
    return response(500, "Error generating ASN file");
  }
};

const validateGenerateAsnRequest = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Missing or invalid request body";
  }

  const requiredFields = [
    "jobNumber",
    "plant",
    "poItem",
    "material",
    "supplier",
    "deliveryQtyUnit",
    "deliveryNote",
    "deliveryDate",
    "shippingDate",
    "storageLocation",
    "manufacturingDate",
    "packId",
    "qtyUnit",
    "batchComponents",
    "lines",
  ];

  for (const field of requiredFields) {
    if (
      body[field] === undefined ||
      body[field] === null ||
      body[field] === ""
    ) {
      return `Missing required field: ${field}`;
    }
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return "Missing required field: lines";
  }

  for (const [index, line] of body.lines.entries()) {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      return `Invalid line at index ${index}`;
    }

    if (!line.batchNumber) {
      return `Missing required field: lines[${index}].batchNumber`;
    }

    if (!line.components) {
      return `Missing required field: lines[${index}].components`;
    }

    if (
      line.quantity === undefined ||
      line.quantity === null ||
      line.quantity === ""
    ) {
      return `Missing required field: lines[${index}].quantity`;
    }

    if (typeof line.quantity !== "number" || line.quantity <= 0) {
      return `Invalid quantity at index ${index}`;
    }
  }

  return null;
};

const generateAsnFileContent = async (payload, jobItem) => {
  console.log(
    "Generating ASN file content with payload:",
    JSON.stringify(payload),
    "and jobItem:",
    JSON.stringify(jobItem),
  );

  const ssccPostfixStr = await getSsccPostfix();
  console.log(`Retrieved SSCC postfix from SSM: ${ssccPostfixStr}`);
  let ssccPostfix = parseInt(ssccPostfixStr, 10);

  if (isNaN(ssccPostfix)) {
    throw new Error(`Invalid SSCC postfix value in SSM: ${ssccPostfixStr}`);
  }

  const { year, month, day } = await getTodayParts();

  const defaultRecord = {
    plant: payload.plant,
    purchasingDoc: payload.purchasingDoc || "",
    poItem: payload.poItem,
    material: payload.material,
    supplier: payload.supplier,
    deliveryQtyUnit: payload.deliveryQtyUnit,
    deliveryNote: payload.deliveryNote || "",
    deliveryDate: payload.deliveryDate,
    shippingDate: payload.shippingDate,
    billOfLading: payload.billOfLading || "",
    storageLocation: payload.storageLocation,
    issuingStorageLocation: payload.issuingStorageLocation || "",
    supplierBatch: payload.supplierBatch || "",
    sled: payload.sled || "",
    manufacturingDate: payload.manufacturingDate,
    packId: payload.packId,
    qtyUnit: payload.qtyUnit,
    batchComponents: payload.batchComponents,
    returnComponents: payload.returnComponents || "",
    meansOfTransportType: payload.meansOfTransportType || "",
    meansOfTransportId: payload.meansOfTransportId || "",
  };

  const records = payload.lines.map((line, index) => {
    const ssccNumber =
      line.ssccNumber ||
      `${payload.supplier}${day}${month}${year}${String(ssccPostfix)}`;
    const record = {
      ...defaultRecord,
      plant: line.plant || defaultRecord.plant,
      purchasingDoc: line.purchasingDoc || defaultRecord.purchasingDoc,
      poItem: line.poItem || defaultRecord.poItem,
      material: line.material || defaultRecord.material,
      supplier: line.supplier || defaultRecord.supplier,
      deliveryQty: line.deliveryQty ?? line.quantity,
      deliveryQtyUnit: line.deliveryQtyUnit || defaultRecord.deliveryQtyUnit,
      deliveryNote: line.deliveryNote || defaultRecord.deliveryNote,
      deliveryDate: line.deliveryDate || defaultRecord.deliveryDate,
      shippingDate: line.shippingDate || defaultRecord.shippingDate,
      billOfLading: line.billOfLading || defaultRecord.billOfLading,
      storageLocation: line.storageLocation || defaultRecord.storageLocation,
      issuingStorageLocation:
        line.issuingStorageLocation || defaultRecord.issuingStorageLocation,
      batch: line.batch || line.batchNumber,
      supplierBatch: line.supplierBatch || defaultRecord.supplierBatch,
      batchQty: line.batchQty ?? line.quantity,
      sled: line.sled || defaultRecord.sled,
      manufacturingDate:
        line.manufacturingDate || defaultRecord.manufacturingDate,
      ssccNumber,
      ssccQty: line.ssccQty ?? line.quantity,
      packId: line.packId || defaultRecord.packId,
      components: line.components || line.component || "",
      componentsQty: line.componentsQty ?? line.componentQty ?? line.quantity,
      qtyUnit: line.qtyUnit || defaultRecord.qtyUnit,
      batchComponents: line.batchComponents || defaultRecord.batchComponents,
      returnComponents: line.returnComponents || defaultRecord.returnComponents,
      meansOfTransportType:
        line.meansOfTransportType || defaultRecord.meansOfTransportType,
      meansOfTransportId:
        line.meansOfTransportId || defaultRecord.meansOfTransportId,
    };

    ssccPostfix++;
    return record;
  });

  console.log(`Generated ASN file records: ${JSON.stringify(records)}`);

  try {
    const fieldOrder = [
      "plant",
      "purchasingDoc",
      "poItem",
      "material",
      "supplier",
      "deliveryQty",
      "deliveryQtyUnit",
      "deliveryNote",
      "deliveryDate",
      "shippingDate",
      "billOfLading",
      "storageLocation",
      "issuingStorageLocation",
      "batch",
      "supplierBatch",
      "batchQty",
      "sled",
      "manufacturingDate",
      "ssccNumber",
      "ssccQty",
      "packId",
      "components",
      "componentsQty",
      "qtyUnit",
      "batchComponents",
      "returnComponents",
      "meansOfTransportType",
      "meansOfTransportId",
    ];

    const worksheet = XLSX.utils.json_to_sheet(records, {
      header: fieldOrder,
    });

    const customHeaders = [
      [
        "Plant",
        "Purchasing doc",
        "PO item",
        "Material",
        "Supplier",
        "Delivery qty",
        "Delivery qty unit",
        "Delivery note",
        "Delivery date",
        "Shipping date",
        "Bill of lading",
        "Storage Location",
        "Issuing Storage Location",
        "Batch",
        "Supplier Batch",
        "Batch Qty",
        "SLED ",
        "Manufactring date",
        "SSCC",
        "SSCC Qty",
        "Pack id",
        "Components",
        "Components qty",
        "Qty unit",
        "Batch Components",
        "Return Components",
        "Means-of-Transport Type",
        "Means of Transport ID",
      ],
    ];

    XLSX.utils.sheet_add_aoa(worksheet, customHeaders, { origin: "A1" });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Production Declaration ASN",
    );

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
