import { randomUUID, createHash } from 'crypto'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { assertPermission } from '../security/assertAccess.js'
import { PERMISSIONS } from '../security/roles.js'
import { sendInviteEmail } from '../email/sendInvite.js'
import { APP_URL, getJobClientName, getJobLocation } from '../config/organization.js'
import { writeAuditLog } from '../utils/auditLog.js'

// No ambiguous characters (0/O, 1/I/L) — these codes get read off a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const SELECTION_PROCESS_VERSION = '2026-05-12.1'
const COMPLIANCE_NOTICE_VERSION = '2026-05-12.1'
const EEO_SURVEY_VERSION = '2026-05-12.1'
const REQUIRED_ACKS = ['processNoticeAccepted', 'aiReviewAccepted', 'accuracyCertified']

function generateAccessCode() {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

export function normalizeAccessCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

async function findCandidateByCode(db, code) {
  const normalized = normalizeAccessCode(code)
  if (normalized.length !== CODE_LENGTH) return null
  const snap = await db.collection('candidates')
    .where('accessCode', '==', normalized)
    .limit(1)
    .get()
  if (snap.empty) return null
  return { id: snap.docs[0].id, data: snap.docs[0].data() }
}

function requireString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new HttpsError('invalid-argument', `Invalid or missing ${field}.`)
  }
  return value.trim()
}

async function hasCurrentSelectionCompliance(db, candidateId) {
  const snap = await db.collection('candidateCompliance').doc(candidateId).get()
  if (!snap.exists) return false

  const compliance = snap.data() || {}
  return compliance.selectionProcessVersion === SELECTION_PROCESS_VERSION
    && compliance.complianceNoticeVersion === COMPLIANCE_NOTICE_VERSION
    && compliance.eeoSurveyVersion === EEO_SURVEY_VERSION
    && REQUIRED_ACKS.every((key) => compliance.acknowledgements?.[key] === true)
}

