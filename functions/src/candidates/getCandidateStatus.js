import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

const PUBLIC_STAGES = new Set(['applied', 'screening', 'scored', 'to_schedule', 'scheduled', 'rejected', 'hired'])
const GENERIC_EMAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
])
const GENERIC_COMPANY_NAMES = new Set(['employer', 'unknown', 'link', 'other link'])

function serializeTimestamp(value) {
  return value?.toDate ? value.toDate().toISOString() : null
}

function cleanCompanyName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function isUsefulCompanyName(value) {
  const name = cleanCompanyName(value)
  return Boolean(name && !GENERIC_COMPANY_NAMES.has(name.toLowerCase()))
}

function domainFromEmail(value) {
  const domain = String(value || '').trim().toLowerCase().split('@')[1] || ''
  return domain.replace(/^www\./, '')
}

function titleFromDomain(domain) {
  const root = String(domain || '').split('.')[0]
  if (!root || GENERIC_EMAIL_DOMAINS.has(domain)) return ''
  return root
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function companyNamesFromShare(share) {
  const names = []
  if (Array.isArray(share.employerNames)) names.push(...share.employerNames)
  names.push(share.employerName, share.company)

  const cleaned = names
    .map(cleanCompanyName)
    .filter(isUsefulCompanyName)

  if (cleaned.length) return cleaned

  const recipients = Array.isArray(share.recipients) ? share.recipients : []
  return recipients
    .map(recipient => titleFromDomain(domainFromEmail(recipient)))
    .map(cleanCompanyName)
    .filter(isUsefulCompanyName)
}

async function getCandidateSharedEmployers(db, candidateId) {
  const [singleSnap, bulkSnap] = await Promise.all([
    db.collection('shares').where('candidateId', '==', candidateId).limit(50).get(),
    db.collection('shares').where('candidateIds', 'array-contains', candidateId).limit(50).get(),
  ])
  const byName = new Map()

  for (const doc of [...singleSnap.docs, ...bulkSnap.docs]) {
    const share = doc.data()
    const sharedAt = serializeTimestamp(share.createdAt)
    for (const name of companyNamesFromShare(share)) {
      const key = name.toLowerCase()
      const existing = byName.get(key)
      if (!existing || (sharedAt && (!existing.sharedAt || sharedAt > existing.sharedAt))) {
        byName.set(key, { name, sharedAt })
      }
    }
  }

  return Array.from(byName.values())
    .sort((a, b) => (b.sharedAt || '').localeCompare(a.sharedAt || '') || a.name.localeCompare(b.name))
    .slice(0, 20)
}

export async function getCandidateStatusHandler(data) {
  const token = String(data?.token || '').trim()
  if (!token || token.length > 100) {
    throw new HttpsError('invalid-argument', 'A valid status token is required.')
  }

  const db = getFirestore()
  const snap = await db.collection('candidates')
    .where('statusToken', '==', token)
    .limit(1)
    .get()

  if (snap.empty) {
    throw new HttpsError('not-found', 'This status link is invalid or has expired.')
  }

  const candidateDoc = snap.docs[0]
  const candidate = candidateDoc.data()
  const stage = PUBLIC_STAGES.has(candidate.stage) ? candidate.stage : 'applied'
  const sharedEmployers = await getCandidateSharedEmployers(db, candidateDoc.id)

  return {
    jobTitle: candidate.jobTitle || '',
    stage,
    createdAt: serializeTimestamp(candidate.createdAt),
    updatedAt: serializeTimestamp(candidate.updatedAt),
    scheduledAt: serializeTimestamp(candidate.scheduledAt),
    sharedEmployers,
  }
}
