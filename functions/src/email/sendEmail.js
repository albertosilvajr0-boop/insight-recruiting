import { getGmailClient } from '../utils/googleAuth.js'

const SENDER = process.env.GMAIL_SENDER || 'albertosilva@silvaconsultinggroup.com'

export async function sendEmail({ to, subject, html }) {
  const gmail = await getGmailClient()

  const rawMessage = [
    `From: San Antonio Dodge <${SENDER}>`,
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
