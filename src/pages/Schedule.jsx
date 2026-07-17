import { Link } from 'react-router-dom'
import { DEFAULT_CLIENT_NAME, DEFAULT_CONTACT_EMAIL, DEFAULT_JOB_LOCATION } from '../config/organization'

export default function Schedule() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 p-8 text-center space-y-5">
        <img src="/brand-mark.png" alt="Insight Edge" className="w-14 h-14 mx-auto object-contain" />
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Interview next steps</p>
          <h1 className="text-2xl font-bold text-gray-900">The hiring team will reach out directly</h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            Interview scheduling for {DEFAULT_CLIENT_NAME} is handled by the recruiting team.
            If you were invited to the next step, watch your email for details about timing and location.
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-left text-sm text-blue-900 space-y-1">
          <p className="font-semibold">Interview location</p>
          <p>{DEFAULT_JOB_LOCATION}</p>
        </div>

        <div className="space-y-3">
          <a
            href={`mailto:${DEFAULT_CONTACT_EMAIL}`}
            className="block w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 rounded-xl transition-colors"
          >
            Contact recruiting
          </a>
          <Link to="/jobs" className="block text-sm text-gray-500 hover:text-gray-700 underline">
            View open positions
          </Link>
        </div>
      </div>
    </div>
  )
}
