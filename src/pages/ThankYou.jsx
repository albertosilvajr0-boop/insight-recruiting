import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useState } from 'react'
import { DEFAULT_JOB_LOCATION } from '../config/organization'

export default function ThankYou() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [copied, setCopied] = useState(false)

  const statusUrl = token ? `${window.location.origin}/status/${token}` : null

  const copyLink = async () => {
    if (!statusUrl) return
    try {
      await navigator.clipboard.writeText(statusUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* no-op */ }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 p-10 text-center space-y-5">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Application submitted!</h1>
        <p className="text-gray-500 text-sm">We'll review your application and be in touch within 1 business day.</p>

        {statusUrl && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-left space-y-2">
            <p className="text-xs font-semibold text-blue-900">Track your application</p>
            <p className="text-xs text-blue-800">Bookmark this link — you can check your status anytime.</p>
            <div className="flex items-center gap-2">
              <Link to={`/status/${token}`} className="flex-1 text-xs text-blue-700 underline truncate">{statusUrl}</Link>
              <button onClick={copyLink} className="text-xs font-medium bg-white border border-blue-200 hover:bg-blue-100 text-blue-700 px-2.5 py-1 rounded-md">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <div className="text-left bg-gray-50 rounded-xl p-4 space-y-1 text-xs text-gray-600">
          <p className="font-semibold text-gray-900">What happens next</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Our AI reviews your resume + interview responses (usually within the hour).</li>
            <li>A recruiter confirms the result and, if it's a match, reaches out directly with next steps.</li>
            <li>You meet the team for the next interview step at {DEFAULT_JOB_LOCATION}.</li>
          </ol>
        </div>

        <button onClick={() => navigate('/jobs')} className="text-sm text-gray-500 hover:text-gray-700 underline">View other open positions</button>
      </div>
    </div>
  )
}
