import { useState, useEffect, useMemo } from 'react'
import { httpsCallable } from 'firebase/functions'
import { ref, listAll, getDownloadURL } from 'firebase/storage'
import { functions, storage } from '../firebase'
import { pickRecordingFile } from '../utils/videoFiles'

const LINK_TIMEOUT_MS = 8000

function withTimeout(promise, fallback = null) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), LINK_TIMEOUT_MS)),
  ])
}

async function resolveVideoUrl(path) {
  const list = await withTimeout(listAll(ref(storage, path)))
  if (!list) return null
  const file = pickRecordingFile(list.items)
  return file ? withTimeout(getDownloadURL(file)) : null
}

function formatScore(value, max) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}/${max}` : 'Pending'
}

function candidateName(candidate) {
  return `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || 'Candidate'
}

function uniqueList(...groups) {
  return [...new Set(groups.flat().filter(Boolean).map(item => String(item).trim()).filter(Boolean))]
}

function getVideoEntries(candidate) {
  return Object.entries(candidate.videoResponses || {})
    .filter(([, path]) => path && !String(path).startsWith('skipped'))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([qIndex, path]) => ({ qIndex, path, num: Number(qIndex) + 1 }))
}

function truncate(text, max = 700) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned
}

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
  return Promise.resolve()
}

function buildEmailDraft({ candidate, note, links, includeResume, videoCount }) {
  const name = candidateName(candidate)
  const jobTitle = candidate.jobTitle || 'open role'
  const subject = `${name} - candidate review for ${jobTitle}`
  const videoEntries = getVideoEntries(candidate)
  const selectedVideoCount = videoCount === 'all' ? videoEntries.length : Number(videoCount)
  const selectedVideos = selectedVideoCount > 0 ? videoEntries.slice(0, selectedVideoCount) : []
  const videoLinksByQuestion = new Map((links?.videos || []).map(video => [String(video.qIndex), video.url]))
  const strengths = uniqueList(candidate.strengths, candidate.resumeStrengths, candidate.interviewStrengths).slice(0, 5)
  const concerns = uniqueList(candidate.concerns, candidate.resumeConcerns, candidate.interviewConcerns).slice(0, 5)
  const questions = candidate.questions || {}
  const questionKeys = Object.keys(questions).sort((a, b) => Number(a) - Number(b))

  const lines = [
    `Subject: ${subject}`,
    '',
    'Hi,',
    '',
    `I pulled together ${name}'s candidate review for the ${jobTitle}. It includes the AI score, response evidence${videoEntries.length ? ', video responses' : ''}, and scoring notes so your team can decide whether to move forward.`,
    '',
    `${name} - ${candidate.jobTitle || 'Candidate'}`,
    `AI score: ${formatScore(candidate.manualScore?.avg, 10)}`,
  ]

  if (candidate.manualScore?.count) lines.push(`Scored responses: ${candidate.manualScore.count}`)
  if (videoEntries.length) lines.push(`Video responses available: ${videoEntries.length}`)
  if (candidate.email) lines.push(`Candidate email: ${candidate.email}`)
  if (candidate.phone) lines.push(`Candidate phone: ${candidate.phone}`)
  if (note.trim()) lines.push('', `Share note: ${note.trim()}`)
  if (includeResume && candidate.resumeUrl) {
    const resumeLine = links?.resume
      ? `Resume: ${links.resume}`
      : 'Resume: available on request'
    lines.push('', resumeLine)
  }
  if (strengths.length) lines.push('', `Why this candidate is worth reviewing:\n${strengths.map(s => `- ${s}`).join('\n')}`)
  if (concerns.length) lines.push('', `Points to verify:\n${concerns.map(s => `- ${s}`).join('\n')}`)
  if (candidate.resumeAnalysis) lines.push('', `Resume review:\n${truncate(candidate.resumeAnalysis, 900)}`)
  if (candidate.interviewAnalysis) lines.push('', `Interview review:\n${truncate(candidate.interviewAnalysis, 900)}`)

  if (questionKeys.length) {
    lines.push('', 'Question notes and response evidence:')
    for (const qIndex of questionKeys) {
      const q = questions[qIndex] || {}
      const num = Number(qIndex) + 1
      const score = candidate.manualAnswerScores?.[qIndex]
      const scoringNote = candidate.manualAnswerNotes?.[qIndex]
      const written = candidate.textResponses?.[qIndex]
      const transcript = candidate.videoTranscripts?.[qIndex]?.transcript
      const selectedVideo = selectedVideos.find(video => String(video.qIndex) === String(qIndex))
      lines.push('', `Q${num}: ${q.text || `Interview answer ${num}`}`)
      if (score != null) lines.push(`AI score: ${score}/10`)
      if (scoringNote) lines.push(`Scoring note: ${truncate(scoringNote, 1000)}`)
      if (written) lines.push(`Written answer: ${truncate(written, 1000)}`)
      if (!written && transcript) lines.push(`Transcript excerpt: ${truncate(transcript, 1000)}`)
      if (selectedVideo) {
        const videoUrl = videoLinksByQuestion.get(String(qIndex))
        lines.push(`Video response: ${videoUrl || 'available on request'}`)
      }
    }
  }

  lines.push('', "Reply here with questions or candidates you'd like screened next.")
  return lines.join('\n')
}

