import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { callClaude } from '../utils/anthropic.js'
import { getCandidateClientName } from '../config/organization.js'
import { getRoleRubric, formatScoringWeights, formatHardDisqualifiers } from '../utils/roleRubrics.js'

const DEFAULT_RESUME_WEIGHTS = `- Relevant experience for the role (weight: 30%)
- Customer-facing, operational, technical, or sales experience that matches the job (weight: 25%)
- Communication quality from resume presentation (weight: 20%)
- Tenure/stability and progression at previous jobs (weight: 15%)
- Education, certifications, or role-specific credentials (weight: 10%)`

const DEFAULT_DISQUALIFIERS = 'requires sponsorship or does not meet a stated must-have requirement'

function buildScoringPrompt(candidate, rubric) {
  const clientName = getCandidateClientName(candidate)
  const roleName = candidate.jobTitle || 'the open role'
  const weights = formatScoringWeights(rubric?.scoringWeights, 'resume') || DEFAULT_RESUME_WEIGHTS
  const disqualifiers = formatHardDisqualifiers(rubric?.hardDisqualifiers) || DEFAULT_DISQUALIFIERS

  return `You are a recruiter for ${clientName} evaluating a candidate for ${roleName}.
Score this resume 1-10 based on:
${weights}
Hard disqualifiers (return score 1, autoDisqualified: true): ${disqualifiers}.`
}

export async function scoreResume(candidateId, candidate) {
  const db = getFirestore()

  if (candidate.resumeSkipped || !candidate.resumeUrl) {
    const skipped = candidate.resumeSkipped === true
    const result = {
      score: null,
      strengths: [],
      concerns: [skipped ? 'Resume upload skipped by candidate' : 'No resume uploaded by candidate'],
      reasoning: skipped
        ? 'Candidate skipped resume upload; resume scoring was not run.'
        : 'Candidate has no resume file; resume scoring was not run.',
      autoDisqualified: false,
      disqualifierReason: null,
      skipped,
    }

    await db.collection('candidates').doc(candidateId).update({
      resumeScore: null,
      resumeAnalysis: result.reasoning,
      resumeStrengths: result.strengths,
      resumeConcerns: result.concerns,
      autoDisqualified: false,
      disqualifierReason: null,
      needsReview: candidate.needsReview || false,
      updatedAt: FieldValue.serverTimestamp()
    })

    return result
  }

  // Download resume from Storage
  const bucket = getStorage().bucket()
  const [resumeBuffer] = await bucket.file(candidate.resumeUrl).download()
  const resumeText = resumeBuffer.toString('utf8').slice(0, 8000) // trim to safe length

  const rubric = await getRoleRubric(candidate.roleKey)
  const systemPrompt = buildScoringPrompt(candidate, rubric)

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
