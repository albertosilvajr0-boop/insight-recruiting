import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { sendEmail } from './sendEmail.js'

const APP_URL = process.env.VITE_APP_URL || 'https://insight-recruiting-d37dc.web.app'

export async function sendScheduleLink(candidateId, schedulingToken) {
  const db = getFirestore()
  const snap = await db.collection('candidates').doc(candidateId).get()
  if (!snap.exists) return

  const c = snap.data()
  if (c.scheduleEmailSent) return // already sent

  const scheduleUrl = `${APP_URL}/schedule/${schedulingToken}`

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #16a34a; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">Great News!</h1>
        <p style="margin: 6px 0 0; opacity: 0.9; font-size: 14px;">San Antonio Dodge</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 24px;">
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${c.firstName},</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          Congratulations! We were impressed by your application for the <strong>${c.jobTitle}</strong> position
          and would like to invite you for an in-person interview at San Antonio Dodge.
        </p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          Please use the link below to select a time that works best for you:
        </p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="${scheduleUrl}" style="display: inline-block; background: #1d4ed8; color: white; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-weight: 600; font-size: 15px;">
            Schedule My Interview
          </a>
        </div>
        <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-top: 16px;">
          <p style="color: #6b7280; font-size: 13px; margin: 0;">
            <strong>Location:</strong> 18011 Blanco Rd, San Antonio, TX 78258<br/>
            <strong>Duration:</strong> ~45 minutes<br/>
            <strong>What to bring:</strong> Valid photo ID
          </p>
        </div>
        <p style="color: #374151; font-size: 15px; line-height: 1.6; margin-top: 16px;">
          We look forward to meeting you!
        </p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          Best,<br/>
          <strong>The San Antonio Dodge Hiring Team</strong>
        </p>
      </div>
    </div>`

  await sendEmail({
    to: c.email,
    subject: 'Great news! Next step — San Antonio Dodge',
    html
  })

  await db.collection('candidates').doc(candidateId).update({
    scheduleEmailSent: true,
    updatedAt: FieldValue.serverTimestamp()
  })
}