export default function ShareCandidateModal({ candidate, onClose }) {
  const [mode, setMode] = useState('email')
  const [email, setEmail] = useState('')
  const [employerName, setEmployerName] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [links, setLinks] = useState(null)
  const [linksLoading, setLinksLoading] = useState(false)
  const [includeResume, setIncludeResume] = useState(true)
  const [videoCount, setVideoCount] = useState('1')
  const [copied, setCopied] = useState(false)
  // Tracked-link tab: mints a /t/ token for LinkedIn/SMS/etc. without email
  const [linkContact, setLinkContact] = useState('')
  const [linkCompany, setLinkCompany] = useState('')
  const [linkChannel, setLinkChannel] = useState('linkedin')
  const [linkCreating, setLinkCreating] = useState(false)
  const [linkResult, setLinkResult] = useState(null) // { trackedUrl, contactName }
  const [linkCopied, setLinkCopied] = useState(false)
  const videoEntries = useMemo(() => getVideoEntries(candidate), [candidate])

  useEffect(() => {
    if (mode !== 'text' || links?.resolved) return
    let active = true
    async function load() {
      setLinksLoading(true)
      const out = { resume: null, videos: [] }
      if (candidate.resumeUrl) {
        try { out.resume = await withTimeout(getDownloadURL(ref(storage, candidate.resumeUrl))) } catch { /* skip */ }
      }
      for (const { qIndex, path, num } of videoEntries) {
        try {
          const url = await resolveVideoUrl(path)
          if (url) out.videos.push({ qIndex, num, url })
        } catch { /* skip */ }
      }
      if (active) { setLinks({ ...out, resolved: true }); setLinksLoading(false) }
    }
    load()
    return () => { active = false; setLinksLoading(false) }
  }, [mode, links?.resolved, candidate, videoEntries])

  const shareText = buildEmailDraft({
    candidate,
    note,
    links,
    includeResume,
    videoCount,
  })

  const handleCopy = async () => {
    await copyToClipboard(shareText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const emailList = email.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean)
  const validEmail = emailList.length > 0
    && emailList.length <= 10
    && emailList.every(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))

  const handleCreateLink = async () => {
    if (!linkContact.trim() || linkCreating) return
    setLinkCreating(true)
    setError(null)
    try {
      const createTrackedLink = httpsCallable(functions, 'createTrackedLink')
      const { data } = await createTrackedLink({
        candidateId: candidate.id,
        contactName: linkContact.trim(),
        company: linkCompany.trim(),
        channel: linkChannel,
        manualResumeScores: candidate.manualResumeScores || {},
        manualAnswerScores: candidate.manualAnswerScores || {},
        manualAnswerNotes: candidate.manualAnswerNotes || {},
        manualScore: candidate.manualScore || null,
      })
      setLinkResult(data)
      await copyToClipboard(data.shortUrl || data.trackedUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2500)
    } catch (err) {
      console.error('Tracked link failed:', err)
      setError(err?.message || 'Could not create the link. Please try again.')
    } finally {
      setLinkCreating(false)
    }
  }

  const handleSend = async () => {
    if (!validEmail || sending) return
    setSending(true)
    setError(null)
    try {
      const shareCandidate = httpsCallable(functions, 'shareCandidate')
      const { data } = await shareCandidate({
        candidateId: candidate.id,
        toEmails: emailList,
        employerName: employerName.trim(),
        note: note.trim(),
        manualResumeScores: candidate.manualResumeScores || {},
        manualAnswerScores: candidate.manualAnswerScores || {},
        manualAnswerNotes: candidate.manualAnswerNotes || {},
        manualScore: candidate.manualScore || null,
      })
      setResult(data)
    } catch (err) {
      console.error('Share failed:', err)
      setError(err?.message || 'Failed to send. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
        {result ? (
          <>
            <div className="text-center space-y-2">
              <div className="text-green-500 text-3xl">&#10003;</div>
              <h3 className="text-lg font-semibold text-gray-900">Candidate packet sent</h3>
              <p className="text-sm text-gray-500">
                {candidate.firstName} {candidate.lastName}'s packet went to <span className="font-medium">{(result.recipients || emailList).join(', ')}</span>
                {' '}with {result.resumeAttached ? 'the resume attached, ' : ''}{result.packetAttached ? 'the score packet attached, and ' : ''}{result.videos} video answer{result.videos === 1 ? '' : 's'} linked.
                Video clicks will show under Share activity.
              </p>
            </div>
            <button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-xl">Done</button>
          </>
        ) : (
          <>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Share {candidate.firstName} {candidate.lastName}</h3>
              <p className="text-xs text-gray-500 mt-1">
                {mode === 'email'
                  ? 'Sends a client-ready candidate packet with AI score, scoring notes, resume, response evidence, and one-click video links.'
                  : mode === 'text'
                  ? 'Builds a ready-to-send email draft you can paste into Gmail from your own mailbox.'
                  : 'Mints a tracked link for LinkedIn, SMS, or WhatsApp — no email sent. Clicks and video views show up under this contact\'s name in Employer tracking, just like email recipients.'}
              </p>
            </div>

            <div className="flex rounded-xl bg-gray-100 p-1">
              {[['email', 'Send email'], ['text', 'Copy email draft'], ['link', 'Tracked link']].map(([value, label]) => (
                <button key={value} onClick={() => setMode(value)}
                  className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${mode === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>

            {mode !== 'link' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. Strong phone presence and coachability; this is the type of structured packet I can produce across your whole applicant pipeline."
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            )}

            {mode === 'link' ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Contact name</label>
                  <input
                    type="text"
                    autoFocus
                    value={linkContact}
                    onChange={e => { setLinkContact(e.target.value); setError(null) }}
                    placeholder="Michael McDonald"
                    maxLength={120}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
                    <input
                      type="text"
                      value={linkCompany}
                      onChange={e => setLinkCompany(e.target.value)}
                      placeholder="Optional"
                      maxLength={160}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
                    <select value={linkChannel} onChange={e => setLinkChannel(e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="linkedin">LinkedIn</option>
                      <option value="sms">SMS</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                {linkResult && (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2.5 space-y-1.5">
                    <p className="text-xs font-medium text-green-800">
                      Link for {linkResult.contactName} created{linkCopied ? ' and copied to your clipboard' : ''} — paste it into your message:
                    </p>
                    <div className="flex items-center gap-2">
                      <input readOnly value={linkResult.shortUrl || linkResult.trackedUrl} onFocus={e => e.target.select()}
                        className="flex-1 border border-green-200 rounded-lg px-2 py-1.5 text-xs font-mono text-gray-700 bg-white focus:outline-none" />
                      <button onClick={async () => { await copyToClipboard(linkResult.shortUrl || linkResult.trackedUrl); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000) }}
                        className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white">
                        {linkCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
                {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}
                <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">
                    {linkResult ? 'Done' : 'Cancel'}
                  </button>
                  <button onClick={handleCreateLink} disabled={!linkContact.trim() || linkCreating}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl">
                    {linkCreating ? 'Creating…' : linkResult ? 'Create another link' : 'Create tracked link'}
                  </button>
                </div>
              </>
            ) : mode === 'email' ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Send to</label>
                  <input
                    type="text"
                    autoFocus
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(null) }}
                    placeholder="hiring.manager@dealership.com, gm@dealership.com"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Separate multiple addresses with commas (up to 10). Each person gets their own tracked email.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Employer / company</label>
                  <input
                    type="text"
                    value={employerName}
                    onChange={e => setEmployerName(e.target.value)}
                    placeholder="Optional. Leave blank to group by email domain."
                    maxLength={160}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}
                <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">Cancel</button>
                  <button onClick={handleSend} disabled={!validEmail || sending}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl">
                    {sending ? 'Sending...' : 'Send packet'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={includeResume} onChange={e => setIncludeResume(e.target.checked)}
                      disabled={!candidate.resumeUrl} className="accent-blue-600 w-4 h-4" />
                    Resume link{!candidate.resumeUrl ? ' (none on file)' : linksLoading && !links?.resume ? ' (loading)' : links?.resolved && !links?.resume ? ' (unavailable)' : ''}
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    Videos:
                    <select value={videoCount} onChange={e => setVideoCount(e.target.value)}
                      disabled={!videoEntries.length}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400">
                      <option value="0">None</option>
                      <option value="1">First video</option>
                      <option value="3">First 3</option>
                      <option value="all">All{videoEntries.length ? ` (${videoEntries.length})` : ''}</option>
                    </select>
                  </label>
                </div>
                {linksLoading && (
                  <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    <span className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    Looking up resume and video links. The draft is copyable now and will update as links load.
                  </div>
                )}
                {links?.resolved && candidate.resumeUrl && !links.resume && (
                  <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Resume link could not be loaded. The draft still notes that the resume is available on request.
                  </div>
                )}
                <textarea
                  readOnly
                  value={shareText}
                  rows={10}
                  onFocus={e => e.target.select()}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-xs font-mono text-gray-700 bg-gray-50 resize-none focus:outline-none"
                />
                <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">Close</button>
                  <button onClick={handleCopy} disabled={!shareText}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl">
                    {copied ? 'Copied!' : 'Copy draft'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
