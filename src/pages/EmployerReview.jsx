import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { PLATFORM_NAME } from '../config/organization'

function formatScore(value) {
  const score = Number(value)
  return Number.isFinite(score) ? `${score.toFixed(1)}/10` : 'Pending'
}

function actionLabel(action) {
  const labels = {
    interested: 'Interested',
    not_a_fit: 'Not a fit',
    send_more_like_this: 'Send more like this',
    schedule_interview: 'Schedule interview',
    view_video: 'Viewed video',
  }
  return labels[action] || action
}

function scoreTone(value) {
  const score = Number(value)
  if (!Number.isFinite(score)) return 'bg-gray-100 text-gray-700 border-gray-200'
  if (score >= 8) return 'bg-green-50 text-green-800 border-green-200'
  if (score >= 6) return 'bg-amber-50 text-amber-800 border-amber-200'
  return 'bg-red-50 text-red-800 border-red-200'
}

export default function EmployerReview() {
  const { campaignId, token } = useParams()
  const [review, setReview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [actionState, setActionState] = useState({})

  useEffect(() => {
    let active = true
    async function loadReview() {
      setLoading(true)
      setError('')
      try {
        const getEmployerReview = httpsCallable(functions, 'getEmployerReview')
        const { data } = await getEmployerReview({ campaignId, token })
        if (active) setReview(data)
      } catch (err) {
        if (active) setError(err?.message || 'This review link could not be opened.')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadReview()
    return () => { active = false }
  }, [campaignId, token])

  const employerName = useMemo(() => (
    review?.employerNames?.[0] || 'your hiring team'
  ), [review])

  const recordAction = async ({ candidateId, action, note = '' }) => {
    const key = `${candidateId || 'campaign'}:${action}`
    setActionState(prev => ({ ...prev, [key]: 'sending' }))
    try {
      const recordEmployerReviewAction = httpsCallable(functions, 'recordEmployerReviewAction')
      await recordEmployerReviewAction({
        campaignId,
        token,
        candidateId,
        action,
        note,
        contactEmail: contactEmail.trim(),
      })
      setActionState(prev => ({ ...prev, [key]: 'sent' }))
    } catch (err) {
      setActionState(prev => ({ ...prev, [key]: 'error' }))
      setError(err?.message || 'Could not save that response.')
    }
  }

  const openVideo = (candidate, item) => {
    const link = review?.links?.[item.videoTarget]
    if (link?.url) window.open(link.url, '_blank', 'noopener,noreferrer')
    void recordAction({ candidateId: candidate.candidateId, action: 'view_video', note: item.question })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500 mt-3">Opening shortlist...</p>
        </div>
      </div>
    )
  }

  if (error && !review) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md bg-white border border-gray-200 rounded-2xl p-8 text-center space-y-3">
          <img src="/brand-mark.png" alt="Insight Edge" className="w-12 h-12 mx-auto object-contain" />
          <h1 className="text-xl font-semibold text-gray-900">Review link unavailable</h1>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/brand-mark.png" alt="Insight Edge" className="w-8 h-8 object-contain" />
            <div>
              <p className="text-xs text-gray-500">{PLATFORM_NAME}</p>
              <h1 className="text-lg font-semibold text-gray-900">Candidate shortlist review</h1>
            </div>
          </div>
          <span className="text-xs font-medium text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full">
            {review.candidates?.length || 0} candidate{review.candidates?.length === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        <section className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">For {employerName}</p>
              <h2 className="text-2xl font-semibold text-gray-900 mt-1">Review the candidates and send a quick signal</h2>
              <p className="text-sm text-gray-600 mt-2 max-w-3xl">
                Each profile includes the AI score, scoring notes, written evidence, and video response links when available.
              </p>
              {review.note && (
                <p className="text-sm text-blue-900 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mt-4">{review.note}</p>
              )}
            </div>
            <label className="block md:w-72">
              <span className="block text-xs font-medium text-gray-600 mb-1">Your email (optional)</span>
              <input
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>
          {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
        </section>

        {(review.candidates || []).map((candidate) => (
          <section key={candidate.candidateId || candidate.name} className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">{candidate.name}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {candidate.jobTitle || 'Open role'}{candidate.email ? ` - ${candidate.email}` : ''}{candidate.phone ? ` - ${candidate.phone}` : ''}
                </p>
              </div>
              <div className={`border rounded-xl px-4 py-3 min-w-32 ${scoreTone(candidate.aiScore)}`}>
                <p className="text-[11px] font-bold uppercase">AI score</p>
                <p className="text-2xl font-bold">{formatScore(candidate.aiScore)}</p>
                <p className="text-xs">{candidate.scoredResponses || 0} scored item{candidate.scoredResponses === 1 ? '' : 's'}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EvidenceList title="Why review" items={candidate.strengths} tone="green" />
              <EvidenceList title="Verify in manager review" items={candidate.concerns} tone="amber" />
            </div>

            {(candidate.resumeAnalysis || candidate.interviewAnalysis) && (
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                <p className="text-xs font-semibold text-gray-500 uppercase">Review summary</p>
                {candidate.resumeAnalysis && <p className="text-sm text-gray-700 mt-2"><span className="font-medium text-gray-900">Resume:</span> {candidate.resumeAnalysis}</p>}
                {candidate.interviewAnalysis && <p className="text-sm text-gray-700 mt-2"><span className="font-medium text-gray-900">Interview:</span> {candidate.interviewAnalysis}</p>}
              </div>
            )}

            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-gray-900">Question evidence</h4>
              {(candidate.evidence || []).map((item) => (
                <div key={item.qIndex} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase">
                        Question {item.num} - AI score {item.score == null ? 'Pending' : `${item.score}/10`}
                      </p>
                      <p className="text-sm font-medium text-gray-900 mt-1">{item.question}</p>
                    </div>
                    {item.hasVideo && (
                      <button
                        type="button"
                        onClick={() => openVideo(candidate, item)}
                        className="shrink-0 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 hover:bg-blue-100 px-3 py-2 rounded-lg"
                      >
                        View video
                      </button>
                    )}
                  </div>
                  {item.scoreNote && <p className="text-sm text-amber-900 bg-amber-50 border-l-4 border-amber-300 px-3 py-2 mt-3">{item.scoreNote}</p>}
                  {item.written && <p className="text-sm text-gray-700 mt-3"><span className="font-medium text-gray-900">Written:</span> {item.written}</p>}
                  {!item.written && item.transcript && <p className="text-sm text-gray-700 mt-3"><span className="font-medium text-gray-900">Transcript:</span> {item.transcript}</p>}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2">
              {['interested', 'not_a_fit', 'send_more_like_this', 'schedule_interview'].map((action) => {
                const key = `${candidate.candidateId}:${action}`
                const state = actionState[key]
                return (
                  <button
                    key={action}
                    type="button"
                    onClick={() => recordAction({ candidateId: candidate.candidateId, action })}
                    disabled={state === 'sending'}
                    className="text-xs font-semibold border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-60 px-3 py-2.5 rounded-lg"
                  >
                    {state === 'sent' ? 'Saved' : state === 'sending' ? 'Saving...' : actionLabel(action)}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}

function EvidenceList({ title, items = [], tone }) {
  const color = tone === 'green'
    ? 'border-green-100 bg-green-50 text-green-900'
    : 'border-amber-100 bg-amber-50 text-amber-900'
  return (
    <div className={`border rounded-xl p-4 ${color}`}>
      <p className="text-xs font-semibold uppercase">{title}</p>
      {items.length ? (
        <ul className="mt-2 space-y-1 text-sm list-disc pl-4">
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : (
        <p className="text-sm mt-2">No notes recorded yet.</p>
      )}
    </div>
  )
}
