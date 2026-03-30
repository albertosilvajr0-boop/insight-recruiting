import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { sendEmail } from './sendEmail.js'
import { format, startOfDay, endOfDay } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const ADMIN_EMAIL = 'albertosilva@silvaconsultinggroup.com'
const TZ = 'America/Denver'

export async function sendDailyDigest() {
  const db = getFirestore()
  const now = toZonedTime(new Date(), TZ)
  const todayStart = Timestamp.fromDate(startOfDay(now))
  const todayEnd = Timestamp.fromDate(endOfDay(now))

  const snap = await db.collection('candidates')
    .where('stage', '==', 'scheduled')
    .where('scheduledAt', '>=', todayStart)
    .where('scheduledAt', '<=', todayEnd)
    .orderBy('scheduledAt', 'asc')
    .get()

  const candidates = snap.docs.map(d => ({ id: d.id, ...d.data() }))

  if (candidates.length === 0) {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `Daily digest — no interviews today`,
      html: `<p>No in-person interviews scheduled for today at San Antonio Dodge.</p>`
    })
    return
  }

  const rows = candidates.map(c => {
    const time = c.scheduledAt
      ? format(toZonedTime(c.scheduledAt.toDate(), TZ), 'h:mm a')
      : 'TBD'
    const scoreColor = c.compositeScore >= 8 ? '#16a34a' : c.compositeScore >= 6 ? '#d97706' : '#dc2626'
    const strengthsList = (c.strengths || []).slice(0, 2).map(s => `<li>${s}</li>`).join('')

    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px 8px; font-weight: 600;">${c.firstName} ${c.lastName}</td>
        <td style="padding: 12px 8px;">${c.jobTitle}</td>
        <td style="padding: 12px 8px;">${time}</td>
        <td style="padding: 12px 8px;">
          <span style="color: ${scoreColor}; font-weight: 700;">${c.compositeScore?.toFixed(1) ?? '—'}/10</span>
        </td>
        <td style="padding: 12px 8px; font-size: 13px; color: #4b5563;"><ul style="margin:0;padding-left:16px;">${strengthsList}</ul></td>
      </tr>`
  }).join('')

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 700px; margin: 0 auto;">
      <div style="background: #1d4ed8; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">San Antonio Dodge — Today's Interviews</h1>
        <p style="margin: 6px 0 0; opacity: 0.85; font-size: 14px;">${format(now, 'EEEE, MMMM d, yyyy')} · ${candidates.length} candidate${candidates.length !== 1 ? 's' : ''} scheduled</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
              <th style="padding: 10px 8px; text-align: left; color: #6b7280; font-weight: 500;">Name</th>
              <th style="padding: 10px 8px; text-align: left; color: #6b7280; font-weight: 500;">Role</th>
              <th style="padding: 10px 8px; text-align: left; color: #6b7280; font-weight: 500;">Time</th>
              <th style="padding: 10px 8px; text-align: left; color: #6b7280; font-weight: 500;">Score</th>
              <th style="padding: 10px 8px; text-align: left; color: #6b7280; font-weight: 500;">Strengths</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p style="margin: 20px 0 0; font-size: 12px; color: #9ca3af; text-align: center;">
        Powered by Silva Consulting Group · <a href="https://your-domain.web.app/admin/dashboard" style="color: #3b82f6;">Open admin portal</a>
      </p>
    </div>`

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `${candidates.length} interview${candidates.length !== 1 ? 's' : ''} today — San Antonio Dodge`,
    html
  })
}
