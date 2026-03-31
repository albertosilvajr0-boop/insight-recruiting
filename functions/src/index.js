import { initializeApp } from 'firebase-admin/app'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onCall, onRequest } from 'firebase-functions/v2/https'
import { scoreResume } from './pipeline/scoreResume.js'
import { transcribeAndScoreVideo } from './pipeline/transcribeVideo.js'
import { routeCandidate } from './pipeline/routeCandidate.js'
import { sendDailyDigest } from './email/dailyDigest.js'
import { sendReminders } from './email/sendReminder.js'
import { getAvailableSlots } from './calendar/getAvailableSlots.js'
import { bookSlot } from './calendar/bookSlot.js'
import { generateJobFeed } from './jobs/jobFeed.js'
import { createUserHandler, updateUserHandler, deleteUserHandler } from './users/manageUsers.js'
import { sendPhoneVerificationHandler, verifyPhoneCodeHandler } from './verification/phoneVerification.js'

initializeApp()

// ─── Triggered on new candidate document ───────────────────────────────────
export const onCandidateCreated = onDocumentCreated(
  'candidates/{candidateId}',
  async (event) => {
    const candidate = event.data.data()
    const candidateId = event.params.candidateId

    try {
      console.log(`[pipeline] Starting for candidate ${candidateId}`)

      // 1. Score resume
      const resumeResult = await scoreResume(candidateId, candidate)
      console.log(`[pipeline] Resume scored: ${resumeResult.score}`)

      // If auto-disqualified, stop early
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

    } catch (err) {
      console.error(`[pipeline] Error for ${candidateId}:`, err)
    }
  }
)

// ─── Daily digest at 7 AM Central Time ─────────────────────────────────────
export const dailyDigest = onSchedule(
  { schedule: '0 7 * * *', timeZone: 'America/Chicago' },
  async () => {
    await sendDailyDigest()
  }
)

// ─── Reminders: check every hour for upcoming interviews ───────────────────
export const interviewReminders = onSchedule(
  { schedule: '0 * * * *', timeZone: 'America/Chicago' },
  async () => {
    await sendReminders()
  }
)

// ─── Callable: get available scheduling slots ───────────────────────────────
export const getSlots = onCall(async (request) => {
  const { token } = request.data
  if (!token) throw new Error('Missing scheduling token')
  return getAvailableSlots(token)
})

// ─── Callable: book a scheduling slot ──────────────────────────────────────
export const bookInterview = onCall(async (request) => {
  const { token, slotId } = request.data
  if (!token || !slotId) throw new Error('Missing token or slotId')
  return bookSlot(token, slotId)
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

// ─── User Management (admin only) ─────────────────────────────────────────
export const createUser = onCall(async (request) => {
  return createUserHandler(request.data, request)
})

export const updateUser = onCall(async (request) => {
  return updateUserHandler(request.data, request)
})

export const deleteUser = onCall(async (request) => {
  return deleteUserHandler(request.data, request)
})

// ─── Phone Verification ───────────────────────────────────────────────────
export const sendPhoneVerification = onCall(async (request) => {
  return sendPhoneVerificationHandler(request.data, request)
})

export const verifyPhoneCode = onCall(async (request) => {
  return verifyPhoneCodeHandler(request.data, request)
})
