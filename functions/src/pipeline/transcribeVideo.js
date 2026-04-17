import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { google } from 'googleapis'
import { callClaude } from '../utils/anthropic.js'

const INTERVIEW_QUESTIONS = {
  'bdc-agent': [
    "In 60\u201390 seconds, introduce yourself the way you would want a customer to experience you. Tell us what kind of work environment brings out your best and why a BDC role fits you.",
    "Tell us about a time a manager or trainer gave you feedback you needed to act on quickly. What was the feedback, what did you change, and what result came from it?",
    "What are you looking for in your next role, and what usually keeps you engaged and productive long-term?",
    "Tell us about a time you turned around a difficult customer interaction. What was the issue, what did you say, and what was the outcome?",
    "High-volume outbound work can be repetitive. What do you do to keep your tone, urgency, and consistency high over a full day of calls?",
    "Write a text message and a short email to a lead who asked about a vehicle 48 hours ago and has not responded. Keep the text under 220 characters and the email under 90 words.",
    "Thank you for calling San Antonio Dodge, this is [Your Name]. How can I assist you in finding a vehicle today?",
    "I do have a great idea but I don\u2019t want to overpromise and underdeliver \u2014 may I put you on hold for a quick second?",
    "Hi John, this is [Your Name] and I have some really really great news to share \u2014 please call me when you get this at 210-512-1212, again that\u2019s 210-512-1212.",
    "A bat and a ball cost $1.10 total. The bat costs $1 more than the ball. How much does the ball cost?",
    "A farmer has 17 sheep. All but 9 run away. How many sheep does he have left?",
    "You are told a number. Multiply it by 2, add 10, divide by 2, then subtract the original number. What is the final result?",
    "From 1 to 10, how lucky do you feel you are?",
    "Outside of money, what do you value most in life? Give a real example of how that value shows up in your daily behavior.",
    "When you think about success 5\u201310 years from now, what does it look like \u2014 and what are you willing to sacrifice (and not willing to sacrifice) to get there?"
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
This interview includes video responses, script readings (word tracks), written communication samples, timed cognitive questions, and values/mindset questions.

Score 1-10 based on:
- Communication clarity, phone manner, and script delivery (weight: 25%)
- Customer service orientation, de-escalation, and written outreach quality (weight: 25%)
- Cognitive speed and accuracy on timed questions (weight: 15%)
- Coachability, motivation, and work discipline (weight: 20%)
- Values alignment and long-term mindset (weight: 15%)

Note: Questions 10-12 are timed cognitive tests. Evaluate correctness and note if answers appear rushed or overthought. Track timing data if available.`,

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

async function transcribeAudio(audioBuffer, mimeHint) {
  const speech = google.speech('v1')
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  })
  const authClient = await auth.getClient()

  // Pick encoding based on what the browser actually recorded. Safari
  // uploads MP4/AAC; Chrome/Firefox WEBM/Opus. Hardcoding WEBM_OPUS
  // silently produced empty transcripts for any iOS applicant.
  const encoding = mimeHint && mimeHint.includes('mp4') ? 'MP4' : 'WEBM_OPUS'
  const request = {
    auth: authClient,
    requestBody: {
      audio: {
        content: audioBuffer.toString('base64')
      },
      config: {
        encoding,
        sampleRateHertz: encoding === 'MP4' ? 44100 : 48000,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        model: 'latest_long'
      }
    }
  }

  const response = await speech.speech.recognize(request)
  const results = response.data.results || []
  const transcript = results.map(r => r.alternatives?.[0]?.transcript || '').join(' ')
  // Collect timestamps for the first alternative of each result so the
  // admin UI can render a skimmable, click-to-seek view.
  const words = []
  for (const r of results) {
    const alt = r.alternatives?.[0]
    if (!alt?.words) continue
    for (const w of alt.words) {
      const start = parseFloat((w.startTime || '0s').toString().replace('s', ''))
      words.push({ word: w.word, start })
    }
  }
  // Reduce to sentence-level segments so the UI isn't overwhelming —
  // group every ~12 words with their starting timestamp.
  const segments = []
  for (let i = 0; i < words.length; i += 12) {
    const slice = words.slice(i, i + 12)
    if (slice.length === 0) continue
    segments.push({ start: slice[0].start, text: slice.map(w => w.word).join(' ') })
  }
  return { transcript, segments }
}

async function downloadAndConcatChunks(bucket, videoPath) {
  // videoPath is like "videos/{candidateId}" — list all chunks
  const [files] = await bucket.getFiles({ prefix: videoPath })

  // Prefer full_recording.webm / recording.{webm,mp4} if it exists (single-file upload)
  const single = files.find(f =>
    f.name.endsWith('full_recording.webm') ||
    f.name.endsWith('recording.webm') ||
    f.name.endsWith('recording.mp4')
  )
  if (single) {
    const [buffer] = await single.download()
    return { buffer, mime: single.metadata?.contentType || (single.name.endsWith('.mp4') ? 'video/mp4' : 'video/webm') }
  }

  // Otherwise concat chunks
  const chunkFiles = files
    .filter(f => (f.name.endsWith('.webm') || f.name.endsWith('.mp4')) && !f.name.includes('manifest'))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (chunkFiles.length === 0) return null

  const buffers = []
  for (const file of chunkFiles) {
    const [buffer] = await file.download()
    buffers.push(buffer)
  }

  return { buffer: Buffer.concat(buffers), mime: chunkFiles[0].name.endsWith('.mp4') ? 'video/mp4' : 'video/webm' }
}

export async function transcribeAndScoreVideo(candidateId, candidate) {
  const db = getFirestore()
  const bucket = getStorage().bucket()
  const videoResponses = candidate.videoResponses || {}
  const roleKey = candidate.roleKey || 'sales-rep'
  const questions = INTERVIEW_QUESTIONS[roleKey] || INTERVIEW_QUESTIONS['sales-rep']

  let fullTranscript = ''
  const perQuestion = {} // { [qIndex]: { transcript, segments } }

  // Transcribe each video response
  for (const [qIndex, path] of Object.entries(videoResponses)) {
    if (!path || path.startsWith('skipped')) {
      fullTranscript += `\nQuestion ${parseInt(qIndex) + 1}: "${questions[qIndex] || 'Unknown'}"\nAnswer: [Skipped]\n`
      perQuestion[qIndex] = { transcript: '[Skipped]', segments: [] }
      continue
    }

    try {
      const downloaded = await downloadAndConcatChunks(bucket, path)
      if (downloaded) {
        const { transcript, segments } = await transcribeAudio(downloaded.buffer, downloaded.mime)
        fullTranscript += `\nQuestion ${parseInt(qIndex) + 1}: "${questions[qIndex] || 'Unknown'}"\nAnswer: ${transcript}\n`
        perQuestion[qIndex] = { transcript, segments }
      } else {
        fullTranscript += `\nQuestion ${parseInt(qIndex) + 1}: "${questions[qIndex] || 'Unknown'}"\nAnswer: [No audio captured]\n`
        perQuestion[qIndex] = { transcript: '[No audio captured]', segments: [] }
      }
    } catch (err) {
      console.error(`[transcribe] Error for question ${qIndex}:`, err.message)
      fullTranscript += `\nQuestion ${parseInt(qIndex) + 1}: "${questions[qIndex] || 'Unknown'}"\nAnswer: [Transcription failed]\n`
      perQuestion[qIndex] = { transcript: '[Transcription failed]', segments: [] }
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
    videoTranscripts: perQuestion,
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
