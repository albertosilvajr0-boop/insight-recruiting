import { randomBytes } from 'node:crypto'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { assertPermission } from '../security/assertAccess.js'
import { PERMISSIONS } from '../security/roles.js'
import { writeAuditLog } from '../utils/auditLog.js'

const REVIEW_ACTIONS = new Set([
  'interested',
  'not_a_fit',
  'send_more_like_this',
  'schedule_interview',
  'view_video',
])

const CRM_STAGES = new Set([
  'prospect',
  'contacted',
  'clicked',
  'watched_video',
  'interested',
  'interview_requested',
  'active_client',
  'nurture',
  'do_not_contact',
])

const CRM_PRIORITIES = new Set(['high', 'medium', 'low'])

const CRM_OUTCOMES = new Set([
  'manual_note',
  'follow_up_sent',
  'left_voicemail',
  'reply_interested',
  'wants_more_candidates',
  'interview_requested',
  'not_a_fit',
  'not_hiring',
  'wrong_contact',
  'sent_to_hr',
  'nurture_later',
  'do_not_contact',
])

const CONTACT_CHANNELS = new Set(['email', 'linkedin', 'sms', 'phone', 'whatsapp', 'other'])

const CAMPAIGN_SEQUENCE_STEPS = new Set([
  'initial_shortlist',
  'day_2_check_in',
  'day_5_value_proof',
  'day_10_refresh',
])

const OUTCOME_STAGE = {
  follow_up_sent: 'contacted',
  left_voicemail: 'contacted',
  reply_interested: 'interested',
  wants_more_candidates: 'interested',
  interview_requested: 'interview_requested',
  not_a_fit: 'nurture',
  not_hiring: 'nurture',
  wrong_contact: 'contacted',
  sent_to_hr: 'contacted',
  nurture_later: 'nurture',
  do_not_contact: 'do_not_contact',
}

function truncate(text, max = 900) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned
}

function nullableText(text, max = 900) {
  const cleaned = truncate(text, max)
  return cleaned || null
}

function stringList(value, maxItems = 12, maxLength = 40) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,;\n]+/)
  return [...new Set(raw
    .map(item => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(item => item.slice(0, maxLength))
  )].slice(0, maxItems)
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

function requireDocId(value, label = 'document id') {
  const id = String(value || '').trim()
  if (!id || id.includes('/') || id.length > 160) {
    throw new HttpsError('invalid-argument', `Invalid ${label}.`)
  }
  return id
}

function enumValue(value, allowed, fallback = null) {
  const normalized = String(value || '').trim()
  return allowed.has(normalized) ? normalized : fallback
}

function optionalDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new HttpsError('invalid-argument', 'Invalid date.')
  }
  return date
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
  contactDetailsByRecipient = {},
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
    const contactDetails = contactDetailsByRecipient[email] || contactDetailsByRecipient[String(email).toLowerCase()] || {}
    const contactName = nullableText(contactDetails.contactName, 120)
    const contactTitle = nullableText(contactDetails.title || contactDetails.contactTitle, 120)
    const contactPhone = nullableText(contactDetails.phone, 40)
    const contactLinkedIn = nullableText(contactDetails.linkedinUrl || contactDetails.linkedInUrl, 240)
    const preferredChannel = enumValue(contactDetails.preferredChannel || contactDetails.channel, CONTACT_CHANNELS)
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
    if (contactName) employerData.contactNames = FieldValue.arrayUnion(contactName)

    batch.set(employerRef, employerData, { merge: true })

    const contactData = {
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
    }
    if (contactName) contactData.name = contactName
    if (contactTitle) contactData.title = contactTitle
    if (contactPhone) contactData.phone = contactPhone
    if (contactLinkedIn) contactData.linkedinUrl = contactLinkedIn
    if (preferredChannel) contactData.preferredChannel = preferredChannel

    batch.set(contactRef, contactData, { merge: true })
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

