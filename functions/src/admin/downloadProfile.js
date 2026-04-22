import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { HttpsError } from 'firebase-functions/v2/https'
import JSZip from 'jszip'

const ADMIN_ROLES = ['superadmin', 'admin']

async function assertCallerIsAdmin(db, context) {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Authentication required.')
  const callerSnap = await db.collection('users').doc(context.auth.uid).get()
  const caller = callerSnap.exists ? callerSnap.data() : null
  if (!caller || !ADMIN_ROLES.includes(caller.role)) {
    throw new HttpsError('permission-denied', 'Admin access required.')
  }
}

function sanitize(s) {
  return String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file'
}

function extFromPath(path) {
  const m = /\.([A-Za-z0-9]{1,8})(?:\?|#|$)/.exec(path || '')
  return m ? m[1].toLowerCase() : ''
}

function formatScores(candidate) {
  const lines = []
  const manual = candidate.manualScore
  if (manual && manual.avg != null) {
    lines.push(`Manual score: ${manual.avg.toFixed(1)}/5 (${manual.sum}/${manual.max} points across ${manual.count} items)`)
  }
  if (candidate.compositeScore != null) {
    lines.push(`AI composite: ${candidate.compositeScore.toFixed(1)}/10 (resume ${candidate.resumeScore ?? '—'}/10, interview ${candidate.interviewScore ?? '—'}/10)`)
  }
  return lines.length ? lines.join('\n') : 'Not yet scored'
}

function buildSummary(candidate, issues) {
  const L = []
  L.push('CANDIDATE PROFILE')
  L.push('='.repeat(60))
  L.push(`Name:      ${(candidate.firstName || '')} ${(candidate.lastName || '')}`.trim())
  L.push(`Email:     ${candidate.email || '—'}`)
  L.push(`Phone:     ${candidate.phone || '—'}`)
  L.push(`Position:  ${candidate.jobTitle || '—'}`)
  L.push(`Stage:     ${candidate.stage || '—'}`)
  if (candidate.createdAt?.toDate) L.push(`Applied:   ${candidate.createdAt.toDate().toISOString().slice(0, 10)}`)
  L.push('')
  L.push('SCORES')
  L.push('-'.repeat(60))
  L.push(formatScores(candidate))

  if (candidate.strengths?.length) { L.push(''); L.push('Strengths:'); candidate.strengths.forEach(s => L.push(`  • ${s}`)) }
  if (candidate.concerns?.length)  { L.push(''); L.push('Concerns:');  candidate.concerns.forEach(s => L.push(`  • ${s}`)) }

  if (candidate.resumeAnalysis) {
    L.push(''); L.push('AI Resume Analysis'); L.push('-'.repeat(60)); L.push(candidate.resumeAnalysis)
  }
  if (candidate.interviewAnalysis) {
    L.push(''); L.push('AI Interview Analysis'); L.push('-'.repeat(60)); L.push(candidate.interviewAnalysis)
  }

  const questions = candidate.questions || {}
  const qKeys = Object.keys(questions).sort((a, b) => Number(a) - Number(b))
  if (qKeys.length) {
    L.push(''); L.push('INTERVIEW RESPONSES'); L.push('='.repeat(60))
    for (const k of qKeys) {
      const q = questions[k]
      const num = Number(k) + 1
      const typeLabel = q.type === 'video_reading' ? 'Script Reading'
        : q.type === 'text_response' ? 'Written Response'
        : 'Video Response'
      L.push('')
      L.push(`Q${num} [${typeLabel}${q.category ? ' • ' + q.category : ''}]`)
      L.push(`  "${q.text || ''}"`)
      const videoPath = candidate.videoResponses?.[k]
      if (videoPath && !String(videoPath).startsWith('skipped')) {
        L.push(`  Video: videos/Q${num}.webm`)
      } else if (String(videoPath || '').startsWith('skipped')) {
        L.push(`  Video: (skipped)`)
      }
      const text = candidate.textResponses?.[k]
      if (text) { L.push(`  Written answer:`); text.split('\n').forEach(line => L.push(`    ${line}`)) }
      const transcript = candidate.videoTranscripts?.[k]
      if (transcript?.transcript) {
        L.push(`  Transcript:`)
        transcript.transcript.split('\n').forEach(line => L.push(`    ${line}`))
      }
      const answerScore = candidate.manualAnswerScores?.[k]
      if (answerScore) L.push(`  Evaluator score: ${answerScore}/5`)
    }
  }

  if (candidate.manualResumeScores && Object.keys(candidate.manualResumeScores).length) {
    L.push(''); L.push('RESUME CRITERIA SCORES'); L.push('-'.repeat(60))
    for (const [k, v] of Object.entries(candidate.manualResumeScores)) {
      L.push(`  ${k.replace(/_/g, ' ')}: ${v}/5`)
    }
  }

  if (candidate.adminNotes) {
    L.push(''); L.push('ADMIN NOTES'); L.push('-'.repeat(60)); L.push(candidate.adminNotes)
  }

  if (issues.length) {
    L.push(''); L.push('NOTE — some files could not be included:'); L.push('-'.repeat(60))
    issues.forEach(i => L.push(`  • ${i}`))
  }

  return L.join('\n')
}

// Resolves a video folder to the actual webm file. Candidates either have a
// stitched full_recording.webm or raw chunks (0.webm, 1.webm, …).
async function resolveVideoFile(bucket, folderPath) {
  const normalized = folderPath.endsWith('/') ? folderPath : folderPath + '/'
  const [files] = await bucket.getFiles({ prefix: normalized })
  const webms = files.filter(f => f.name.endsWith('.webm'))
  if (webms.length === 0) return null
  const full = webms.find(f => f.name.endsWith('/full_recording.webm'))
  return full || webms[0]
}

export async function generateCandidateProfileZipHandler(data, context) {
  const db = getFirestore()
  await assertCallerIsAdmin(db, context)

  const { candidateId } = data || {}
  if (!candidateId) throw new HttpsError('invalid-argument', 'Missing candidateId')

  const snap = await db.collection('candidates').doc(candidateId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Candidate not found.')
  const candidate = snap.data()

  const bucket = getStorage().bucket()
  const zip = new JSZip()
  const issues = []

  // Resume
  if (candidate.resumeUrl) {
    try {
      const [buf] = await bucket.file(candidate.resumeUrl).download()
      const ext = extFromPath(candidate.resumeUrl) || 'pdf'
      zip.file(`resume.${ext}`, buf)
    } catch (err) {
      console.error('[profileZip] resume download failed:', err)
      issues.push(`resume (${err.message || err.code || 'unavailable'})`)
    }
  } else {
    issues.push('no resume on file')
  }

  // Videos
  const videoResponses = candidate.videoResponses || {}
  const qEntries = Object.entries(videoResponses)
    .filter(([, p]) => p && !String(p).startsWith('skipped'))
    .sort(([a], [b]) => Number(a) - Number(b))

  for (const [qIndex, folderPath] of qEntries) {
    const num = Number(qIndex) + 1
    try {
      const file = await resolveVideoFile(bucket, folderPath)
      if (!file) { issues.push(`video Q${num} (no file found)`); continue }
      const [buf] = await file.download()
      zip.file(`videos/Q${num}.webm`, buf)
    } catch (err) {
      console.error(`[profileZip] video Q${num} download failed:`, err)
      issues.push(`video Q${num} (${err.message || err.code || 'unavailable'})`)
    }
  }

  zip.file('profile.txt', buildSummary(candidate, issues))

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })

  // Upload to a per-candidate export path. Firebase Storage serves this with
  // a long-lived download token so the browser can fetch it without CORS.
  const filename = sanitize(`${candidate.lastName || ''}_${candidate.firstName || ''}_${candidate.jobTitle || ''}_Profile`) + '.zip'
  const exportPath = `profile-exports/${candidateId}/${Date.now()}_${filename}`
  const downloadToken = cryptoRandomUuid()

  const zipFile = bucket.file(exportPath)
  await zipFile.save(zipBuffer, {
    metadata: {
      contentType: 'application/zip',
      contentDisposition: `attachment; filename="${filename}"`,
      metadata: { firebaseStorageDownloadTokens: downloadToken },
    },
    resumable: false,
  })

  const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(exportPath)}?alt=media&token=${downloadToken}`

  return { url, filename, issues, sizeBytes: zipBuffer.length }
}

function cryptoRandomUuid() {
  // Node 20 ships crypto.randomUUID globally.
  return globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)
}
