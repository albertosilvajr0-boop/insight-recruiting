import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { sendEmail } from './sendEmail.js'
import { differenceInHours, format, subDays } from 'date-fns'
import { ADMIN_EMAIL, APP_URL, DEFAULT_CLIENT_NAME } from '../config/organization.js'

const STAGE_SLA_HOURS = { applied: 48, scored: 48, to_schedule: 72 }
const STAGE_MIGRATION = { screening: 'applied', scheduling: 'to_schedule', interview_2: 'applied' }

function stageOf(candidate) {
  return STAGE_MIGRATION[candidate.stage] || candidate.stage
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function scoreColor(score) {
  if (score == null) return '#6b7280'
  if (score >= 8) return '#16a34a'
  if (score >= 5) return '#d97706'
  return '#dc2626'
}

function scoreText(score) {
  return score == null ? '-/10' : `${Number(score).toFixed(1)}/10`
}

function renderSimpleRow(candidate, extra) {
  return `
    <tr style="border-bottom: 1px solid #e5e7eb;">
      <td style="padding: 10px 8px; font-weight: 600;">${escapeHtml(`${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || 'Candidate')}</td>
      <td style="padding: 10px 8px; font-size: 13px; color: #4b5563;">${escapeHtml(candidate.jobTitle || '-')}</td>
      <td style="padding: 10px 8px;"><span style="color: ${scoreColor(candidate.compositeScore)}; font-weight: 700;">${escapeHtml(scoreText(candidate.compositeScore))}</span></td>
      <td style="padding: 10px 8px; font-size: 13px; color: #6b7280;">${escapeHtml(extra || '')}</td>
    </tr>`
}

function section(title, subtitle, rows, headers) {
  if (!rows) return ''
  return `
    <div style="margin-top: 24px;">
      <h2 style="margin: 0 0 4px; font-size: 15px; color: #111827;">${escapeHtml(title)}</h2>
      ${subtitle ? `<p style="margin: 0 0 10px; font-size: 12px; color: #6b7280;">${escapeHtml(subtitle)}</p>` : ''}
      <div style="border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f9fafb;">
              ${headers.map(header => `<th style="padding: 8px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 500;">${escapeHtml(header)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`
}

export async function sendDailyDigest() {
  const db = getFirestore()
  const now = new Date()

  const since = Timestamp.fromDate(subDays(new Date(), 1))
  const recentSnap = await db.collection('candidates')
    .where('createdAt', '>=', since)
    .orderBy('createdAt', 'desc')
    .get()
  const recent = recentSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))

  const activeSnap = await db.collection('candidates')
    .where('stage', 'in', ['applied', 'scored', 'to_schedule', 'screening', 'scheduling'])
    .get()
  const active = activeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))

  const stuck = active
    .map(candidate => {
      const timestamp = candidate.updatedAt?.toDate?.() || candidate.createdAt?.toDate?.()
      const ageHours = timestamp ? differenceInHours(new Date(), timestamp) : 0
      const sla = STAGE_SLA_HOURS[stageOf(candidate)] || 0
      return { ...candidate, _ageHours: ageHours, _sla: sla }
    })
    .filter(candidate => candidate._sla > 0 && candidate._ageHours >= candidate._sla)
    .sort((a, b) => b._ageHours - a._ageHours)
    .slice(0, 10)

  const highPriority = active
    .filter(candidate => (candidate.compositeScore || 0) >= 8 && ['applied', 'scored', 'to_schedule'].includes(stageOf(candidate)))
    .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0))
    .slice(0, 10)

  const flagged = active.filter(candidate => candidate.needsReview).slice(0, 10)
  const intake = recent.length

  const prioritySection = section(
    'High-priority candidates',
    'AI composite >= 8/10 and still awaiting recruiter or employer follow-up',
    highPriority.map(candidate => renderSimpleRow(candidate, stageOf(candidate))).join(''),
    ['Name', 'Role', 'Score', 'Stage']
  )

  const stuckSection = stuck.length > 0 ? section(
    'Falling through the cracks',
    'In current stage longer than SLA. Open the admin portal to act.',
    stuck.map(candidate => renderSimpleRow(candidate, `${candidate._ageHours}h in ${stageOf(candidate)}`)).join(''),
    ['Name', 'Role', 'Score', 'Aging']
  ) : ''

  const flaggedSection = flagged.length > 0 ? section(
    'Flagged for second opinion',
    `${flagged.length} candidate${flagged.length !== 1 ? 's' : ''} marked as needing a second look`,
    flagged.map(candidate => renderSimpleRow(candidate, stageOf(candidate))).join(''),
    ['Name', 'Role', 'Score', 'Stage']
  ) : ''

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 720px; margin: 0 auto;">
      <div style="background: #1d4ed8; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">${escapeHtml(DEFAULT_CLIENT_NAME)} - Daily Digest</h1>
        <p style="margin: 6px 0 0; opacity: 0.85; font-size: 14px;">${escapeHtml(format(now, 'EEEE, MMMM d, yyyy'))}</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 20px;">
        <div style="display: flex; gap: 12px; margin-bottom: 20px;">
          <div style="flex: 1; background: #f9fafb; border-radius: 10px; padding: 14px;">
            <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600;">New apps (24h)</p>
            <p style="margin: 4px 0 0; font-size: 24px; font-weight: 700; color: #1d4ed8;">${intake}</p>
          </div>
          <div style="flex: 1; background: #f9fafb; border-radius: 10px; padding: 14px;">
            <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600;">High priority</p>
            <p style="margin: 4px 0 0; font-size: 24px; font-weight: 700; color: ${highPriority.length ? '#16a34a' : '#6b7280'};">${highPriority.length}</p>
            <p style="margin: 0; font-size: 12px; color: #6b7280;">employer-ready</p>
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

        ${prioritySection}
        ${stuckSection}
        ${flaggedSection}
      </div>
      <p style="margin: 20px 0 0; font-size: 12px; color: #9ca3af; text-align: center;">
        Powered by Insight Recruiting - <a href="${APP_URL}/admin/dashboard" style="color: #3b82f6;">Open admin portal</a>
      </p>
    </div>`

  const subjectBits = [
    `${intake} new app${intake !== 1 ? 's' : ''}`,
    highPriority.length ? `${highPriority.length} high-priority` : null,
    stuck.length ? `${stuck.length} at risk` : null,
  ].filter(Boolean).join(' - ')

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `${subjectBits || 'Daily digest'} - ${DEFAULT_CLIENT_NAME}`,
    html,
  })
}
