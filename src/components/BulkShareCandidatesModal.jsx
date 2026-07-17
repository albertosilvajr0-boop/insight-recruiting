import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

function formatScore(candidate) {
  if (candidate.manualScore?.avg != null) return `${candidate.manualScore.avg.toFixed(1)}/5`
  if (candidate.compositeScore != null) return `${candidate.compositeScore.toFixed(1)}/10 AI`
  return 'Pending'
}

export default function BulkShareCandidatesModal({ candidates, onClose, onSent }) {
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

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
              </p>
            </div>
            <button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-xl">Done</button>
          </>
        ) : (
          <>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Share candidate shortlist</h3>
              <p className="text-xs text-gray-500 mt-1">
                Send one employer-ready email with the selected candidates, AI scores, evaluator notes, response evidence, and tracked video links.
              </p>
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

            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">Cancel</button>
              <button onClick={handleSend} disabled={!validEmail || sending || candidates.length === 0}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl">
                {sending ? 'Sending...' : `Send ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
