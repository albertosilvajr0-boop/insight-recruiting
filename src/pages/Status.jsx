import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { format, formatDistanceToNow } from 'date-fns'
import { DEFAULT_CONTACT_EMAIL, getJobClientName } from '../config/organization'

// Ordered pipeline for the candidate-facing timeline. We deliberately
// collapse internal stages ("scored", "to_schedule") into a single
// "Under review" bucket — the candidate doesn't need our plumbing.
const TIMELINE = [
  { key: 'submitted', label: 'Application submitted', match: () => true },
  { key: 'review', label: 'Under review by the hiring team', match: (c) => ['applied', 'scored', 'screening'].includes(c.stage) },
  { key: 'next_step', label: 'Invited to the next interview step', match: (c) => ['to_schedule', 'scheduled', 'hired'].includes(c.stage) },
  { key: 'scheduled', label: 'Interview confirmed', match: (c) => c.stage === 'scheduled' || c.stage === 'hired' },
  { key: 'hired', label: 'Offer and onboarding in motion', match: (c) => c.stage === 'hired' },
  { key: 'closed', label: 'Decision made', match: (c) => c.stage === 'rejected' },
]

function statusErrorMessage(err) {
  const code = String(err?.code || '').toLowerCase()
  const message = String(err?.message || '').toLowerCase()
  if (code.includes('not-found') || message.includes('not found') || message.includes('invalid')) {
    return 'This status link may be invalid or expired.'
  }
  return 'We could not load this status link right now.'
}

function stageHeadline(c) {
  const scheduledAt = c.scheduledAt ? new Date(c.scheduledAt) : null
  const clientName = getJobClientName(c)
  switch (c.stage) {
    case 'applied':
    case 'scored':
    case 'screening':
      return { title: "We're reviewing your application", body: `The hiring team at ${clientName} is looking over your resume and interview responses. You'll hear back within 1 business day.` }
    case 'to_schedule':
      return { title: "Good news - you're invited to interview!", body: `The recruiting team at ${clientName} will reach out directly with the next interview details.` }
    case 'scheduled':
      return { title: "Your interview is confirmed", body: scheduledAt ? `We'll see you on ${format(scheduledAt, 'EEEE, MMM d')} at ${format(scheduledAt, 'h:mm a')}.` : "Check your confirmation email for the date and time." }
    case 'rejected':
      return { title: "Thanks for applying", body: "After careful review, we're moving forward with other candidates for this role. We appreciate the time you put in and encourage you to apply again in the future." }
    case 'hired':
      return { title: "Welcome aboard!", body: "Congratulations - your offer is in motion. Check your email for onboarding details." }
    default:
      return { title: "Application received", body: "We'll update this page as your application moves forward." }
  }
}

function formatSharedAt(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return format(date, 'MMM d')
}

export default function Status() {
  const { token } = useParams()
  const [candidate, setCandidate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const getCandidateStatus = httpsCallable(functions, 'getCandidateStatus')
        const result = await getCandidateStatus({ token })
        setCandidate(result.data)
      } catch (err) {
        setError(statusErrorMessage(err))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 max-w-md text-center space-y-3">
        <p className="text-gray-900 font-semibold">We could not open your application status</p>
        <p className="text-sm text-gray-500">{error}</p>
        <p className="text-sm text-gray-500">
          Please check the latest link in your email, or contact{' '}
          <a href={`mailto:${DEFAULT_CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{DEFAULT_CONTACT_EMAIL}</a>.
        </p>
        <Link to="/jobs" className="inline-block text-sm text-blue-600 hover:underline">View open positions</Link>
      </div>
    </div>
  )

  const headline = stageHeadline(candidate)
  const appliedAt = candidate.createdAt ? new Date(candidate.createdAt) : null
  const updatedAt = candidate.updatedAt ? new Date(candidate.updatedAt) : null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <img src="/brand-mark.png" alt="Insight Edge" className="w-8 h-8 object-contain" />
          <div>
            <p className="text-sm font-medium text-gray-900">{getJobClientName(candidate)}</p>
            <p className="text-xs text-gray-500">Application status</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Headline card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Current status</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{headline.title}</h1>
          <p className="text-sm text-gray-600 mt-2 leading-relaxed">{headline.body}</p>
          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">Position</p>
              <p className="font-medium text-gray-900">{candidate.jobTitle}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Applied</p>
              <p className="font-medium text-gray-900">{appliedAt ? format(appliedAt, 'MMM d, yyyy') : '—'}</p>
            </div>
          </div>
        </div>

        {candidate.sharedEmployers?.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900">Where your application has been shared</h2>
            <p className="text-xs text-gray-500 mt-1">
              These are employer/company names only. Individual contact details stay private.
            </p>
            <div className="mt-4 space-y-2">
              {candidate.sharedEmployers.map((employer) => {
                const sharedAt = formatSharedAt(employer.sharedAt)
                return (
                  <div key={employer.name} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                    <p className="text-sm font-medium text-gray-900">{employer.name}</p>
                    {sharedAt && <span className="text-xs text-gray-500">Shared {sharedAt}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Your progress</h2>
          <div className="space-y-4">
            {TIMELINE.map((step) => {
              const isDone = step.match(candidate)
              const isRejectedEnd = step.key === 'closed' && candidate.stage === 'rejected'
              return (
                <div key={step.key} className="flex items-start gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                    isRejectedEnd ? 'bg-gray-300' : isDone ? 'bg-green-500' : 'bg-gray-200'
                  }`}>
                    {isDone ? (
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <span className="w-1.5 h-1.5 bg-white rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 pt-0.5">
                    <p className={`text-sm font-medium ${isDone ? 'text-gray-900' : 'text-gray-400'}`}>{step.label}</p>
                    {step.key === 'submitted' && appliedAt && (
                      <p className="text-xs text-gray-500 mt-0.5">{format(appliedAt, 'MMM d, yyyy · h:mm a')}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {updatedAt && (
            <p className="text-xs text-gray-400 mt-4 pt-4 border-t border-gray-100">
              Last updated {formatDistanceToNow(updatedAt, { addSuffix: true })}
            </p>
          )}
        </div>

        {/* Helpful next steps */}
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 text-sm text-blue-900 space-y-1">
          <p className="font-semibold">Tips while you wait</p>
          <ul className="list-disc list-inside text-blue-800 text-xs space-y-1 mt-1">
            <li>Check your email (including spam) — we'll reach out there first.</li>
            <li>Bookmark this page to come back anytime.</li>
            <li>Questions? Email <a href={`mailto:${DEFAULT_CONTACT_EMAIL}`} className="underline">{DEFAULT_CONTACT_EMAIL}</a>.</li>
          </ul>
        </div>

        <div className="text-center">
          <Link to="/jobs" className="text-sm text-gray-500 hover:text-gray-900 underline">View other open positions</Link>
        </div>
      </div>
    </div>
  )
}