// ─── Admin: create an invited candidate ─────────────────────────────────────
export async function createCandidateInviteHandler(data, request) {
  const profile = await assertPermission(request, PERMISSIONS.VIEW_CANDIDATES)
  const db = getFirestore()

  const firstName = requireString(data.firstName, 'first name', 80)
  const lastName = requireString(data.lastName, 'last name', 80)
  const email = requireString(data.email, 'email', 160)
  const phone = requireString(data.phone, 'phone', 40)
  const jobId = requireString(data.jobId, 'job', 120)

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email address.')
  }

  const jobSnap = await db.collection('jobs').doc(jobId).get()
  if (!jobSnap.exists) throw new HttpsError('not-found', 'Job not found.')
  const job = { id: jobSnap.id, ...jobSnap.data() }

  // Unique access code — retry on the (unlikely) collision
  let accessCode = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidateCode = generateAccessCode()
    const existing = await findCandidateByCode(db, candidateCode)
    if (!existing) { accessCode = candidateCode; break }
  }
  if (!accessCode) throw new HttpsError('internal', 'Could not generate a unique access code. Please try again.')

  const candidateId = randomUUID()
  const statusToken = randomUUID()
  const clientName = getJobClientName(job)

  await db.collection('candidates').doc(candidateId).set({
    candidateId,
    firstName,
    lastName,
    email,
    phone,
    jobId: job.id,
    jobTitle: job.title,
    roleKey: job.roleKey,
    clientName,
    organizationName: clientName,
    location: getJobLocation(job),
    stage: 'invited',
    accessCode,
    statusToken,
    resumeUrl: null,
    resumeSkipped: false,
    invitedBy: { uid: request.auth.uid, email: request.auth.token?.email || null },
    invitedAt: FieldValue.serverTimestamp(),
    inviteEmailSentAt: null,
    firstSignInAt: null,
    compositeScore: null,
    resumeScore: null,
    interviewScore: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  const inviteLink = `${APP_URL}/i/${accessCode}`

  let emailSent = false
  try {
    await sendInviteEmail({ firstName, email, jobTitle: job.title, clientName, accessCode, inviteLink })
    emailSent = true
    await db.collection('candidates').doc(candidateId).update({
      inviteEmailSentAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    console.error(`[invites] Failed to send invite email to ${email}:`, err.message)
  }

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: profile.email || request.auth.token?.email || null,
    action: 'candidate.invited',
    targetType: 'candidate',
    targetId: candidateId,
    metadata: { jobId: job.id, jobTitle: job.title, emailSent },
  })

  return { candidateId, accessCode, inviteLink, emailSent }
}

// ─── Admin: attach an uploaded resume to an invited candidate ───────────────
export async function attachInviteResumeHandler(data, request) {
  await assertPermission(request, PERMISSIONS.VIEW_CANDIDATES)
  const db = getFirestore()

  const candidateId = requireString(data.candidateId, 'candidateId', 80)
  const resumeUrl = requireString(data.resumeUrl, 'resumeUrl', 260)
  if (!resumeUrl.startsWith(`resumes/${candidateId}/`)) {
    throw new HttpsError('invalid-argument', 'Resume path does not match candidate.')
  }

  const snap = await db.collection('candidates').doc(candidateId).get()
  if (!snap.exists || snap.data().stage !== 'invited') {
    throw new HttpsError('failed-precondition', 'Candidate is not an open invite.')
  }

  await db.collection('candidates').doc(candidateId).update({
    resumeUrl,
    resumeSkipped: false,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { success: true }
}

// ─── Public: exchange an access code for the interview session ──────────────
export async function getInviteSessionHandler(data) {
  const db = getFirestore()
  const found = await findCandidateByCode(db, data?.code)
  if (!found) throw new HttpsError('not-found', 'That code was not recognized. Double-check it and try again.')

  const candidate = found.data
  if (candidate.stage !== 'invited') {
    // Already submitted — hand back the status token so the UI can redirect.
    return { alreadySubmitted: true, statusToken: candidate.statusToken || null }
  }

  // Engagement tracking: stamp every sign-in, keep the first one separately.
  const signInStamp = { lastSignInAt: FieldValue.serverTimestamp() }
  if (!candidate.firstSignInAt) signInStamp.firstSignInAt = FieldValue.serverTimestamp()
  await db.collection('candidates').doc(found.id).update(signInStamp)

  // Reopened by an admin after submission: hand back the prior responses so
  // the interview loads pre-filled and the candidate only edits what they
  // need to (their device's local draft was cleared when they submitted).
  const reopened = Boolean(candidate.reopenedAt)
  const complianceCurrent = reopened
    ? await hasCurrentSelectionCompliance(db, found.id)
    : false

  return {
    alreadySubmitted: false,
    candidateId: found.id,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    email: candidate.email,
    phone: candidate.phone,
    jobId: candidate.jobId,
    jobTitle: candidate.jobTitle,
    roleKey: candidate.roleKey,
    clientName: candidate.clientName,
    location: candidate.location,
    resumeOnFile: Boolean(candidate.resumeUrl),
    reopened,
    complianceCurrent,
    priorResponses: reopened ? {
      videoResponses: candidate.videoResponses || {},
      textResponses: candidate.textResponses || {},
      timingData: candidate.timingData || {},
    } : null,
  }
}

// ─── Public: candidate reopens their OWN submitted interview ────────────────
// After feedback, candidates can choose to improve answers themselves: sign
// in with the same code → reopen → everything loads pre-filled → resubmit.
export async function reopenOwnInterviewHandler(data) {
  const db = getFirestore()
  const found = await findCandidateByCode(db, data?.code)
  if (!found) throw new HttpsError('not-found', 'That code was not recognized.')
  const candidate = found.data

  if (candidate.stage === 'invited') return { success: true } // already open
  if (['hired', 'rejected'].includes(candidate.stage)) {
    throw new HttpsError('failed-precondition', 'A final decision has been made on this application. Reach out to your recruiter if you have questions.')
  }

  await db.collection('candidates').doc(found.id).update({
    stage: 'invited',
    reopenedAt: FieldValue.serverTimestamp(),
    reopenCount: FieldValue.increment(1),
    reopenedBy: 'candidate',
    updatedAt: FieldValue.serverTimestamp(),
  })

  await writeAuditLog({
    actorEmail: candidate.email || null,
    action: 'candidate.interview_reopened_self',
    targetType: 'candidate',
    targetId: found.id,
    metadata: { previousStage: candidate.stage },
  })

  return { success: true }
}

// ─── Admin: reopen a submitted interview so the candidate can edit ──────────
// Flips the candidate back to 'invited' — they sign in with the same access
// code, their answers load pre-filled, and resubmitting re-runs the pipeline.
export async function reopenInviteHandler(data, request) {
  const profile = await assertPermission(request, PERMISSIONS.SCORE_CANDIDATES)
  const db = getFirestore()

  const candidateId = requireString(data.candidateId, 'candidateId', 80)
  const snap = await db.collection('candidates').doc(candidateId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Candidate not found.')
  const candidate = snap.data()

  if (!candidate.accessCode) {
    throw new HttpsError('failed-precondition', 'Only invited candidates (with an access code) can be reopened.')
  }
  if (candidate.stage === 'invited') {
    throw new HttpsError('failed-precondition', 'This interview is already open.')
  }
  if (['hired', 'rejected'].includes(candidate.stage)) {
    throw new HttpsError('failed-precondition', 'This candidate has a final decision — change their stage first if you really want to reopen.')
  }

  await db.collection('candidates').doc(candidateId).update({
    stage: 'invited',
    reopenedAt: FieldValue.serverTimestamp(),
    reopenCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  })

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: profile.email || request.auth.token?.email || null,
    action: 'candidate.interview_reopened',
    targetType: 'candidate',
    targetId: candidateId,
    metadata: { previousStage: candidate.stage },
  })

  return { success: true, accessCode: candidate.accessCode, inviteLink: `${APP_URL}/i/${candidate.accessCode}` }
}

// ─── Public: submit the invited candidate's interview responses ─────────────
// Everything (responses + compliance + EEO records) is written server-side in
// one batch, so a retry after a network failure can never half-submit.
export async function submitInvitedInterviewHandler(data) {
  const db = getFirestore()
  const found = await findCandidateByCode(db, data?.code)
  if (!found) throw new HttpsError('not-found', 'That code was not recognized.')
  if (found.data.stage !== 'invited') {
    // Idempotent: a retry after a submit that actually landed is a success.
    if (found.data.submittedAt) return { statusToken: found.data.statusToken || null }
    throw new HttpsError('failed-precondition', 'This interview was already submitted.')
  }

  const videoResponses = data.videoResponses
  const textResponses = data.textResponses
  const questions = data.questions
  const timingData = data.timingData
  for (const [name, value] of [['videoResponses', videoResponses], ['textResponses', textResponses], ['questions', questions], ['timingData', timingData]]) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 200) {
      throw new HttpsError('invalid-argument', `Invalid ${name}.`)
    }
  }
  // Video paths must stay inside this candidate's own storage prefix.
  for (const path of Object.values(videoResponses)) {
    if (typeof path !== 'string' || (!path.startsWith('skipped') && !path.startsWith(`videos/${found.id}`))) {
      throw new HttpsError('invalid-argument', 'Invalid video response path.')
    }
  }

  const candidate = found.data
  const reuseCurrentCompliance = Boolean(data.reuseCurrentCompliance)
    && await hasCurrentSelectionCompliance(db, found.id)
  const needsCompliance = !reuseCurrentCompliance

  let selectionProcessVersion = candidate.selectionProcessVersion || SELECTION_PROCESS_VERSION
  let complianceNoticeVersion = candidate.complianceNoticeVersion || COMPLIANCE_NOTICE_VERSION
  let eeoSurveyVersion = EEO_SURVEY_VERSION
  let renderedNoticeText = ''
  // Parent org is optional display data — most clients don't have one configured.
  const parentOrgDisplayName = String(data.parentOrgDisplayName || '').slice(0, 160)
  const userAgent = String(data.userAgent || 'unknown').slice(0, 600)

  if (needsCompliance) {
    selectionProcessVersion = requireString(data.selectionProcessVersion, 'selectionProcessVersion', 40)
    complianceNoticeVersion = requireString(data.complianceNoticeVersion, 'complianceNoticeVersion', 40)
    eeoSurveyVersion = requireString(data.eeoSurveyVersion, 'eeoSurveyVersion', 40)
    renderedNoticeText = requireString(data.renderedNoticeText, 'renderedNoticeText', 8000)

    if (selectionProcessVersion !== SELECTION_PROCESS_VERSION
      || complianceNoticeVersion !== COMPLIANCE_NOTICE_VERSION
      || eeoSurveyVersion !== EEO_SURVEY_VERSION) {
      throw new HttpsError('failed-precondition', 'The selection process notice has changed. Please reload and review the latest notice.')
    }

    const acknowledgements = data.acknowledgements
    if (!acknowledgements || typeof acknowledgements !== 'object'
      || !REQUIRED_ACKS.every((key) => acknowledgements[key] === true)) {
      throw new HttpsError('failed-precondition', 'All required acknowledgements must be accepted.')
    }
  }

  const employerDisplayName = candidate.clientName || 'Insight Recruiting'
  const complianceBase = {
    candidateId: found.id,
    jobId: candidate.jobId,
    jobTitle: candidate.jobTitle,
    roleKey: candidate.roleKey,
  }

  const batch = db.batch()

  // The invited→applied stage transition kicks off the scoring pipeline
  // (see onCandidateUpdated in index.js).
  const candidateUpdate = {
    videoResponses,
    textResponses,
    questions,
    timingData,
    stage: 'applied',
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (needsCompliance) {
    candidateUpdate.selectionProcessVersion = selectionProcessVersion
    candidateUpdate.complianceNoticeVersion = complianceNoticeVersion
    candidateUpdate.complianceAcknowledgedAt = FieldValue.serverTimestamp()
  }

  batch.update(db.collection('candidates').doc(found.id), candidateUpdate)

  if (needsCompliance) {
    batch.set(db.collection('candidateCompliance').doc(found.id), {
      ...complianceBase,
      selectionProcessVersion,
      complianceNoticeVersion,
      eeoSurveyVersion,
      employerDisplayName,
      parentOrgDisplayName,
      renderedTextHash: createHash('sha256').update(renderedNoticeText).digest('hex'),
      renderedNoticeText,
      checkedAcknowledgementIds: REQUIRED_ACKS,
      userAgent,
      acknowledgements: {
        processNoticeAccepted: true,
        aiReviewAccepted: true,
        accuracyCertified: true,
        acceptedAt: FieldValue.serverTimestamp(),
      },
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  const eeoSurvey = data.eeoSurvey
  if (needsCompliance && eeoSurvey && typeof eeoSurvey === 'object' && eeoSurvey.optedIn === true && eeoSurvey.status === 'provided') {
    batch.set(db.collection('eeoResponses').doc(found.id), {
      ...complianceBase,
      employerDisplayName,
      parentOrgDisplayName,
      eeoSurveyVersion,
      eeoSurvey: {
        optedIn: true,
        status: 'provided',
        gender: String(eeoSurvey.gender || 'Prefer not to answer').slice(0, 80),
        raceEthnicity: String(eeoSurvey.raceEthnicity || 'Prefer not to answer').slice(0, 80),
      },
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  await batch.commit()

  return { statusToken: candidate.statusToken || null }
}
