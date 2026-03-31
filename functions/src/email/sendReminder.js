import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { sendEmail } from './sendEmail.js'
import { format, addHours, subHours } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const TZ = 'America/Chicago'

export async function sendReminders() {
  const db = getFirestore()
  const now = new Date()

  // Find candidates scheduled in the next 24-25 hours (for 24h reminder)
  const in24h = addHours(now, 24)
  const in25h = addHours(now, 25)

  const snap24 = await db.collection('candidates')
    .where('stage', '==', 'scheduled')
    .where('scheduledAt', '>=', Timestamp.fromDate(in24h))
    .where('scheduledAt', '<=', Timestamp.fromDate(in25h))
    .get()

  for (const doc of snap24.docs) {
    const c = doc.data()
    const scheduledTime = toZonedTime(c.scheduledAt.toDate(), TZ)
    const formattedDate = format(scheduledTime, 'EEEE, MMMM d')
    const formattedTime = format(scheduledTime, 'h:mm a')

    await sendEmail({
      to: c.email,
      subject: `Reminder: Your interview tomorrow — San Antonio Dodge`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <p style="color: #374151; font-size: 15px;">Hi ${c.firstName},</p>
          <p style="color: #374151; font-size: 15px; line-height: 1.6;">
            This is a friendly reminder about your interview tomorrow for the <strong>${c.jobTitle}</strong> position.
          </p>
          <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="color: #111827; font-size: 14px; margin: 0;">
              <strong>${formattedDate} at ${formattedTime}</strong><br/>
              San Antonio Dodge, 18011 Blanco Rd, San Antonio, TX 78258
            </p>
          </div>
          <p style="color: #374151; font-size: 15px;">Please bring a valid photo ID and arrive 10 minutes early.</p>
          <p style="color: #374151; font-size: 15px;">See you soon!<br/><strong>San Antonio Dodge</strong></p>
        </div>`
    })
  }

  // Find candidates scheduled in the next 1-2 hours (for 1h reminder)
  const in1h = addHours(now, 1)
  const in2h = addHours(now, 2)

  const snap1 = await db.collection('candidates')
    .where('stage', '==', 'scheduled')
    .where('scheduledAt', '>=', Timestamp.fromDate(in1h))
    .where('scheduledAt', '<=', Timestamp.fromDate(in2h))
    .get()

  for (const doc of snap1.docs) {
    const c = doc.data()
    await sendEmail({
      to: c.email,
      subject: `See you soon! — San Antonio Dodge`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <p style="color: #374151; font-size: 15px;">Hi ${c.firstName},</p>
          <p style="color: #374151; font-size: 15px; line-height: 1.6;">
            Just a quick reminder — your interview is coming up in about an hour!
          </p>
          <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="color: #111827; font-size: 14px; margin: 0;">
              San Antonio Dodge<br/>18011 Blanco Rd, San Antonio, TX 78258
            </p>
          </div>
          <p style="color: #374151; font-size: 15px;">We look forward to meeting you!<br/><strong>San Antonio Dodge</strong></p>
        </div>`
    })
  }

  console.log(`[reminders] Sent ${snap24.size} 24h reminders, ${snap1.size} 1h reminders`)
}
