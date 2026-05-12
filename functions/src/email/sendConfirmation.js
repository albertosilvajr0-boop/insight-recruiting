import { getFirestore } from 'firebase-admin/firestore'
import { sendEmail } from './sendEmail.js'
import { format, parseISO } from 'date-fns'

export async function sendConfirmationEmail(candidateId, slotDate, slotTime) {
  const db = getFirestore()
  const snap = await db.collection('candidates').doc(candidateId).get()
  if (!snap.exists) return

  const c = snap.data()
  const formattedDate = format(parseISO(slotDate), 'EEEE, MMMM d, yyyy')

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1d4ed8; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">Interview Confirmed</h1>
        <p style="margin: 6px 0 0; opacity: 0.9; font-size: 14px;">San Antonio Dodge</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 24px;">
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${c.firstName},</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          Your in-person interview for the <strong>${c.jobTitle}</strong> position has been confirmed. Here are the details:
        </p>
        <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <p style="color: #111827; font-size: 14px; margin: 0; line-height: 1.8;">
            <strong>Date:</strong> ${formattedDate}<br/>
            <strong>Time:</strong> ${slotTime}<br/>
            <strong>Location:</strong> San Antonio Dodge, 11910 N IH 35, San Antonio, TX 78233-4200<br/>
            <strong>Duration:</strong> ~45 minutes
          </p>
        </div>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;"><strong>Please remember to bring:</strong></p>
        <ul style="color: #374151; font-size: 14px; line-height: 1.8;">
          <li>A valid photo ID</li>
          <li>Any relevant certifications</li>
        </ul>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          Please arrive 10 minutes early. If you need to reschedule, please let us know as soon as possible.
        </p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          See you soon!<br/>
          <strong>The San Antonio Dodge Hiring Team</strong>
        </p>
      </div>
    </div>`

  await sendEmail({
    to: c.email,
    subject: 'Interview confirmed — San Antonio Dodge',
    html
  })
}
