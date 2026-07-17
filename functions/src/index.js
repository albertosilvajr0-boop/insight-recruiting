import { initializeApp } from 'firebase-admin/app'
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { scoreResume } from './pipeline/scoreResume.js'
import { transcribeAndScoreVideo } from './pipeline/transcribeVideo.js'
import { routeCandidate } from './pipeline/routeCandidate.js'
import { sendDailyDigest } from './email/dailyDigest.js'
import { sendReminders } from './email/sendReminder.js'
import { sendNewApplicationNotification } from './email/sendNewApplicationNotification.js'
import { sendApplicationReceipt } from './email/sendApplicationReceipt.js'
import { generateJobFeed } from './jobs/jobFeed.js'
import { generateSitemap } from './jobs/sitemap.js'
import { renderApplyPage } from './jobs/applyPage.js'
import { createUserHandler, updateUserHandler, deleteUserHandler, ensureCurrentUserProfileHandler } from './users/manageUsers.js'
import { sendPhoneVerificationHandler, verifyPhoneCodeHandler } from './verification/phoneVerification.js'
import { getCandidateStatusHandler } from './candidates/getCandidateStatus.js'
import { auditCandidateUpdate } from './candidates/auditCandidateChanges.js'
import { shareCandidateHandler, shareCandidatesHandler } from './candidates/shareCandidate.js'
import { trackShareClick } from './candidates/shareTracking.js'
import {
  createCandidateInviteHandler,
  attachInviteResumeHandler,
  getInviteSessionHandler,
  submitInvitedInterviewHandler,
  reopenInviteHandler,
  reopenOwnInterviewHandler,
} from './candidates/invites.js'
import { assertPermission } from './security/assertAccess.js'
import { PERMISSIONS } from './security/roles.js'
import { writeAuditLog } from './utils/auditLog.js'

initializeApp()

// Gmail app password for SMTP sending (see email/sendEmail.js). Declared on
// every function that can send mail so the secret is mounted at runtime.
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD')
const EMAIL_SECRETS = [GMAIL_APP_PASSWORD]

// ─── Triggered on new candidate document ───────────────────────────────────
async function runCandidatePipeline(candidateId, candidate) {
  console.log(`[pipeline] Starting for candidate ${candidateId}`)

  // Notify admin of new application
  try {
    await sendNewApplicationNotification(candidate)
  } catch (emailErr) {
    console.error(`[pipeline] Failed to send notification email:`, emailErr.message)
  }

  // Send candidate-facing receipt with status portal link. Non-fatal;
  // we never block the pipeline on an email failure.
  try {
    const baseUrl = process.env.PUBLIC_BASE_URL || 'https://insightedgehq.com'
    await sendApplicationReceipt(candidate, baseUrl)
  } catch (emailErr) {
    console.error(`[pipeline] Failed to send candidate receipt:`, emailErr.message)
  }

  // 1. Score resume
  const resumeResult = await scoreResume(candidateId, candidate)
  console.log(`[pipeline] Resume scored: ${resumeResult.score}`)

  // If automation flags a concern, stop after routing to human review.
  if (resumeResult.autoDisqualified) {
    await routeCandidate(candidateId, resumeResult, { score: 0, strengths: [], concerns: ['Auto-disqualified at resume stage'] })
    return
  }

  // 2. Transcribe + score video
  const videoResult = await transcribeAndScoreVideo(candidateId, candidate)
  console.log(`[pipeline] Video scored: ${videoResult.score}`)

  // 3. Route candidate based on composite score
  await routeCandidate(candidateId, resumeResult, videoResult)
  console.log(`[pipeline] Routing complete for ${candidateId}`)
  await writeAuditLog({
    action: 'candidate.pipeline_complete',
    targetType: 'candidate',
    targetId: candidateId,
    metadata: {
      resumeScore: resumeResult.score,
      interviewScore: videoResult.score,
    },
  })
}

