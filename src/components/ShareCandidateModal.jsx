import { useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { ref, listAll, getDownloadURL } from 'firebase/storage'
import { functions, storage } from '../firebase'
import { pickRecordingFile } from '../utils/videoFiles'

async function resolveVideoUrl(path) {
  const list = await listAll(ref(storage, path))
  const file = pickRecordingFile(list.items)
  return file ? getDownloadURL(file) : null
}

function formatScore(value, max) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}/${max}` : 'Pending'
}

function uniqueList(...groups) {
  return [...new Set(groups.flat().filter(Boolean).map(item => String(item).trim()).filter(Boolean))]
}

export default function ShareCandidateModal({ candidate, onClose }) {
  const [mode, setMode] = useState('email')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [links, setLinks] = useState(null)
  const [linksLoading, setLinksLoading] = useState(false)
  const [includeResume, setIncludeResume] = useState(true)
  const [videoCount, setVideoCount] = useState('1')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (mode !== 'text' || links || linksLoading) return
    let active = true
    async function load() {
      setLinksLoading(true)
      const out = { resume: null, videos: [] }
      if (candidate.resumeUrl) {
        try { out.resume = await getDownloadURL(ref(storage, candidate.resumeUrl)) } catch { /* skip */ }
      }
      const entries = Object.entries(candidate.videoResponses || {})
        .filter(([, path]) => path && !String(path).startsWith('skipped'))
        .sort(([a], [b]) => Number(a) - Number(b))
      for (const [qIndex, path] of entries) {
        try {
          const url = await resolveVideoUrl(path)
          if (url) out.videos.push({ num: Number(qIndex) + 1, url })
        } catch { /* skip */ }
      }
      if (active) { setLinks(out); setLinksLoading(false) }
    }
    load()
    return () => { active = false }
  }, [mode, links, linksLoading, candidate])

  const shareText = (() => {
    if (!links) return ''
    const lines = []
    lines.push(`${candidate.firstName} ${candidate.lastName} - ${candidate.jobTitle || 'candidate'}`)
    lines.push(`AI score: ${formatScore(candidate.compositeScore, 10)} (resume ${formatScore(candidate.resumeScore, 10)}, interview ${formatScore(candidate.interviewScore, 10)})`)
    if (candidate.manualScore?.avg != null) lines.push(`Evaluator score: ${formatScore(candidate.manualScore.avg, 5)}`)
    const strengths = uniqueList(candidate.strengths, candidate.resumeStrengths, candidate.interviewStrengths).slice(0, 4)
    if (strengths.length) lines.push(`Strengths:\n${strengths.map(s => `- ${s}`).join('\n')}`)
    if (note.trim()) lines.push(note.trim())
    if (includeResume && links.resume) lines.push(`Resume: ${links.resume}`)
    const n = videoCount === 'all' ? links.videos.length : Number(videoCount)
    links.videos.slice(0, n).forEach(v => {
      const qIndex = String(v.num - 1)
      const noteText = candidate.manualAnswerNotes?.[qIndex]
      lines.push(`Interview Q${v.num}:${noteText ? `\nNotes: ${noteText}` : ''}\nVideo: ${v.url}`)
    })
    return lines.join('\n\n')
  })()

  const handleCopy = () => {
    navigator.clipboard.writeText(shareText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const emailList = email.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean)
  const validEmail = emailList.length > 0
    && emailList.length <= 10
    && emailList.every(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))

  const handleSend = async () => {
    if (!validEmail || sending) return
    setSending(true)
    setError(null)
    try {
      const shareCandidate = httpsCallable(functions, 'shareCandidate')
      const { data } = await shareCandidate({
        candidateId: candidate.id,
        toEmails: emailList,
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
                Opens and video clicks will show under Share activity.
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
                  ? 'Sends a client-ready candidate packet with AI score, evaluator notes, resume, response evidence, and one-click video links.'
                  : 'Builds a short message with score highlights, notes, resume, and video links you can paste anywhere.'}
              </p>
            </div>

            <div className="flex rounded-xl bg-gray-100 p-1">
              {[['email', 'Send email'], ['text', 'Copy as text']].map(([value, label]) => (
                <button key={value} onClick={() => setMode(value)}
                  className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${mode === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>

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

            {mode === 'email' ? (
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
                      disabled={!links?.resume} className="accent-blue-600 w-4 h-4" />
                    Resume link{links && !links.resume ? ' (none on file)' : ''}
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    Videos:
                    <select value={videoCount} onChange={e => setVideoCount(e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="0">None</option>
                      <option value="1">First video</option>
                      <option value="3">First 3</option>
                      <option value="all">All{links ? ` (${links.videos.length})` : ''}</option>
                    </select>
                  </label>
                </div>
                {linksLoading || !links ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
                    <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    Building links...
                  </div>
                ) : (
                  <textarea
                    readOnly
                    value={shareText}
                    rows={8}
                    onFocus={e => e.target.select()}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-xs font-mono text-gray-700 bg-gray-50 resize-none focus:outline-none"
                  />
                )}
                <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">Close</button>
                  <button onClick={handleCopy} disabled={linksLoading || !links || !shareText}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl">
                    {copied ? 'Copied!' : 'Copy to clipboard'}
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
