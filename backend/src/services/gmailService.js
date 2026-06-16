import { google } from 'googleapis';
import { getAuthorizedClient } from '../auth/oauthClient.js';

/**
 * Encode a string to base64url (Gmail API requires URL-safe base64,
 * no padding) — used for the raw RFC 2822 message.
 */
function toBase64Url(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Encode a header value containing non-ASCII chars (RFC 2047). */
function encodeHeader(value) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * Build a raw MIME email. Sends HTML with a plain-text fallback
 * (multipart/alternative) so it renders well everywhere.
 */
function buildRawMessage({ from, to, subject, html, text, replyTo }) {
  const boundary = 'gmass_boundary_' + Math.random().toString(36).slice(2);
  const plain = text || html.replace(/<[^>]+>/g, '');

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    plain,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
    '',
    `--${boundary}--`,
  ];

  return [...headers, '', ...body].join('\r\n');
}

/**
 * Send an email through a connected Gmail account.
 * @param {object} opts
 * @param {string} opts.account  - the connected Gmail address sending the mail
 * @param {string} opts.to       - recipient address
 * @param {string} opts.subject
 * @param {string} opts.html     - HTML body
 * @param {string} [opts.text]   - optional plain-text body (auto-derived if omitted)
 * @param {string} [opts.threadId] - attach to an existing Gmail thread (for follow-ups)
 * @returns {Promise<{id: string, threadId: string}>}
 */
export async function sendEmail({ account, to, subject, html, text, threadId }) {
  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = toBase64Url(
    buildRawMessage({ from: account, to, subject, html, text }),
  );

  // Passing threadId + a matching "Re: …" subject makes Gmail thread the
  // follow-up under the original conversation.
  const requestBody = { raw };
  if (threadId) requestBody.threadId = threadId;

  const { data } = await gmail.users.messages.send({ userId: 'me', requestBody });

  return { id: data.id, threadId: data.threadId };
}

/**
 * Has the recipient replied in this thread? Our own sent messages carry the
 * Gmail 'SENT' label; an inbound reply does not — so any non-SENT message in
 * the thread means they responded.
 */
export async function checkThreadReplied(account, threadId) {
  if (!threadId) return false;
  const auth = await getAuthorizedClient(account);
  const gmail = google.gmail({ version: 'v1', auth });
  const { data } = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'minimal' });
  const messages = data.messages || [];
  return messages.some((m) => !(m.labelIds || []).includes('SENT'));
}
