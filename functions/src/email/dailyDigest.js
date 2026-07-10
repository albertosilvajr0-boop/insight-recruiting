import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { sendEmail } from './sendEmail.js'
import { format, startOfDay, endOfDay, subDays, differenceInHours } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { ADMIN_EMAIL, APP_URL, DEFAULT_CLIENT_NAME, DEFAULT_TIME_ZONE } from '../config/organization.js'

const TZ = DEFAULT_TIME_ZONE

// SLA — candidates sitting in these stages this long are "at risk"
// and surface at the top of the digest.
const STAGE_SLA_HOURS = { applied: 48, scored: 48, to_schedule: 72 }

function scoreColor(score) {
  if (score == null) return '#6b7280'
  if (score >= 8) return '#16a34a'
  if (score >= 5) return '#d97706'
  return '#dc2626'
}

function renderTodayRow(c) {
  const time = c.scheduledAt ? format(toZonedTime(c.scheduledAt.toDate(), TZ), 'h:mm a') : 'TBD'
  const strengthsList = (c.strengths || c.interviewStrengths || []).slice(0, 2).map(s => `<li>${s}</li>`).join('')
  return `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 12px 8px; font-weight: 600;">${c.firstName} ${c.lastName}</td>
      <td style="padding: 12px 8px;">${c.jobTitle}</td>
      <td style="padding: 12px 8px;">${time}</td>
      <td style="padding: 12px 8px;">
        <span style="color: ${scoreColor(c.compositeScore)}; font-weight: 700;">${c.compositeScore?.toFixed(1) ?? '—'}/10</span>
      </td>
      <td style="padding: 12px 8px; font-size: 13px; color: #4b5563;"><ul style="margin:0;padding-left:16px;">${strengthsList}</ul></td>
    </tr>`
}

function renderSimpleRow(c, extra) {
  return `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 10px 8px; font-weight: 600;">${c.firstName} ${c.lastName}</td>
      <td style="padding: 10px 8px; font-size: 13px; color: #4b5563;">${c.jobTitle || '—'}</td>
      <td style="padding: 10px 8px;"><span style="color: ${scoreColor(c.compositeScore)}; font-weight: 700;">${c.compositeScore?.toFixed(1) ?? '—'}/10</span></td>
      <td style="padding: 10px 8px; font-size: 13px; color: #6b7280;">${extra || ''}</td>
    </tr>`
}

