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

module.exports = {
  getUserContext,
  getUserName,
};
