import { getFirestore } from 'firebase-admin/firestore'
import { sendEmail } from './sendEmail.js'
import { ADMIN_EMAIL, getCandidateClientName } from '../config/organization.js'

async function getNewApplicationRecipients() {
  const db = getFirestore()
  const snap = await db.collection('users')
    .where('newApplicantEmailAlerts', '==', true)
    .get()

  const recipients = new Set()
  snap.docs.forEach((doc) => {
    const user = doc.data()
    if (user.disabled === true || !user.email) return
    recipients.add(String(user.email).toLowerCase())
  })

  if (recipients.size === 0) {
    recipients.add(ADMIN_EMAIL.toLowerCase())
  }

  return [...recipients]
}

export async function sendNewApplicationNotification(candidate) {
  const { firstName, lastName, email, phone, jobTitle } = candidate
  const name = `${firstName} ${lastName}`
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Denver' })
  const recipients = await getNewApplicationRecipients()
  const clientName = getCandidateClientName(candidate)

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto;">
      <div style="background: #2563eb; color: white; padding: 16px 24px; border-radius: 12px 12px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">New Application Received</h2>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <p style="margin: 0 0 16px; color: #374151; font-size: 15px;">
          A new candidate just completed their digital interview.
        </p>
        <table style="width: 100%; font-size: 14px; color: #374151;">
          <tr><td style="padding: 6px 0; font-weight: 600; width: 100px;">Name</td><td style="padding: 6px 0;">${name}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600;">Position</td><td style="padding: 6px 0;">${jobTitle || 'Not specified'}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600;">Email</td><td style="padding: 6px 0;">${email}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600;">Phone</td><td style="padding: 6px 0;">${phone || 'Not provided'}</td></tr>
          <tr><td style="padding: 6px 0; font-weight: 600;">Submitted</td><td style="padding: 6px 0;">${now}</td></tr>
        </table>
        <p style="margin: 16px 0 0; font-size: 13px; color: #6b7280;">
          Scoring is in progress. Check the admin dashboard for results once complete.
        </p>
      </div>
    </div>
  `

  const subject = `New Application: ${name} - ${jobTitle || clientName}`
  const results = await Promise.allSettled(
    recipients.map((recipient) => sendEmail({ to: recipient, subject, html }))
  )
  const failures = results
    .map((result, index) => ({ result, recipient: recipients[index] }))
    .filter(({ result }) => result.status === 'rejected')

  failures.forEach(({ result, recipient }) => {
    console.error(`[email] Failed to send new application alert to ${recipient}:`, result.reason)
  })

  if (failures.length === recipients.length) {
    throw new Error('Failed to send new application alert to every configured recipient.')
  }
}