export const onCandidateCreated = onDocumentCreated(
  { document: 'candidates/{candidateId}', secrets: EMAIL_SECRETS, timeoutSeconds: 540 },
  async (event) => {
    const candidate = event.data.data()
    const candidateId = event.params.candidateId

    // Invited candidates haven't interviewed yet — the pipeline runs when
    // they submit (invited → applied transition in onCandidateUpdated).
    if (candidate.stage === 'invited') {
      console.log(`[pipeline] Skipping invited candidate ${candidateId} — awaiting interview`)
      return
    }

    try {
      await runCandidatePipeline(candidateId, candidate)
    } catch (err) {
      console.error(`[pipeline] Error for ${candidateId}:`, err)
    }
  }
)

export const onCandidateUpdated = onDocumentUpdated(
  { document: 'candidates/{candidateId}', secrets: EMAIL_SECRETS, timeoutSeconds: 540 },
  async (event) => {
    await auditCandidateUpdate(event)

    // Invited candidate just submitted their interview — run the pipeline now.
    const before = event.data.before.data()
    const after = event.data.after.data()
    if (before.stage === 'invited' && after.stage === 'applied') {
      const candidateId = event.params.candidateId
      try {
        await runCandidatePipeline(candidateId, after)
      } catch (err) {
        console.error(`[pipeline] Error for invited candidate ${candidateId}:`, err)
      }
    }
  }
)

// ─── Daily digest at 7 AM Central Time ─────────────────────────────────────
export const dailyDigest = onSchedule(
  { schedule: '0 7 * * *', timeZone: 'America/Chicago', secrets: EMAIL_SECRETS },
  async () => {
    await sendDailyDigest()
  }
)

// ─── Reminders: check every hour for upcoming interviews ───────────────────
export const interviewReminders = onSchedule(
  { schedule: '0 * * * *', timeZone: 'America/Chicago', secrets: EMAIL_SECRETS },
  async () => {
    await sendReminders()
  }
)

// ─── Callable: get available scheduling slots ───────────────────────────────
export const getSlots = onCall(async (request) => {
  const { token } = request.data
  if (!token) throw new HttpsError('invalid-argument', 'Missing scheduling token.')
  throw new HttpsError('failed-precondition', 'Self-scheduling is no longer available. The recruiting team will reach out directly with next steps.')
})

// ─── Callable: book a scheduling slot ──────────────────────────────────────
export const bookInterview = onCall({ secrets: EMAIL_SECRETS }, async (request) => {
  const { token, slotId } = request.data
  if (!token || !slotId) throw new HttpsError('invalid-argument', 'Missing token or slotId.')
  throw new HttpsError('failed-precondition', 'Self-scheduling is no longer available. The recruiting team will reach out directly with next steps.')
})

export const getCandidateStatus = onCall(async (request) => {
  return getCandidateStatusHandler(request.data)
})

// ─── Invited candidates (access-code flow) ──────────────────────────────────
export const shareCandidate = onCall({ secrets: EMAIL_SECRETS, timeoutSeconds: 300 }, async (request) => {
  return shareCandidateHandler(request.data, request)
})

export const shareCandidates = onCall({ secrets: EMAIL_SECRETS, timeoutSeconds: 300 }, async (request) => {
  return shareCandidatesHandler(request.data, request)
})

export const createCandidateInvite = onCall({ secrets: EMAIL_SECRETS }, async (request) => {
  return createCandidateInviteHandler(request.data, request)
})

export const attachInviteResume = onCall(async (request) => {
  return attachInviteResumeHandler(request.data, request)
})

export const getInviteSession = onCall(async (request) => {
  return getInviteSessionHandler(request.data)
})

export const submitInvitedInterview = onCall(async (request) => {
  return submitInvitedInterviewHandler(request.data)
})

export const reopenInvite = onCall(async (request) => {
  return reopenInviteHandler(request.data, request)
})

export const reopenOwnInterview = onCall(async (request) => {
  return reopenOwnInterviewHandler(request.data)
})

