import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { google } from 'googleapis'
import { callClaude } from '../utils/anthropic.js'

const INTERVIEW_QUESTIONS = {
  'bdc-agent': [
    "Tell me about yourself and why you're interested in this BDC role.",
    "A customer calls frustrated about a follow-up that was missed. Walk me through how you handle that call.",
    "How do you stay motivated making high-volume outbound calls?"
  ],
  'sales-rep': [
    "Tell me about yourself and your sales background.",
    "A customer says the monthly payment is too high. Walk me through your response.",
    "What does your follow-up process look like after a customer visits but doesn't buy?"
  ],
  'service-advisor': [
    "Tell me about yourself and your service experience.",
    "A customer is upset their car wasn't ready when promised. How do you handle it?",
    "How do you upsell additional services without feeling pushy?"
  ]
}

const SCORING_PROMPTS = {
  'bdc-agent': `You are evaluating a candidate interview for a BDC Agent role at San Antonio Dodge.
Score 1-10 based on:
- Communication clarity and phone manner (weight: 35%)
- Customer service orientation and de-escalation (weight: 30%)
- Call center / outbound experience demonstrated (weight: 20%)
- Motivation and enthusiasm (weight: 15%)`,

  'sales-rep': `You are evaluating a candidate interview for a Sales Representative role at San Antonio Dodge.
Score 1-10 based on:
- Communication clarity and persuasion (weight: 35%)
- Sales experience and closing ability (weight: 30%)
- Customer relationship building (weight: 20%)
- Motivation and enthusiasm (weight: 15%)`,

  'service-advisor': `You are evaluating a candidate interview for a Service Advisor role at San Antonio Dodge.
Score 1-10 based on:
- Communication clarity and professionalism (weight: 35%)
- Service/automotive knowledge demonstrated (weight: 30%)
- Customer service orientation and upselling tact (weight: 20%)
- Motivation and enthusiasm (weight: 15%)`
}

async function transcribeAudio(audioBuffer) {
  const speech = google.speech('v1')
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  })
  const authClient = await auth.getClient()

  const request = {
    auth: authClient,
    requestBody: {
      audio: {
        content: audioBuffer.toString('base64')
      },
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        model: 'latest_long'
      }
    }
  }

  const response = await speech.speech.recognize(request)
  const results = response.data.results || []
  return results.map(r => r.alternatives?.[0]?.transcript || '').join(' ')
}

async function downloadAndConcatChunks(bucket, videoPath) {
  // videoPath is like "videos/{candidateId}" — list all chunks
  const [files] = await bucket.getFiles({ prefix: videoPath })

  // Prefer full_recording.webm if it exists (fallback upload)
  const fullRecording = files.find(f => f.name.endsWith('full_recording.webm'))
  if (fullRecording) {
    const [buffer] = await fullRecording.download()
    return buffer
  }

  // Otherwise concat chunks
  const chunkFiles = files
    .filter(f => f.name.endsWith('.webm') && !f.name.includes('manifest'))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (chunkFiles.length === 0) return null

  const buffers = []
  for (const file of chunkFiles) {
    const [buffer] = await file.download()
    buffers.push(buffer)
  }

  return Buffer.concat(buffers)
}

export async function transcribeAndScoreVideo(candidateId, candidate) {
  const db = getFirestore()
  const bucket = getStorage().bucket()
  const videoResponses = candidate.videoResponses || {}
  const roleKey = candidate.roleKey || 'sales-rep'
  const questions = INTERVIEW_QUESTIONS[roleKey] || INTERVIEW_QUESTIONS['sales-rep']

  let fullTranscript = ''

  // Transcribe each video response
  for (const [qIndex, path] of Object.entries(videoResponses)) {
    if (!path || path.startsWith('skipped')) {
      fullTranscript += `\nQuestion ${parseInt(qIndex) + 1}: "${questions[qIndex] || 'Unknown'}"\nAnswer: [Skipped]\n`
      continue
    }

    try {
      const audioBuffer = await downloadAndConcatChunks(bucket, path)
      if (audioBuffer) {
        const transcript = await transcribeAudio(audioBuffer)
        fullTranscript += `\nQuestion ${parseInt(qIndex) + 1}: "${questions[qIndex] || 'Unknown'}"\nAnswer: ${transcript}\n`
      } else {
        fullTranscript += `\nQuestion ${parseInt(qIndex) + 1}: "${questions[qIndex] || 'Unknown'}"\nAnswer: [No audio captured]\n`
      }
    } catch (err) {
      console.error(`[transcribe] Error for question ${qIndex}:`, err.message)
      fullTranscript += `\nQuestion ${parseInt(qIndex) + 1}: "${questions[qIndex] || 'Unknown'}"\nAnswer: [Transcription failed]\n`
    }
  }

  // Score the interview with Claude
  const systemPrompt = SCORING_PROMPTS[roleKey] || SCORING_PROMPTS['sales-rep']

  const response = await callClaude({
    system: systemPrompt,
    userMessage: `Please evaluate this interview transcript and respond ONLY with valid JSON (no markdown, no explanation):\n\n${fullTranscript}`,
    schema: `{
  "score": number (1-10),
  "strengths": string[],
  "concerns": string[],
  "reasoning": string,
  "standoutQuotes": string[]
}`,
    maxTokens: 1500
  })

  let result
  try {
    result = JSON.parse(response)
  } catch {
    result = { score: 5, strengths: [], concerns: ['Parse error'], reasoning: response, standoutQuotes: [] }
  }

  // Save to Firestore
  await db.collection('candidates').doc(candidateId).update({
    videoTranscript: fullTranscript,
    interviewScore: result.score,
    interviewAnalysis: result.reasoning,
    interviewStrengths: result.strengths,
    interviewConcerns: result.concerns,
    standoutQuotes: result.standoutQuotes || [],
    stage: 'screening',
    updatedAt: FieldValue.serverTimestamp()
  })

  return result
}
