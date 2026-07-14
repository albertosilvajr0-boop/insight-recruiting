import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import {  PLATFORM_NAME } from '../config/organization'

const CODE_LENGTH = 6

export default function CandidateLogin() {
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)

  const handleSubmit = async (e) => {
    e?.preventDefault()
    if (normalized.length !== CODE_LENGTH || checking) return
    setChecking(true)
    setError(null)
    try {
      const getInviteSession = httpsCallable(functions, 'getInviteSession')
      const { data } = await getInviteSession({ code: normalized })
      if (data.alreadySubmitted) {
        if (data.statusToken) {
          navigate(`/status/${data.statusToken}`)
        } else {
          setError('This interview was already submitted. Reach out to your recruiter if you think this is a mistake.')
        }
        return
      }
      navigate(`/i/${normalized}`)
    } catch (err) {
      setError(err?.code === 'functions/not-found' || err?.message?.includes('not recognized')
        ? 'That code was not recognized. Double-check it and try again.'
        : 'Something went wrong. Please try again in a moment.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-white flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <img src="/brand-mark.png" alt="Insight Edge" className="w-16 h-16 mb-5 object-contain" />
        <h1 className="text-2xl font-bold text-gray-900 text-center">{PLATFORM_NAME} Interviews</h1>
        <p className="text-sm text-gray-500 mt-2 text-center max-w-sm">
          Enter the interview code from your invitation text or email to begin.
        </p>

        <form onSubmit={handleSubmit} className="w-full max-w-sm mt-8 space-y-4">
          <input
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            autoFocus
            value={normalized}
            onChange={(e) => { setCode(e.target.value); setError(null) }}
            placeholder="ABC123"
            aria-label="Interview code"
            className="w-full text-center text-2xl font-mono font-semibold tracking-[0.5em] uppercase border-2 border-gray-300 rounded-2xl px-4 py-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-300 placeholder:tracking-[0.5em]"
          />
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 text-center">{error}</div>
          )}
          <button
            type="submit"
            disabled={normalized.length !== CODE_LENGTH || checking}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3.5 rounded-2xl transition-colors"
          >
            {checking ? 'Checking…' : 'Start my interview'}
          </button>
        </form>

        <div className="mt-10 text-center space-y-2">
          <p className="text-sm text-gray-500">
            Don't have a code?{' '}
            <Link to="/jobs" className="text-blue-600 font-medium hover:underline">Browse open positions</Link>
          </p>
        </div>
      </div>
      <div className="py-6 text-center">
        <Link to="/admin/login" className="text-xs text-gray-300 hover:text-gray-500">Admin</Link>
      </div>
    </div>
  )
}