export async function updateEmployerCrmHandler(data, request) {
  const profile = await assertPermission(request, PERMISSIONS.VIEW_CANDIDATES)
  const employerId = requireDocId(data?.employerId, 'employer id')
  const crmStage = enumValue(data?.crmStage, CRM_STAGES)
  const crmPriority = enumValue(data?.crmPriority, CRM_PRIORITIES)

  if (!crmStage) throw new HttpsError('invalid-argument', 'Unsupported employer stage.')
  if (!crmPriority) throw new HttpsError('invalid-argument', 'Unsupported employer priority.')

  const db = getFirestore()
  const employerRef = db.collection('employers').doc(employerId)
  const employerSnap = await employerRef.get()
  if (!employerSnap.exists) throw new HttpsError('not-found', 'Employer not found.')

  const nextActionDue = optionalDate(data?.nextActionDue)
  const updates = {
    crmStage,
    crmPriority,
    crmOwnerName: nullableText(data?.crmOwnerName, 120),
    crmNotes: nullableText(data?.crmNotes, 1800),
    nextAction: nullableText(data?.nextAction, 240),
    nextActionDue,
    crmUpdatedAt: FieldValue.serverTimestamp(),
    crmUpdatedBy: request.auth?.token?.email || profile.email || request.auth?.uid || 'admin',
    updatedAt: FieldValue.serverTimestamp(),
  }

  await employerRef.set(updates, { merge: true })
  await writeAuditLog({
    actorUid: request.auth?.uid || 'admin',
    actorEmail: request.auth?.token?.email || profile.email || null,
    action: 'employer.crm_update',
    targetType: 'employer',
    targetId: employerId,
    metadata: {
      crmStage,
      crmPriority,
      hasNextAction: Boolean(updates.nextAction),
      hasNotes: Boolean(updates.crmNotes),
    },
  })

  return { success: true, employerId }
}

