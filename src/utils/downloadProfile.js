import { ref, getDownloadURL, listAll } from 'firebase/storage'
import { storage } from '../firebase'

// Build a candidate profile zip (resume + videos + text summary) and trigger
// a browser download. Admins use this to email a full profile in one attachment.
//
// JSZip is loaded dynamically so the admin-only dependency doesn't weigh down
// the candidate-facing bundle.

function sanitize(s) {
  return String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file'
}

function extFromPath(path) {
  const m = /\.([A-Za-z0-9]{1,8})(?:\?|#|$)/.exec(path || '')
  return m ? m[1].toLowerCase() : ''
}

async function fetchBlob(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

function formatScores(candidate) {
  const lines = []
  const manual = candidate.manualScore
  if (manual?.avg != null) {
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
  L.push(`Name:      ${candidate.firstName || ''} ${candidate.lastName || ''}`.trim())
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

async function resolveVideoFile(path) {
  const dirRef = ref(storage, path)
  const list = await listAll(dirRef)
  const full = list.items.find(f => f.name === 'full_recording.webm')
  const firstWebm = list.items.find(f => f.name.endsWith('.webm'))
  return full || firstWebm || null
}

export async function downloadCandidateProfile(candidate, onProgress) {
  if (!candidate) throw new Error('No candidate provided')
  const issues = []
  const report = (msg) => { if (typeof onProgress === 'function') onProgress(msg) }

  report('Preparing…')
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  // Resume
  if (candidate.resumeUrl) {
    try {
      report('Fetching resume…')
      const url = await getDownloadURL(ref(storage, candidate.resumeUrl))
      const blob = await fetchBlob(url)
      const ext = extFromPath(candidate.resumeUrl) || 'pdf'
      zip.file(`resume.${ext}`, blob)
    } catch (err) {
      console.error('Resume fetch failed:', err)
      issues.push(`resume (${err.message || err})`)
    }
  } else {
    issues.push('no resume on file')
  }

  // Videos
  const videoResponses = candidate.videoResponses || {}
  const qEntries = Object.entries(videoResponses)
    .filter(([, path]) => path && !String(path).startsWith('skipped'))
    .sort(([a], [b]) => Number(a) - Number(b))

  for (const [qIndex, path] of qEntries) {
    const num = Number(qIndex) + 1
    try {
      report(`Fetching video ${num}/${qEntries.length}…`)
      const file = await resolveVideoFile(path)
      if (!file) { issues.push(`video Q${num} (no file found)`); continue }
      const url = await getDownloadURL(file)
      const blob = await fetchBlob(url)
      zip.file(`videos/Q${num}.webm`, blob)
    } catch (err) {
      console.error(`Video Q${num} fetch failed:`, err)
      issues.push(`video Q${num} (${err.message || err})`)
    }
  }

  // Summary last — so "issues" reflects everything that actually failed.
  zip.file('profile.txt', buildSummary(candidate, issues))

  report('Packaging…')
  const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
    report(`Packaging… ${Math.round(meta.percent)}%`)
  })

  const filename = sanitize(`${candidate.lastName || ''}_${candidate.firstName || ''}_${candidate.jobTitle || ''}_Profile`) + '.zip'
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)

  report('Done')
  return { filename, issues }
}
