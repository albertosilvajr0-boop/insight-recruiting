import nodemailer from 'nodemailer'
import { getGmailClient } from '../utils/googleAuth.js'
import { EMAIL_SENDER_NAME } from '../config/organization.js'

const SENDER = process.env.GMAIL_SENDER || 'albertosilva@silvaconsultinggroup.com'

let smtpTransport = null

function getSmtpTransport() {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: SENDER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    })
  }
  return smtpTransport
}

export async function sendEmail({ to, subject, html, attachments, from }) {
  // `from` overrides the visible sender address. Gmail only honors it when
  // the address is a verified "Send mail as" alias on the SENDER account;
  // otherwise Gmail silently rewrites the header back to SENDER.
  const fromAddress = from || SENDER

  // Preferred path: Gmail SMTP with an app password (GMAIL_APP_PASSWORD
  // secret). The Gmail REST API path below requires domain-wide delegation,
  // which the default runtime service account does not have — without it,
  // API sends fail for every message.
  if (process.env.GMAIL_APP_PASSWORD) {
    await getSmtpTransport().sendMail({
      from: `${EMAIL_SENDER_NAME} <${fromAddress}>`,
      to,
      subject,
      html,
      ...(attachments?.length ? { attachments } : {}),
    })
    console.log(`[email] Sent "${subject}" to ${to} via SMTP`)
    return
  }

  if (attachments?.length) {
    // The raw Gmail API fallback below doesn't build multipart MIME.
    throw new Error('Attachments require the SMTP path (GMAIL_APP_PASSWORD secret).')
  }

  const gmail = await getGmailClient()

  const rawMessage = [
    `From: ${EMAIL_SENDER_NAME} <${fromAddress}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    html
  ].join('\r\n')

  const encoded = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded }
  })

  console.log(`[email] Sent "${subject}" to ${to}`)
}
