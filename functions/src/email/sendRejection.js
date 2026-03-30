import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { sendEmail } from './sendEmail.js'

export async function sendRejectionEmail(candidateId) {
  const db = getFirestore()
  const snap = await db.collection('candidates').doc(candidateId).get()
  if (!snap.exists) return

  const c = snap.data()
  if (c.rejectionEmailSent) return // already sent

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1d4ed8; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">San Antonio Dodge</h1>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 24px;">
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Dear ${c.firstName},</p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          Thank you for taking the time to apply for the <strong>${c.jobTitle}</strong> position at San Antonio Dodge.
          We appreciate your interest in joining our team.
        </p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          After careful consideration, we've decided to move forward with other candidates whose qualifications
          more closely align with our current needs.
        </p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          We encourage you to keep an eye on our job postings and reapply in the future if you see a role
          that matches your skills and experience.
        </p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          We wish you the very best in your job search.
        </p>
        <p style="color: #374151; font-size: 15px; line-height: 1.6; margin-top: 24px;">
          Warm regards,<br/>
          <strong>The San Antonio Dodge Hiring Team</strong>
        </p>
      </div>
    </div>`

  await sendEmail({
    to: c.email,
    subject: 'Thank you for your interest — San Antonio Dodge',
    html
  })

  await db.collection('candidates').doc(candidateId).update({
    rejectionEmailSent: true,
    updatedAt: FieldValue.serverTimestamp()
  })
}
