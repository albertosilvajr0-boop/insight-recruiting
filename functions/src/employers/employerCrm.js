import { randomBytes } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

const REVIEW_ACTIONS = new Set([
  'interested',
  'not_a_fit',
  'send_more_like_this',
  'schedule_interview',
  'view_video',
])

function truncate(text, max = 900) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned
}

function safeDocId(value, fallback = 'unknown') {
  const id = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
  return id || fallback
}

function candidateName(candidate) {
  return `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || 'Candidate'
}

function uniqueList(...groups) {
  return [...new Set(groups.flat().filter(Boolean).map(item => String(item).trim()).filter(Boolean))]
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function domainFromEmail(email) {
  const domain = normalizeEmail(email).split('@')[1] || ''
  return domain.replace(/^www\./, '')
}

function titleFromDomain(domain) {
  const core = String(domain || '').split('.')[0] || 'Employer'
  return core
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Employer'
}

export function createReviewToken() {
  return randomBytes(24).toString('base64url')
}

export function employerContactId(email) {
  return safeDocId(normalizeEmail(email), 'contact')
}

export function employerIdFor(email, employerName = '') {
  const domain = domainFromEmail(email)
  if (domain) return safeDocId(domain, 'employer')
  return safeDocId(employerName, 'employer')
}

export function employerNameFor(email, employerName = '') {
  const explicit = truncate(employerName, 160)
  return explicit || titleFromDomain(domainFromEmail(email))
}

function scoreValue(candidate) {
  const value = candidate.manualScore?.avg
  const score = Number(value)
  return Number.isFinite(score) ? score : null
}

function answerScoreValue(candidate, qIndex) {
  const value = candidate.manualAnswerScores?.[qIndex]
  const score = Number(value)
  return Number.isFinite(score) ? score : null
}

function questionEvidence(candidate, videos) {
  const questions = candidate.questions || {}
  const qKeys = new Set([
    ...Object.keys(questions),
    ...Object.keys(candidate.manualAnswerScores || {}),
    ...Object.keys(candidate.manualAnswerNotes || {}),
    ...Object.keys(candidate.textResponses || {}),
    ...Object.keys(candidate.videoTranscripts || {}),
    ...videos.map(video => String(video.qIndex)),
  ])
  const videosByIndex = new Map(videos.map(video => [String(video.qIndex), video]))

  return [...qKeys]
    .sort((a, b) => Number(a) - Number(b))
    .slice(0, 24)
    .map((qIndex) => {
      const num = Number(qIndex) + 1
      const video = videosByIndex.get(String(qIndex))
      return {
        qIndex,
        num,
        question: truncate(questions[qIndex]?.text || video?.label || `Interview answer ${num}`, 240),
        score: answerScoreValue(candidate, qIndex),
        scoreNote: truncate(candidate.manualAnswerNotes?.[qIndex], 900),
        written: truncate(candidate.textResponses?.[qIndex], 900),
        transcript: truncate(candidate.videoTranscripts?.[qIndex]?.transcript, 900),
        videoTarget: video?.target || null,
        hasVideo: Boolean(video),
      }
    })
}

export function candidateReviewSnapshot(candidate, videos = []) {
  return {
    candidateId: candidate.id || candidate.candidateId || null,
    name: candidateName(candidate),
    firstName: candidate.firstName || '',
    lastName: candidate.lastName || '',
    jobTitle: candidate.jobTitle || 'Open role',
    clientName: candidate.clientName || candidate.dealership || candidate.organizationName || null,
    email: candidate.email || null,
    phone: candidate.phone || null,
    aiScore: scoreValue(candidate),
    scoredResponses: candidate.manualScore?.count || Object.keys(candidate.manualAnswerScores || {}).length || 0,
    strengths: uniqueList(candidate.strengths, candidate.resumeStrengths, candidate.interviewStrengths).slice(0, 5),
    concerns: uniqueList(candidate.concerns, candidate.resumeConcerns, candidate.interviewConcerns).slice(0, 5),
    resumeAnalysis: truncate(candidate.resumeAnalysis, 900),
    interviewAnalysis: truncate(candidate.interviewAnalysis, 900),
    evidence: questionEvidence(candidate, videos),
    videoCount: videos.length,
  }
}

export async function writeEmployerCampaign({
  db,
  shareRef,
  shareId,
  recipients,
  employerName,
  candidates,
  videosByCandidate,
  note,
  sharedBy,
  emailVersion,
  subject,
  reviewToken,
  reviewUrl,
}) {
  const candidateIds = candidates.map(candidate => candidate.id).filter(Boolean)
  const contactEmails = recipients.map(normalizeEmail)
  const employerIds = [...new Set(contactEmails.map(email => employerIdFor(email, employerName)))]
  const employerNames = [...new Set(contactEmails.map(email => employerNameFor(email, employerName)))]
  const candidateSummaries = candidates.map(candidate => (
    candidateReviewSnapshot(candidate, videosByCandidate.get(candidate.id) || [])
  ))
  const campaignRef = db.collection('campaigns').doc(shareId)
  const batch = db.batch()

  contactEmails.forEach((email) => {
    const domain = domainFromEmail(email)
    const name = employerNameFor(email, employerName)
    const employerId = employerIdFor(email, employerName)
    const employerRef = db.collection('employers').doc(employerId)
    const contactRef = db.collection('employerContacts').doc(employerContactId(email))
    const employerData = {
      name,
      domain: domain || null,
      contactEmails: FieldValue.arrayUnion(email),
      candidateIds: FieldValue.arrayUnion(...candidateIds),
      campaignIds: FieldValue.arrayUnion(shareId),
      shareCount: FieldValue.increment(1),
      lastSharedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (domain) employerData.domains = FieldValue.arrayUnion(domain)

    batch.set(employerRef, employerData, { merge: true })

    batch.set(contactRef, {
      email,
      domain: domain || null,
      employerId,
      employerName: name,
      candidateIds: FieldValue.arrayUnion(...candidateIds),
      campaignIds: FieldValue.arrayUnion(shareId),
      shareIds: FieldValue.arrayUnion(shareId),
      status: 'sent',
      lastSharedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })

  batch.set(campaignRef, {
    shareId,
    reviewToken,
    reviewUrl,
    employerIds,
    employerNames,
    contactEmails,
    candidateIds,
    candidateSummaries,
    note: note || null,
    by: sharedBy,
    emailVersion: emailVersion || 'v1',
    subject,
    status: 'sent',
    actionCounts: {},
    sentCount: contactEmails.length,
    videoCount: candidateSummaries.reduce((sum, candidate) => sum + candidate.videoCount, 0),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastSharedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  batch.set(shareRef, {
    campaignId: shareId,
    employerIds,
    employerNames,
    reviewToken,
    reviewUrl,
  }, { merge: true })

  await batch.commit()
  return { campaignId: shareId, employerIds, employerNames, reviewUrl }
}

export async function recordEmployerClick(db, { shareId, recipient, target, link, isVideo }) {
  const email = normalizeEmail(recipient)
  const campaignUpdate = {
    clickCount: FieldValue.increment(1),
    videoClickCount: isVideo ? FieldValue.increment(1) : FieldValue.increment(0),
    lastClickAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (isVideo) campaignUpdate.lastVideoClickAt = FieldValue.serverTimestamp()
  const updates = [
    db.collection('campaigns').doc(shareId).set(campaignUpdate, { merge: true }),
  ]

  if (email) {
    const contactUpdate = {
      email,
      clickCount: FieldValue.increment(1),
      videoClickCount: isVideo ? FieldValue.increment(1) : FieldValue.increment(0),
      lastClickedAt: FieldValue.serverTimestamp(),
      lastClickedTarget: target || null,
      lastClickedLabel: link?.label || null,
      status: isVideo ? 'engaged_video' : 'clicked',
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (isVideo) contactUpdate.lastVideoClickedAt = FieldValue.serverTimestamp()
    updates.push(db.collection('employerContacts').doc(employerContactId(email)).set(contactUpdate, { merge: true }))
  }

  await Promise.all(updates)
}

export async function getEmployerReviewHandler(data) {
  const campaignId = String(data?.campaignId || data?.shareId || '').trim()
  const token = String(data?.token || '').trim()
  if (!campaignId || !token) throw new HttpsError('invalid-argument', 'Missing review link.')

  const db = getFirestore()
  const campaignRef = db.collection('campaigns').doc(campaignId)
  const snap = await campaignRef.get()
  if (!snap.exists || snap.data().reviewToken !== token) {
    throw new HttpsError('permission-denied', 'This review link is invalid or expired.')
  }
  await campaignRef.set({
    viewCount: FieldValue.increment(1),
    lastViewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  const campaign = snap.data()
  const shareSnap = await db.collection('shares').doc(campaignId).get()
  const links = shareSnap.exists ? shareSnap.data().links || {} : {}
  return {
    campaignId,
    employerNames: campaign.employerNames || [],
    candidates: campaign.candidateSummaries || [],
    note: campaign.note || '',
    by: campaign.by || '',
    createdAt: serializeTimestamp(campaign.createdAt),
    links,
  }
}

export async function recordEmployerReviewActionHandler(data) {
  const campaignId = String(data?.campaignId || data?.shareId || '').trim()
  const token = String(data?.token || '').trim()
  const candidateId = String(data?.candidateId || '').trim()
  const action = String(data?.action || '').trim()
  const note = truncate(data?.note, 600)
  const contactEmail = normalizeEmail(data?.contactEmail)

  if (!campaignId || !token) throw new HttpsError('invalid-argument', 'Missing review link.')
  if (!REVIEW_ACTIONS.has(action)) throw new HttpsError('invalid-argument', 'Unsupported employer action.')

  const db = getFirestore()
  const campaignRef = db.collection('campaigns').doc(campaignId)
  const snap = await campaignRef.get()
  if (!snap.exists || snap.data().reviewToken !== token) {
    throw new HttpsError('permission-denied', 'This review link is invalid or expired.')
  }

  const entry = {
    action,
    candidateId: candidateId || null,
    contactEmail: contactEmail || null,
    note: note || null,
    at: new Date().toISOString(),
  }

  const updates = [
    campaignRef.set({
      actions: FieldValue.arrayUnion(entry),
      actionCounts: { [action]: FieldValue.increment(1) },
      status: ['interested', 'schedule_interview'].includes(action) ? 'interested' : snap.data().status || 'sent',
      lastActionAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
    db.collection('shares').doc(campaignId).set({
      employerActions: FieldValue.arrayUnion(entry),
      lastEmployerActionAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]

  if (contactEmail) {
    updates.push(db.collection('employerContacts').doc(employerContactId(contactEmail)).set({
      email: contactEmail,
      status: ['interested', 'schedule_interview'].includes(action) ? 'interested' : action,
      lastAction: action,
      lastActionAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }))
  }

  if (candidateId) {
    updates.push(db.collection('candidates').doc(candidateId).set({
      employerSignals: FieldValue.arrayUnion({ ...entry, campaignId }),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }))
  }

  await Promise.all(updates)
  return { success: true, action }
}

function serializeTimestamp(value) {
  if (!value) return null
  if (value.toDate) return value.toDate().toISOString()
  if (value.seconds) return new Date(value.seconds * 1000).toISOString()
  return null
}
