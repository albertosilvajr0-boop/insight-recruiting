import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { callClaude } from '../utils/anthropic.js'
import { getCandidateClientName } from '../config/organization.js'

function buildScoringPrompt(candidate) {
  const clientName = getCandidateClientName(candidate)
  const roleName = candidate.jobTitle || 'the open role'

  return `You are a recruiter for ${clientName} evaluating a candidate for ${roleName}.
Score this resume 1-10 based on:
- Relevant experience for the role (weight: 30%)
- Customer-facing, operational, technical, or sales experience that matches the job (weight: 25%)
- Communication quality from resume presentation (weight: 20%)
- Tenure/stability and progression at previous jobs (weight: 15%)
- Education, certifications, or role-specific credentials (weight: 10%)
Hard disqualifiers (return score 1, autoDisqualified: true): requires sponsorship or does not meet a stated must-have requirement.`
}

export async function scoreResume(candidateId, candidate) {
  const db = getFirestore()
  const bucket = getStorage().bucket()

  // Download resume from Storage
  const [resumeBuffer] = await bucket.file(candidate.resumeUrl).download()
  const resumeText = resumeBuffer.toString('utf8').slice(0, 8000) // trim to safe length

  const systemPrompt = buildScoringPrompt(candidate)

  const response = await callClaude({
    system: systemPrompt,
    userMessage: `Please evaluate this resume and respond ONLY with valid JSON (no markdown, no explanation):\n\n${resumeText}`,
    schema: `{
  "score": number (1-10),
  "strengths": string[],
  "concerns": string[],
  "reasoning": string,
  "autoDisqualified": boolean,
  "disqualifierReason": string | null
}`
  })

  let result
  try {
    result = JSON.parse(response)
  } catch {
    result = { score: 5, strengths: [], concerns: ['Parse error'], reasoning: response, autoDisqualified: false, disqualifierReason: null }
  }

  // Persist to Firestore
  await db.collection('candidates').doc(candidateId).update({
    resumeScore: result.score,
    resumeAnalysis: result.reasoning,
    resumeStrengths: result.strengths,
    resumeConcerns: result.concerns,
    autoDisqualified: result.autoDisqualified,
    disqualifierReason: result.disqualifierReason,
    stage: result.autoDisqualified ? 'scored' : 'applied',
    needsReview: result.autoDisqualified ? true : candidate.needsReview || false,
    updatedAt: FieldValue.serverTimestamp()
  })

  return result
}
