import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { callClaude } from '../utils/anthropic.js'

const SCORING_PROMPTS = {
  'bdc-agent': `You are a recruiter for San Antonio Dodge evaluating a BDC Agent candidate.
Score this resume 1-10 based on:
- Relevant automotive/dealership experience (weight: 25%)
- Customer service or call center experience (weight: 30%)
- Communication quality from resume presentation (weight: 20%)
- Tenure/stability at previous jobs (weight: 15%)
- Education/certifications (weight: 10%)
Hard disqualifiers (return score 1, autoDisqualified: true): requires sponsorship`,

  'sales-rep': `You are a recruiter for San Antonio Dodge evaluating a Sales Representative candidate.
Score this resume 1-10 based on:
- Sales experience and track record (weight: 35%)
- Automotive or high-ticket sales background (weight: 25%)
- Communication quality from resume presentation (weight: 20%)
- Tenure/stability at previous jobs (weight: 10%)
- Education/certifications (weight: 10%)
Hard disqualifiers (return score 1, autoDisqualified: true): requires sponsorship`,

  'service-advisor': `You are a recruiter for San Antonio Dodge evaluating a Service Advisor candidate.
Score this resume 1-10 based on:
- Automotive service or advisor experience (weight: 40%)
- Customer-facing service experience (weight: 25%)
- Technical knowledge indicators (weight: 15%)
- Tenure/stability at previous jobs (weight: 10%)
- Certifications (ASE, manufacturer) (weight: 10%)
Hard disqualifiers (return score 1, autoDisqualified: true): requires sponsorship`
}

export async function scoreResume(candidateId, candidate) {
  const db = getFirestore()
  const bucket = getStorage().bucket()

  // Download resume from Storage
  const [resumeBuffer] = await bucket.file(candidate.resumeUrl).download()
  const resumeText = resumeBuffer.toString('utf8').slice(0, 8000) // trim to safe length

  const systemPrompt = SCORING_PROMPTS[candidate.roleKey] || SCORING_PROMPTS['sales-rep']

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
    stage: result.autoDisqualified ? 'rejected' : 'screening',
    updatedAt: FieldValue.serverTimestamp()
  })

  return result
}