export async function logEmployerOutcomeHandler(data, request) {
  const profile = await assertPermission(request, PERMISSIONS.VIEW_CANDIDATES)
  const employerId = requireDocId(data?.employerId, 'employer id')
  const outcome = enumValue(data?.outcome, CRM_OUTCOMES)
  if (!outcome) throw new HttpsError('invalid-argument', 'Unsupported employer outcome.')

  const db = getFirestore()
  const employerRef = db.collection('employers').doc(employerId)
  const employerSnap = await employerRef.get()
  if (!employerSnap.exists) throw new HttpsError('not-found', 'Employer not found.')

  const contactEmail = normalizeEmail(data?.contactEmail)
  const contactId = data?.contactId ? requireDocId(data.contactId, 'contact id') : (contactEmail ? employerContactId(contactEmail) : null)
  const campaignId = data?.campaignId ? requireDocId(data.campaignId, 'campaign id') : null
  const note = nullableText(data?.note, 1200)
  const nextAction = nullableText(data?.nextAction, 240)
  const nextActionDue = optionalDate(data?.nextActionDue)
  const activityId = randomBytes(12).toString('hex')
  const createdAtIso = new Date().toISOString()
  const actorEmail = request.auth?.token?.email || profile.email || null
  const actorUid = request.auth?.uid || 'admin'

  const activity = {
    employerId,
    contactId,
    contactEmail: contactEmail || null,
    campaignId,
    outcome,
    note,
    nextAction,
    nextActionDue,
    actorUid,
    actorEmail,
    createdAtIso,
    createdAt: FieldValue.serverTimestamp(),
  }
  const activityEntry = {
    employerId,
    contactId,
    contactEmail: contactEmail || null,
    campaignId,
    outcome,
    note,
    nextAction,
    createdAtIso,
    actorEmail,
  }

  const batch = db.batch()
  batch.set(db.collection('employerActivities').doc(activityId), activity)

  const employerUpdate = {
    lastOutcome: outcome,
    lastOutcomeNote: note,
    lastOutcomeAt: FieldValue.serverTimestamp(),
    lastCrmActivityAt: FieldValue.serverTimestamp(),
    activityCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  }
  const stage = OUTCOME_STAGE[outcome]
  if (stage) employerUpdate.crmStage = stage
  if (nextAction || Object.prototype.hasOwnProperty.call(data || {}, 'nextAction')) {
    employerUpdate.nextAction = nextAction
    employerUpdate.nextActionDue = nextActionDue
  }
  batch.set(employerRef, employerUpdate, { merge: true })

  if (contactId) {
    const contactUpdate = {
      lastOutcome: outcome,
      lastOutcomeNote: note,
      lastOutcomeAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (OUTCOME_STAGE[outcome]) contactUpdate.status = OUTCOME_STAGE[outcome]
    batch.set(db.collection('employerContacts').doc(contactId), contactUpdate, { merge: true })
  }

  if (campaignId) {
    batch.set(db.collection('campaigns').doc(campaignId), {
      crmActions: FieldValue.arrayUnion(activityEntry),
      manualOutcomeCounts: { [outcome]: FieldValue.increment(1) },
      lastCrmOutcome: outcome,
      lastCrmOutcomeAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  await batch.commit()
  await writeAuditLog({
    actorUid,
    actorEmail,
    action: 'employer.outcome_log',
    targetType: 'employer',
    targetId: employerId,
    metadata: {
      outcome,
      contactEmail: contactEmail || null,
      campaignId,
      hasNextAction: Boolean(nextAction),
    },
  })

  return { success: true, employerId, activityId }
}

export async function updateEmployerContactHandler(data, request) {
  const profile = await assertPermission(request, PERMISSIONS.VIEW_CANDIDATES)
  const employerId = requireDocId(data?.employerId, 'employer id')
  const name = nullableText(data?.name || data?.contactName, 120)
  const email = normalizeEmail(data?.email)
  const title = nullableText(data?.title, 120)
  const phone = nullableText(data?.phone, 40)
  const linkedinUrl = nullableText(data?.linkedinUrl || data?.linkedInUrl, 240)
  const preferredChannel = enumValue(data?.preferredChannel, CONTACT_CHANNELS, 'email')
  const notes = nullableText(data?.notes, 1200)
  const tags = stringList(data?.tags, 12, 40)

  if (!name && !email && !phone && !linkedinUrl) {
    throw new HttpsError('invalid-argument', 'Add a name, email, phone number, or LinkedIn URL for this contact.')
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Enter a valid contact email address.')
  }

  const db = getFirestore()
  const employerRef = db.collection('employers').doc(employerId)
  const employerSnap = await employerRef.get()
  if (!employerSnap.exists) throw new HttpsError('not-found', 'Employer not found.')

  const contactId = data?.contactId
    ? requireDocId(data.contactId, 'contact id')
    : (email ? employerContactId(email) : safeDocId(`${employerId}-${name || phone || linkedinUrl}`, 'contact'))
  const contactRef = db.collection('employerContacts').doc(contactId)
  const nowIso = new Date().toISOString()
  const actorEmail = request.auth?.token?.email || profile.email || null
  const actorUid = request.auth?.uid || 'admin'

  const contactData = {
    employerId,
    employerName: employerNameFor(email, employerSnap.data().name),
    name,
    email: email || null,
    title,
    phone,
    linkedinUrl,
    preferredChannel,
    notes,
    tags,
    crmUpdatedAt: FieldValue.serverTimestamp(),
    crmUpdatedBy: actorEmail || actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  }
  if (!data?.contactId) {
    contactData.createdAt = FieldValue.serverTimestamp()
    contactData.status = 'prospect'
  }

  const employerUpdate = {
    updatedAt: FieldValue.serverTimestamp(),
    crmUpdatedAt: FieldValue.serverTimestamp(),
  }
  if (name) employerUpdate.contactNames = FieldValue.arrayUnion(name)
  if (email) employerUpdate.contactEmails = FieldValue.arrayUnion(email)

  const activityId = randomBytes(12).toString('hex')
  const batch = db.batch()
  batch.set(contactRef, contactData, { merge: true })
  batch.set(employerRef, employerUpdate, { merge: true })
  batch.set(db.collection('employerActivities').doc(activityId), {
    employerId,
    contactId,
    contactEmail: email || null,
    outcome: 'manual_note',
    note: `${data?.contactId ? 'Updated' : 'Added'} contact${name ? `: ${name}` : ''}${title ? ` (${title})` : ''}`,
    actorUid,
    actorEmail,
    createdAtIso: nowIso,
    createdAt: FieldValue.serverTimestamp(),
  })
  await batch.commit()

  await writeAuditLog({
    actorUid,
    actorEmail,
    action: 'employer.contact_update',
    targetType: 'employer_contact',
    targetId: contactId,
    metadata: {
      employerId,
      hasName: Boolean(name),
      hasEmail: Boolean(email),
      preferredChannel,
      tagCount: tags.length,
    },
  })

  return { success: true, employerId, contactId }
}

export async function recordCampaignSequenceStepHandler(data, request) {
  const profile = await assertPermission(request, PERMISSIONS.VIEW_CANDIDATES)
  const campaignId = requireDocId(data?.campaignId, 'campaign id')
  const step = enumValue(data?.step, CAMPAIGN_SEQUENCE_STEPS)
  const medium = enumValue(data?.medium, CONTACT_CHANNELS, 'email')
  if (!step) throw new HttpsError('invalid-argument', 'Unsupported campaign sequence step.')

  const db = getFirestore()
  const campaignRef = db.collection('campaigns').doc(campaignId)
  const campaignSnap = await campaignRef.get()
  if (!campaignSnap.exists) throw new HttpsError('not-found', 'Campaign not found.')

  const campaign = campaignSnap.data()
  const employerId = data?.employerId
    ? requireDocId(data.employerId, 'employer id')
    : (campaign.employerIds || [])[0]
  const contactId = data?.contactId ? requireDocId(data.contactId, 'contact id') : null
  const contactEmail = normalizeEmail(data?.contactEmail)
  const note = nullableText(data?.note, 900)
  const actorEmail = request.auth?.token?.email || profile.email || null
  const actorUid = request.auth?.uid || 'admin'
  const completedAtIso = new Date().toISOString()
  const entry = {
    step,
    medium,
    employerId: employerId || null,
    contactId,
    contactEmail: contactEmail || null,
    note,
    completedAtIso,
    actorEmail,
  }

  const batch = db.batch()
  batch.set(campaignRef, {
    sequenceSteps: {
      [step]: {
        medium,
        contactId,
        contactEmail: contactEmail || null,
        note,
        completedAtIso,
        actorEmail,
      },
    },
    sequenceHistory: FieldValue.arrayUnion(entry),
    sequenceCompletedCount: FieldValue.increment(1),
    lastSequenceStep: step,
    lastSequenceMedium: medium,
    lastSequenceStepAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  if (employerId) {
    const employerUpdate = {
      lastSequenceStep: step,
      lastSequenceStepAt: FieldValue.serverTimestamp(),
      lastCrmActivityAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (step === 'initial_shortlist') employerUpdate.crmStage = 'contacted'
    batch.set(db.collection('employers').doc(employerId), employerUpdate, { merge: true })
    batch.set(db.collection('employerActivities').doc(randomBytes(12).toString('hex')), {
      employerId,
      contactId,
      contactEmail: contactEmail || null,
      campaignId,
      outcome: step === 'initial_shortlist' ? 'manual_note' : 'follow_up_sent',
      sequenceStep: step,
      medium,
      note: note || `Completed outreach step: ${step}`,
      actorUid,
      actorEmail,
      createdAtIso: completedAtIso,
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  if (contactId) {
    batch.set(db.collection('employerContacts').doc(contactId), {
      lastSequenceStep: step,
      lastSequenceStepAt: FieldValue.serverTimestamp(),
      lastOutcome: step === 'initial_shortlist' ? 'manual_note' : 'follow_up_sent',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  await batch.commit()
  await writeAuditLog({
    actorUid,
    actorEmail,
    action: 'campaign.sequence_step_completed',
    targetType: 'campaign',
    targetId: campaignId,
    metadata: {
      employerId: employerId || null,
      contactId,
      step,
      medium,
    },
  })

  return { success: true, campaignId, step, medium }
}

function serializeTimestamp(value) {
  if (!value) return null
  if (value.toDate) return value.toDate().toISOString()
  if (value.seconds) return new Date(value.seconds * 1000).toISOString()
  return null
}
