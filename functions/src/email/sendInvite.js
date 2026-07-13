import { sendEmail } from './sendEmail.js'

export async function sendInviteEmail({ firstName, email, jobTitle, clientName, accessCode, inviteLink }) {
  const subject = `Your interview is ready — ${clientName}`

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
      <h2 style="color: #1d4ed8;">You're invited to interview</h2>
      <p>Hi ${firstName},</p>
      <p>Thanks for your interest in the <strong>${jobTitle}</strong> position with <strong>${clientName}</strong>. The next step is a short self-guided video interview you can complete from your phone or computer whenever you're ready.</p>
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0;">
        <p style="margin: 0 0 8px; font-size: 13px; color: #1e40af;">Your interview code</p>
        <p style="margin: 0; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #1d4ed8;">${accessCode}</p>
      </div>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${inviteLink}" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 600; display: inline-block;">Start my interview</a>
      </p>
      <p style="font-size: 14px; color: #374151;">Or go to <a href="${inviteLink}">${inviteLink}</a> and enter your code.</p>
      <p style="font-size: 14px; color: #374151;">A few tips before you start:</p>
      <ul style="font-size: 14px; color: #374151;">
        <li>Set aside about 20–30 minutes in a quiet spot.</li>
        <li>Use a device with a working camera and microphone.</li>
        <li>Some questions are timed — you'll see a countdown when they start.</li>
      </ul>
      <p style="font-size: 13px; color: #6b7280;">If you have any trouble with your code, just reply to this email.</p>
    </div>
  `

  await sendEmail({ to: email, subject, html })
}
