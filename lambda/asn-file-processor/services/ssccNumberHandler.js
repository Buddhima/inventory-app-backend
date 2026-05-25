const AWS = require("aws-sdk");
const ssm = new AWS.SSM();

const getSsccPostfix = async () => {
  const paramName = process.env.SSCC_POSTFIX_PARAM_NAME;

  const param = await ssm
    .getParameter({
      Name: paramName,
    })
    .promise();

  if (!param.Parameter || !param.Parameter.Value) {
    throw new Error(`SSCC postfix parameter ${paramName} not found`);
  }

  console.log("Fetched SSCC postfix parameter", param.Parameter.Value);
  return param.Parameter.Value;
};

const setSsccPostfix = async (newValue) => {
  const paramName = process.env.SSCC_POSTFIX_PARAM_NAME;

  if (!paramName) throw new Error("SSCC_POSTFIX_PARAM_NAME not set");
  if (newValue === undefined || newValue === null)
    throw new Error("New postfix value is required");

  const result = await ssm
    .putParameter({
      Name: paramName,
      Value: String(newValue),
      Type: "String",   
      Overwrite: true,
    })
    .promise();

  console.log("SSCC postfix updated:", newValue);
  return result;
};

module.exports = { getSsccPostfix, setSsccPostfix };