// ─── XML Job Feed for Indeed / ZipRecruiter crawlers ───────────────────────
export const jobFeed = onRequest(
  { cors: true },
  async (req, res) => {
    try {
      const xml = await generateJobFeed()
      res.set('Content-Type', 'application/xml')
      res.set('Cache-Control', 'public, max-age=3600')
      res.send(xml)
    } catch (err) {
      console.error('[jobFeed] Error:', err)
      res.status(500).send('Internal error')
    }
  }
)

// ─── XML Sitemap for search engines (served at /sitemap.xml via hosting) ────
export const sitemap = onRequest(
  { cors: true },
  async (req, res) => {
    try {
      const xml = await generateSitemap()
      res.set('Content-Type', 'application/xml')
      res.set('Cache-Control', 'public, max-age=3600')
      res.send(xml)
    } catch (err) {
      console.error('[sitemap] Error:', err)
      res.status(500).send('Internal error')
    }
  }
)

// ─── Server-rendered job pages: JobPosting JSON-LD for crawlers ─────────────
export const applyPage = onRequest(
  { cors: true },
  renderApplyPage
)

// ─── Share-email engagement tracking (open pixel + click redirects, /t/**) ──
export const trackShare = onRequest(
  { cors: true },
  trackShareClick
)

// ─── User Management (admin only) ─────────────────────────────────────────
export const createUser = onCall(async (request) => {
  return createUserHandler(request.data, request)
})

export const ensureCurrentUserProfile = onCall(async (request) => {
  return ensureCurrentUserProfileHandler(request.data, request)
})

export const updateUser = onCall(async (request) => {
  return updateUserHandler(request.data, request)
})

export const deleteUser = onCall(async (request) => {
  return deleteUserHandler(request.data, request)
})

// ─── Manual Scoring (admin trigger) ───────────────────────────────────────
export const scoreCandidate = onCall({ secrets: EMAIL_SECRETS, timeoutSeconds: 540 }, async (request) => {
  await assertPermission(request, PERMISSIONS.SCORE_CANDIDATES)

  const { candidateId } = request.data
  if (!candidateId) throw new HttpsError('invalid-argument', 'Missing candidateId')

  const { getFirestore } = await import('firebase-admin/firestore')
  const db = getFirestore()
  const snap = await db.collection('candidates').doc(candidateId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Candidate not found.')

  const candidate = snap.data()

  try {
    // 1. Score resume
    const resumeResult = await scoreResume(candidateId, candidate)
    console.log(`[scoreCandidate] Resume scored: ${resumeResult.score}`)

    if (resumeResult.autoDisqualified) {
      await routeCandidate(candidateId, resumeResult, { score: 0, strengths: [], concerns: ['Auto-disqualified at resume stage'] })
      return { success: true, autoDisqualified: true }
    }

    // 2. Transcribe + score video
    const videoResult = await transcribeAndScoreVideo(candidateId, candidate)
    console.log(`[scoreCandidate] Video scored: ${videoResult.score}`)

    // 3. Route candidate
    await routeCandidate(candidateId, resumeResult, videoResult)
    console.log(`[scoreCandidate] Routing complete`)
    await writeAuditLog({
      actorUid: request.auth.uid,
      actorEmail: request.auth.token?.email || null,
      action: 'candidate.score_manual_trigger',
      targetType: 'candidate',
      targetId: candidateId,
      metadata: {
        resumeScore: resumeResult.score,
        interviewScore: videoResult.score,
      },
    })

    return { success: true, resumeScore: resumeResult.score, interviewScore: videoResult.score }
  } catch (err) {
    console.error(`[scoreCandidate] Error:`, err)
    if (err instanceof HttpsError) throw err
    throw new HttpsError('internal', `Scoring failed: ${err.message}`)
  }
})

// ─── Phone Verification ───────────────────────────────────────────────────
export const sendPhoneVerification = onCall(async (request) => {
  return sendPhoneVerificationHandler(request.data, request)
})

export const verifyPhoneCode = onCall(async (request) => {
  return verifyPhoneCodeHandler(request.data, request)
})
