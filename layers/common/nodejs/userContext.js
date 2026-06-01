const getClaim = (claims, key) => {
  const value = claims?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const compactObject = (value) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );

const getUserContext = (event) => {
  const claims = event?.requestContext?.authorizer?.claims || {};
  const givenName = getClaim(claims, "given_name");
  const familyName = getClaim(claims, "family_name");
  const fullName = [givenName, familyName].filter(Boolean).join(" ");

  const name =
    getClaim(claims, "name") ||
    (fullName || undefined) ||
    getClaim(claims, "email") ||
    getClaim(claims, "cognito:username") ||
    getClaim(claims, "sub");

  if (!name) {
    return undefined;
  }

  return compactObject({
    name,
    email: getClaim(claims, "email"),
    sub: getClaim(claims, "sub"),
    username: getClaim(claims, "cognito:username"),
  });
};

const getUserName = (performedBy) => performedBy?.name;

const DEFAULT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
};

const getClaimsUser = (claims = {}) => ({
  sub: claims.sub,
  username: claims["cognito:username"],
  email: claims.email,
  name: claims.name,
});

const logApiRequest = (event) => {
  console.log("Backend API request", {
    requestId: event?.requestContext?.requestId,
    stage: event?.requestContext?.stage,
    method: event?.httpMethod,
    resource: event?.resource,
    path: event?.path,
    headers: event?.headers,
    multiValueHeaders: event?.multiValueHeaders,
    pathParameters: event?.pathParameters,
    queryStringParameters: event?.queryStringParameters,
    multiValueQueryStringParameters: event?.multiValueQueryStringParameters,
    requestContext: {
      accountId: event?.requestContext?.accountId,
      apiId: event?.requestContext?.apiId,
      domainName: event?.requestContext?.domainName,
      identity: event?.requestContext?.identity,
      user: compactObject(
        getClaimsUser(event?.requestContext?.authorizer?.claims)
      ),
    },
    isBase64Encoded: event?.isBase64Encoded,
    body: event?.body,
  });
};

const buildLoggedResponse = (statusCode, body, headers = DEFAULT_HEADERS) => {
  const response = {
    statusCode,
    headers,
    body: body ? JSON.stringify(body) : "",
  };

  console.log("Backend API response", {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body,
  });

  return response;
};

module.exports = {
  buildLoggedResponse,
  getUserContext,
  getUserName,
  logApiRequest,
};
