import { Router } from 'express';
import { sendEmail } from '../services/gmailService.js';

export const emailRouter = Router();

// Phase 1 test endpoint: send a single email from the active account.
// Body: { to, subject, html }  (to/subject/html optional — defaults send a
// test mail to yourself so you can prove the integration end-to-end).
emailRouter.post('/test', async (req, res) => {
  const account = req.session.email;
  if (!account) {
    return res.status(401).json({ error: 'No Gmail account connected. Visit /auth/google first.' });
  }

  const to = req.body?.to || account;
  const subject = req.body?.subject || 'Test email from your cold-email app 🎉';
  const html =
    req.body?.html ||
    `<p>Hi,</p><p>This is a test email sent through <b>${account}</b> via the Gmail API.</p>
     <p>If you're reading this, Phase 1 works.</p>`;

  try {
    const result = await sendEmail({ account, to, subject, html });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[email] send failed:', err);
    res.status(500).json({ error: err.message });
  }
});
