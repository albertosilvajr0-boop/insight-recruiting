import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

function formatScore(candidate) {
  if (candidate.manualScore?.avg != null) return `${candidate.manualScore.avg.toFixed(1)}/5`
  return 'Pending'
}

function candidateName(candidate) {
  return `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || 'Candidate'
}

function uniqueList(...groups) {
  return [...new Set(groups.flat().filter(Boolean).map(item => String(item).trim()).filter(Boolean))]
}

function truncate(text, max = 650) {
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

function videoResponseCount(candidate) {
  return Object.values(candidate.videoResponses || {})
    .filter(path => path && !String(path).startsWith('skipped'))
    .length
}

function candidateDraftSection(candidate) {
  const lines = [
    `${candidateName(candidate)} - ${candidate.jobTitle || 'Open role'}`,
    `AI score: ${formatScore(candidate)}`,
  ]
  if (candidate.manualScore?.count) lines.push(`Scored responses: ${candidate.manualScore.count}`)
  const videos = videoResponseCount(candidate)
  if (videos) lines.push(`Video responses available: ${videos}`)
  if (candidate.email) lines.push(`Candidate email: ${candidate.email}`)
  if (candidate.phone) lines.push(`Candidate phone: ${candidate.phone}`)

  const strengths = uniqueList(candidate.strengths, candidate.resumeStrengths, candidate.interviewStrengths).slice(0, 4)
  const concerns = uniqueList(candidate.concerns, candidate.resumeConcerns, candidate.interviewConcerns).slice(0, 4)
  if (strengths.length) lines.push('', `Why this candidate is worth reviewing:\n${strengths.map(item => `- ${item}`).join('\n')}`)
  if (concerns.length) lines.push('', `Points to verify:\n${concerns.map(item => `- ${item}`).join('\n')}`)
  if (candidate.interviewAnalysis) lines.push('', `Interview review:\n${truncate(candidate.interviewAnalysis)}`)

  const questions = candidate.questions || {}
  const noteLines = Object.keys(questions)
    .sort((a, b) => Number(a) - Number(b))
    .map(qIndex => {
      const score = candidate.manualAnswerScores?.[qIndex]
      const note = candidate.manualAnswerNotes?.[qIndex]
      if (score == null && !note) return null
      const num = Number(qIndex) + 1
      return [
        `Q${num}: ${questions[qIndex]?.text || `Interview answer ${num}`}`,
        ...(score != null ? [`AI score: ${score}/5`] : []),
        ...(note ? [`Scoring note: ${truncate(note, 500)}`] : []),
      ].join('\n')
    })
    .filter(Boolean)

  if (noteLines.length) lines.push('', `Question scoring notes:\n${noteLines.join('\n\n')}`)
  return lines.join('\n')
}

function buildShortlistDraft(candidates, note) {
  const subject = `Candidate shortlist for review (${candidates.length})`
  const lines = [
    `Subject: ${subject}`,
    '',
    'Hi,',
    '',
    `I pulled together ${candidates.length} screened candidate${candidates.length === 1 ? '' : 's'} with AI scores, response evidence, video availability, and scoring notes so your team can compare candidates quickly.`,
  ]
  if (note.trim()) lines.push('', `Share note: ${note.trim()}`)
  candidates.forEach((candidate, index) => {
    lines.push('', `Candidate ${index + 1}`, candidateDraftSection(candidate))
  })
  lines.push('', "Reply here with questions or candidates you'd like screened next.")
  return lines.join('\n')
}

export default function BulkShareCandidatesModal({ candidates, onClose, onSent }) {
  const [mode, setMode] = useState('email')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const draftText = buildShortlistDraft(candidates, note)
  const isEmailMode = mode === 'email' || mode === 'emailV2'
  const emailVersion = mode === 'emailV2' ? 'v2' : 'v1'

  const emailList = email.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean)
  const validEmail = emailList.length > 0
    && emailList.length <= 10
    && emailList.every(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))

  const handleSend = async () => {
    if (!validEmail || sending || candidates.length === 0) return
    setSending(true)
    setError(null)
    try {
      const shareCandidates = httpsCallable(functions, 'shareCandidates')
      const { data } = await shareCandidates({
        candidateIds: candidates.map(candidate => candidate.id),
        toEmails: emailList,
        note: note.trim(),
        emailVersion,
      })
      setResult(data)
      onSent?.()
    } catch (err) {
      console.error('Bulk share failed:', err)
      setError(err?.message || 'Failed to send shortlist. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const handleCopy = async () => {
    await copyToClipboard(draftText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-2xl p-6 space-y-5" onClick={e => e.stopPropagation()}>
        {result ? (
          <>
            <div className="text-center space-y-2">
              <div className="text-green-500 text-3xl">&#10003;</div>
              <h3 className="text-lg font-semibold text-gray-900">Shortlist sent</h3>
              <p className="text-sm text-gray-500">
                Sent {result.candidates} candidate{result.candidates === 1 ? '' : 's'} to{' '}
                <span className="font-medium">{(result.recipients || emailList).join(', ')}</span>
                {' '}with {result.videos} tracked video link{result.videos === 1 ? '' : 's'} and {result.resumeAttachedCount} resume attachment{result.resumeAttachedCount === 1 ? '' : 's'}.
                {result.emailVersion === 'v2' ? ' V2 summary-first format was used.' : ''}
              </p>
            </div>
            <button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-xl">Done</button>
          </>
        ) : (
          <>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Share candidate shortlist</h3>
              <p className="text-xs text-gray-500 mt-1">
                {mode === 'email'
                  ? 'Send one employer-ready email with the selected candidates, AI scores, scoring notes, response evidence, and tracked video links.'
                  : mode === 'emailV2'
                    ? 'Send a summary-first version with a ranked table, compact candidate cards, and the clearest video response links.'
                  : 'Build a ready-to-send shortlist draft you can paste into Gmail from your own mailbox.'}
              </p>
            </div>

            <div className="flex rounded-xl bg-gray-100 p-1">
              {[['email', 'Send email'], ['emailV2', 'Send email V2'], ['draft', 'Copy email draft']].map(([value, label]) => (
                <button key={value} onClick={() => setMode(value)}
                  className={`flex-1 text-sm font-medium py-2 rounded-lg transition-colors ${mode === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
              {candidates.map(candidate => (
                <div key={candidate.id} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{candidate.firstName} {candidate.lastName}</p>
                    <p className="text-xs text-gray-500 truncate">{candidate.jobTitle || 'Open role'}</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full">
                    {formatScore(candidate)}
                  </span>
                </div>
              ))}
            </div>

            {isEmailMode && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employer emails</label>
                <input
                  type="text"
                  autoFocus
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(null) }}
                  placeholder="owner@dealer.com, gm@dealer.com, hiring.manager@dealer.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Separate multiple employers with commas. Each recipient gets their own tracked email.</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Shortlist note</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                maxLength={1200}
                placeholder="Example: These are the strongest candidates from the current screen. This packet shows the same structured evidence I can produce for every applicant in your pipeline."
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {mode === 'draft' && (
              <textarea
                readOnly
                value={draftText}
                rows={10}
                onFocus={e => e.target.select()}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-xs font-mono text-gray-700 bg-gray-50 resize-none focus:outline-none"
              />
            )}

            {error && isEmailMode && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">Cancel</button>
              {isEmailMode ? (
                <button onClick={handleSend} disabled={!validEmail || sending || candidates.length === 0}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl">
                  {sending ? 'Sending...' : mode === 'emailV2' ? 'Send email V2' : `Send ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`}
                </button>
              ) : (
                <button onClick={handleCopy} disabled={!draftText}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl">
                  {copied ? 'Copied!' : 'Copy draft'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
