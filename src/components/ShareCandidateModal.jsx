import { useState, useEffect } from 'react'
import { httpsCallable } from 'firebase/functions'
import { ref, listAll, getDownloadURL } from 'firebase/storage'
import { functions, storage } from '../firebase'

async function resolveVideoUrl(path) {
  const list = await listAll(ref(storage, path))
  const file = list.items.find(f => f.name === 'full_recording.webm')
    || list.items.find(f => /^recording\.(webm|mp4)$/.test(f.name))
    || list.items.find(f => /\.(webm|mp4)$/.test(f.name))
  return file ? getDownloadURL(file) : null
}

// Shares a candidate's profile: email (resume attached, every video answer as
// a watch-card — server-side shareCandidate) or a copy-paste text message.
export default function ShareCandidateModal({ candidate, onClose }) {
  const [mode, setMode] = useState('email') // email | text
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  // Copy-as-text state: links resolved client-side (admin has storage read)
  const [links, setLinks] = useState(null) // { resume, videos: [{num,url}] }
  const [linksLoading, setLinksLoading] = useState(false)
  const [includeResume, setIncludeResume] = useState(true)
  const [videoCount, setVideoCount] = useState('1') // '0' | '1' | '3' | 'all'
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
    const L = []
    L.push(`${candidate.firstName} ${candidate.lastName} — ${candidate.jobTitle || 'candidate'}`)
    if (note.trim()) L.push(note.trim())
    if (includeResume && links.resume) L.push(`Resume: ${links.resume}`)
    const n = videoCount === 'all' ? links.videos.length : Number(videoCount)
    links.videos.slice(0, n).forEach(v => L.push(`Interview Q${v.num}: ${v.url}`))
    return L.join('\n\n')
  })()

  const handleCopy = () => {
    navigator.clipboard.writeText(shareText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const handleSend = async () => {
    if (!validEmail || sending) return
    setSending(true)
    setError(null)
    try {
      const shareCandidate = httpsCallable(functions, 'shareCandidate')
      const { data } = await shareCandidate({
        candidateId: candidate.id,
        toEmail: email.trim(),
        note: note.trim(),
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
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        {result ? (
          <>
            <div className="text-center space-y-2">
              <div className="text-green-500 text-3xl">&#10003;</div>
              <h3 className="text-lg font-semibold text-gray-900">Profile sent</h3>
              <p className="text-sm text-gray-500">
                {candidate.firstName} {candidate.lastName}'s profile went to <span className="font-medium">{email.trim()}</span>
                {' '}with {result.resumeAttached ? 'the resume attached and ' : ''}{result.videos} video answer{result.videos === 1 ? '' : 's'} linked.
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
                  ? 'Sends an email with the resume attached and every interview answer as a one-click watch button. No login needed to view.'
                  : 'Builds a short message with resume and video links you can paste into a text, WhatsApp, or anywhere else. Links open in the browser — no login needed.'}
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
                placeholder="e.g. Strong on the phone scripts — worth a look before Friday."
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {mode === 'email' ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Send to</label>
                  <input
                    type="email"
                    autoFocus
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(null) }}
                    placeholder="hiring.manager@dealership.com"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}
                <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">Cancel</button>
                  <button onClick={handleSend} disabled={!validEmail || sending}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl">
                    {sending ? 'Sending…' : 'Send profile'}
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
                    Building links…
                  </div>
                ) : (
                  <textarea
                    readOnly
                    value={shareText}
                    rows={7}
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
