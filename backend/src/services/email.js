const nodemailer = require('nodemailer');

// Minimal outbound-email service (Plan 12 item 3). Consumers: portal password
// reset (routes/portal.js); operational alerts and notification digests hang
// off this later.
//
// Fail-safe by design: when SMTP is not configured, sendMail() logs and
// resolves false instead of throwing — email must never take a request down.
//
// Env: SMTP_HOST, SMTP_PORT (587 STARTTLS default), SMTP_USER, SMTP_PASS,
// SMTP_FROM (defaults to SMTP_USER).

let transporter = null;

function isEmailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Send one email. Returns true on success, false when unconfigured or on
 * failure (logged) — callers decide whether "not sent" matters.
 */
async function sendMail({ to, subject, text, html, attachments }) {
  if (!isEmailConfigured()) {
    console.warn(`[email] SMTP not configured — skipped "${subject}" to ${to}`);
    return false;
  }
  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      ...(html && { html }),
      ...(attachments && { attachments }),
    });
    console.log(`[email] sent "${subject}" to ${to}`);
    return true;
  } catch (err) {
    console.error(`[email] failed to send "${subject}" to ${to}: ${err.message}`);
    return false;
  }
}

module.exports = { sendMail, isEmailConfigured };