function section(title, subtitle, rows, headers) {
  if (!rows) return ''
  return `
    <div style="margin-top: 24px;">
      <h2 style="margin: 0 0 4px; font-size: 15px; color: #111827;">${title}</h2>
      ${subtitle ? `<p style="margin: 0 0 10px; font-size: 12px; color: #6b7280;">${subtitle}</p>` : ''}
      <div style="border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f9fafb;">
              ${headers.map(h => `<th style="padding: 8px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 500;">${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`
}

export async function sendDailyDigest() {
  const db = getFirestore()
  const now = toZonedTime(new Date(), TZ)
  const todayStart = Timestamp.fromDate(startOfDay(now))
  const todayEnd = Timestamp.fromDate(endOfDay(now))

  // Interviews scheduled for today
  const todaySnap = await db.collection('candidates')
    .where('stage', '==', 'scheduled')
    .where('scheduledAt', '>=', todayStart)
    .where('scheduledAt', '<=', todayEnd)
    .orderBy('scheduledAt', 'asc')
    .get()
  const today = todaySnap.docs.map(d => ({ id: d.id, ...d.data() }))

  // Last 24h intake
  const since = Timestamp.fromDate(subDays(new Date(), 1))
  const recentSnap = await db.collection('candidates')
    .where('createdAt', '>=', since)
    .orderBy('createdAt', 'desc')
    .get()
  const recent = recentSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  // All active (not rejected / hired) for aging + high-priority callouts
  const activeSnap = await db.collection('candidates')
    .where('stage', 'in', ['applied', 'scored', 'to_schedule', 'screening', 'scheduling'])
    .get()
  const active = activeSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  // Normalize stage migration inline (mirrors admin UI)
  const STAGE_MIGRATION = { screening: 'applied', scheduling: 'to_schedule', interview_2: 'applied' }
  const stageOf = c => STAGE_MIGRATION[c.stage] || c.stage

  // Falling through cracks — in-stage longer than SLA
  const stuck = active
    .map(c => {
      const t = c.updatedAt?.toDate?.() || c.createdAt?.toDate?.()
      const ageHours = t ? differenceInHours(new Date(), t) : 0
      const sla = STAGE_SLA_HOURS[stageOf(c)] || 0
      return { ...c, _ageHours: ageHours, _sla: sla }
    })
    .filter(c => c._sla > 0 && c._ageHours >= c._sla)
    .sort((a, b) => b._ageHours - a._ageHours)
    .slice(0, 10)

  // High-priority: AI composite >= 8, still pending scheduling/review
  const highPriority = active
    .filter(c => (c.compositeScore || 0) >= 8 && ['applied', 'scored', 'to_schedule'].includes(stageOf(c)))
    .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0))
    .slice(0, 10)

  // Flagged
  const flagged = active.filter(c => c.needsReview).slice(0, 10)

  // Headline numbers
  const intake = recent.length
  const todayCount = today.length

  // Today block
  const todaySection = today.length > 0 ? `
    <div style="margin-top: 8px;">
      <h2 style="margin: 0 0 4px; font-size: 15px; color: #111827;">Today's interviews (${todayCount})</h2>
      <div style="border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f9fafb;">
              <th style="padding: 8px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 500;">Name</th>
              <th style="padding: 8px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 500;">Role</th>
              <th style="padding: 8px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 500;">Time</th>
              <th style="padding: 8px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 500;">Score</th>
              <th style="padding: 8px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 500;">Strengths</th>
            </tr>
          </thead>
          <tbody>${today.map(renderTodayRow).join('')}</tbody>
        </table>
      </div>
    </div>` : `<p style="margin: 8px 0 0; font-size: 14px; color: #6b7280;">No in-person interviews scheduled today.</p>`

  const prioritySection = section(
    '🔥 High-priority candidates',
    'AI composite ≥ 8/10 and still awaiting next step',
    highPriority.map(c => renderSimpleRow(c, STAGE_MIGRATION[c.stage] || c.stage)).join(''),
    ['Name', 'Role', 'Score', 'Stage']
  )

  const stuckSection = stuck.length > 0 ? section(
    '⚠ Falling through the cracks',
    'In current stage longer than SLA — tap the admin portal to act',
    stuck.map(c => renderSimpleRow(c, `${c._ageHours}h in ${STAGE_MIGRATION[c.stage] || c.stage}`)).join(''),
    ['Name', 'Role', 'Score', 'Aging']
  ) : ''

  const flaggedSection = flagged.length > 0 ? section(
    '⚑ Flagged for second opinion',
    `${flagged.length} candidate${flagged.length !== 1 ? 's' : ''} marked as needing a second look`,
    flagged.map(c => renderSimpleRow(c, STAGE_MIGRATION[c.stage] || c.stage)).join(''),
    ['Name', 'Role', 'Score', 'Stage']
  ) : ''

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto;">
      <div style="background: #1d4ed8; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">${DEFAULT_CLIENT_NAME} - Daily Digest</h1>
        <p style="margin: 6px 0 0; opacity: 0.85; font-size: 14px;">${format(now, 'EEEE, MMMM d, yyyy')}</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 20px;">

        <div style="display: flex; gap: 12px; margin-bottom: 20px;">
          <div style="flex: 1; background: #f9fafb; border-radius: 10px; padding: 14px;">
            <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600;">Today</p>
            <p style="margin: 4px 0 0; font-size: 24px; font-weight: 700; color: #16a34a;">${todayCount}</p>
            <p style="margin: 0; font-size: 12px; color: #6b7280;">interview${todayCount !== 1 ? 's' : ''}</p>
          </div>
          <div style="flex: 1; background: #f9fafb; border-radius: 10px; padding: 14px;">
            <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600;">New apps (24h)</p>
            <p style="margin: 4px 0 0; font-size: 24px; font-weight: 700; color: #1d4ed8;">${intake}</p>
          </div>
          <div style="flex: 1; background: #f9fafb; border-radius: 10px; padding: 14px;">
            <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600;">At risk</p>
            <p style="margin: 4px 0 0; font-size: 24px; font-weight: 700; color: ${stuck.length ? '#dc2626' : '#6b7280'};">${stuck.length}</p>
            <p style="margin: 0; font-size: 12px; color: #6b7280;">stuck beyond SLA</p>
          </div>
          <div style="flex: 1; background: #f9fafb; border-radius: 10px; padding: 14px;">
            <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600;">Flagged</p>
            <p style="margin: 4px 0 0; font-size: 24px; font-weight: 700; color: ${flagged.length ? '#d97706' : '#6b7280'};">${flagged.length}</p>
          </div>
        </div>

        ${todaySection}
        ${prioritySection}
        ${stuckSection}
        ${flaggedSection}

      </div>
      <p style="margin: 20px 0 0; font-size: 12px; color: #9ca3af; text-align: center;">
        Powered by Insight Recruiting - <a href="${APP_URL}/admin/dashboard" style="color: #3b82f6;">Open admin portal</a>
      </p>
    </div>`

  const subjectBits = [
    `${todayCount} interview${todayCount !== 1 ? 's' : ''} today`,
    highPriority.length ? `${highPriority.length} high-priority` : null,
    stuck.length ? `${stuck.length} at risk` : null,
  ].filter(Boolean).join(' · ')

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `${subjectBits || 'Daily digest'} - ${DEFAULT_CLIENT_NAME}`,
    html
  })
}
