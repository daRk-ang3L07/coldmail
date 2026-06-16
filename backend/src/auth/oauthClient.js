import { google } from 'googleapis';
import { env, GOOGLE_SCOPES } from '../config/env.js';
import { getTokens, saveTokens } from '../lib/tokenStore.js';

/** Create a bare OAuth2 client (no credentials attached yet). */
export function createOAuthClient() {
  return new google.auth.OAuth2(
    env.google.clientId,
    env.google.clientSecret,
    env.google.redirectUri,
  );
}

/** Build the Google consent-screen URL the user is redirected to. */
export function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline', // <- required to receive a refresh_token
    prompt: 'consent', // <- force refresh_token even on repeat logins
    scope: GOOGLE_SCOPES,
  });
}

/**
 * Return an authorized OAuth2 client for a connected account.
 * It auto-refreshes the access token and persists any new tokens.
 */
export async function getAuthorizedClient(email) {
  const tokens = await getTokens(email);
  if (!tokens) throw new Error(`No connected Gmail account for ${email}. Connect it first.`);

  const client = createOAuthClient();
  client.setCredentials(tokens);

  // Persist refreshed tokens automatically.
  client.on('tokens', async (newTokens) => {
    await saveTokens(email, newTokens);
  });

  return client;
}
