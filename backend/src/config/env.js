import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value || value.startsWith('your-') || value.startsWith('change-me')) {
    console.warn(`[env] ${name} is not set (or still a placeholder). Some features will not work until you set it in backend/.env`);
  }
  return value;
}

const isProd = process.env.NODE_ENV === 'production';

export const env = {
  port: Number(process.env.PORT) || 4000,
  isProd,
  // Where to send the user after OAuth. Empty = same origin (prod, served by
  // Express). In React dev, set FRONTEND_URL=http://localhost:5173 in .env.
  frontendUrl: process.env.FRONTEND_URL || '',
  // Persistent data location (SQLite + tokens). On a host, point this at a
  // mounted volume so data survives restarts/redeploys.
  dataDir: process.env.DATA_DIR || '',
  // Secure cookies require HTTPS — on in production (behind the host's proxy).
  cookieSecure: isProd,
  sessionSecret: required('SESSION_SECRET') || 'dev-insecure-secret',
  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri: required('GOOGLE_REDIRECT_URI') || 'http://localhost:4000/auth/google/callback',
  },
};

// Scopes:
//  - gmail.send      -> send mail as the user
//  - gmail.readonly  -> later: detect replies so we skip people who already responded
//  - userinfo.email  -> identify which account is connected
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];
