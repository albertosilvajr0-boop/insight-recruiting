import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { onCall } from 'firebase-functions/v2/https'
import { scoreResume } from './pipeline/scoreResume.js'
import { transcribeAndScoreVideo } from './pipeline/transcribeVideo.js'
import { routeCandidate } from './pipeline/routeCandidate.js'
import { sendDailyDigest } from './email/dailyDigest.js'
import { getAvailableSlots } from './calendar/getAvailableSlots.js'
import { bookSlot } from './calendar/bookSlot.js'

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

// ─── Daily digest at 7 AM Mountain Time ────────────────────────────────────
export const dailyDigest = onSchedule(
  { schedule: '0 7 * * *', timeZone: 'America/Denver' },
  async () => {
    await sendDailyDigest()
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
