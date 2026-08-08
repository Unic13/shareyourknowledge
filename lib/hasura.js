// lib/hasura.js
// Shared GraphQL client used by every /api/*.js function.
// Needs these two env vars set in Vercel:
//   HASURA_GRAPHQL_URL           e.g. https://your-app.hasura.app/v1/graphql
//   HASURA_GRAPHQL_ADMIN_SECRET
async function hasuraRequest(query, variables) {
  const url = process.env.HASURA_GRAPHQL_URL;
  const secret = process.env.HASURA_ADMIN_SECRET;

  if (!url || !secret) {
    throw new Error('Hasura is not configured (HASURA_GRAPHQL_URL / HASURA_GRAPHQL_ADMIN_SECRET missing)');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': secret,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json.data;
}

module.exports = { hasuraRequest };
