import { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

// Emails a candidate's profile to any address: resume attached, first three
// video answers as watch-cards, the rest as links. Server-side (shareCandidate).
export default function ShareCandidateModal({ candidate, onClose }) {
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

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
                Sends an email with the resume attached, the first three interview answers as
                one-click watch buttons, and links to the rest. No login needed to view.
              </p>
            </div>
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
            {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">Cancel</button>
              <button onClick={handleSend} disabled={!validEmail || sending}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl">
                {sending ? 'Sending…' : 'Send profile'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
