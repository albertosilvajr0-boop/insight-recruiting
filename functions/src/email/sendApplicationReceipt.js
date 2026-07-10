import { sendEmail } from './sendEmail.js'
import { getCandidateClientName } from '../config/organization.js'

// Candidate-facing confirmation + status portal link. Sent right after the
// admin notification so the candidate has a permanent record of their app
// and can come back to check status without needing an account.
export async function sendApplicationReceipt(candidate, baseUrl) {
  const { firstName, email, jobTitle, statusToken } = candidate
  if (!email) return
  const statusUrl = statusToken && baseUrl ? `${baseUrl}/status/${statusToken}` : null
  const clientName = getCandidateClientName(candidate)

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto;">
      <div style="background: #2563eb; color: white; padding: 20px 24px; border-radius: 12px 12px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">Application received</h2>
        <p style="margin: 4px 0 0; opacity: 0.9; font-size: 13px;">${clientName}</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px; color: #374151;">
        <p style="margin: 0 0 12px; font-size: 15px;">Hi ${firstName || 'there'},</p>
        <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.55;">
          Thanks for applying for the <strong>${jobTitle || clientName}</strong> position. We've received your resume and interview responses, and our hiring team will review them shortly - you'll hear back from us within 1 business day.
        </p>
        ${statusUrl ? `
          <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #1e40af;">Track your application</p>
            <p style="margin: 0 0 8px; font-size: 13px; color: #1e3a8a;">Check your status anytime - no account required.</p>
            <a href="${statusUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 8px 14px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">View application status</a>
          </div>
        ` : ''}
        <p style="margin: 16px 0 0; font-size: 13px; color: #6b7280;">
          Questions? Just reply to this email.
        </p>
      </div>
    </div>
  `

  await sendEmail({
    to: email,
    subject: `We got your application - ${clientName}`,
    html
  })
}
