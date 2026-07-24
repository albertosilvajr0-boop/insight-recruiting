import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { DEFAULT_CONTACT_EMAIL, PLATFORM_NAME } from '../config/organization'

const CODE_LENGTH = 6

// Employer-facing landing page. Candidates arriving from an invite text
// ("go to insightedgehq.com and enter your code") still get a code box
// front and center in the hero — zero extra taps versus the old landing.
export default function Home() {
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)

  const handleCodeSubmit = async (e) => {
    e?.preventDefault()
    if (normalized.length !== CODE_LENGTH || checking) return
    setChecking(true)
    setError(null)
    try {
      const getInviteSession = httpsCallable(functions, 'getInviteSession')
      await getInviteSession({ code: normalized })
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
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/brand-mark.png" alt="" className="w-8 h-8 object-contain" />
            <span className="font-semibold text-gray-900">{PLATFORM_NAME}</span>
          </div>
          <nav className="flex items-center gap-5 text-sm">
            <Link to="/jobs" className="text-gray-600 hover:text-gray-900 font-medium">Open positions</Link>
            <a href={`mailto:${DEFAULT_CONTACT_EMAIL}`}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-xl">
              Talk to us
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-blue-50 via-white to-white">
        <div className="max-w-5xl mx-auto px-4 py-14 md:py-20 grid md:grid-cols-5 gap-10 items-center">
          <div className="md:col-span-3 space-y-5">
            <h1 className="text-3xl md:text-5xl font-bold text-gray-900 leading-tight">
              Every candidate, interviewed on camera before you ever meet them.
            </h1>
            <p className="text-gray-600 text-lg leading-relaxed">
              {PLATFORM_NAME} runs structured, role-specific video interviews for every applicant —
              phone scripts read aloud, real objection handling, timed thinking questions — and turns
              them into evidence packets your hiring managers can watch in minutes.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a href={`mailto:${DEFAULT_CONTACT_EMAIL}?subject=Insight%20Edge%20walkthrough`}
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-xl">
                Book a walkthrough
              </a>
              <Link to="/jobs" className="border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium px-6 py-3 rounded-xl">
                See open roles
              </Link>
            </div>
          </div>

          {/* Candidate code card — the old landing flow, preserved in place */}
          <div className="md:col-span-2">
            <form onSubmit={handleCodeSubmit}
              className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-3">
              <p className="text-sm font-semibold text-gray-900">Here for an interview?</p>
              <p className="text-xs text-gray-500">Enter the code from your invitation text or email.</p>
              <input
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                value={normalized}
                onChange={(e) => { setCode(e.target.value); setError(null) }}
                placeholder="ABC123"
                aria-label="Interview code"
                className="w-full text-center text-xl font-mono font-semibold tracking-[0.4em] uppercase border-2 border-gray-300 rounded-xl px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-300 placeholder:tracking-[0.4em]"
              />
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 text-center">{error}</div>
              )}
              <button
                type="submit"
                disabled={normalized.length !== CODE_LENGTH || checking}
                className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white font-medium py-3 rounded-xl transition-colors">
                {checking ? 'Checking…' : 'Start my interview'}
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="max-w-5xl mx-auto px-4 py-12 md:py-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center">Resumes tell you what people claim. Footage shows you who they are.</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-10">
          {[
            ['🎯', 'Role-specific interviews', 'Purpose-built question batteries per role — BDC scripts read on camera, live objection handling, timed reasoning, written communication samples.'],
            ['🎥', 'Watch before you interview', 'Every answer is recorded and retained. Skim the footage in minutes and only spend in-person time on candidates worth meeting.'],
            ['📬', 'Evidence packets, delivered', 'One click sends a hiring manager a secure packet — resume, scores, and playable answers — and you see exactly which videos they watched.'],
            ['⚖️', 'Consistent and fair', 'The same structured process for every applicant, with acknowledgment records, EEO capture, and decision audit trails built in.'],
          ].map(([icon, title, body]) => (
            <div key={title} className="border border-gray-200 rounded-2xl p-5">
              <div className="text-2xl">{icon}</div>
              <h3 className="font-semibold text-gray-900 mt-3">{title}</h3>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-gray-50 border-y border-gray-100">
        <div className="max-w-5xl mx-auto px-4 py-12 md:py-16">
          <h2 className="text-2xl font-bold text-gray-900 text-center">How it works</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-10">
            {[
              ['1', 'Invite by text', 'Candidates get a 6-character code — no accounts, no downloads. They interview from their phone in about 20 minutes.'],
              ['2', 'They interview on camera', 'Structured questions for the exact role: scripts, scenarios, timed thinking, and written answers.'],
              ['3', 'You review the footage', 'Answers arrive organized by question with scores and notes. Candidates can even redo answers after your feedback.'],
              ['4', 'Share with the decision-maker', 'Send a tracked packet by email, LinkedIn, or text. Know what they watched, follow up at the right moment.'],
            ].map(([step, title, body]) => (
              <div key={step} className="space-y-2">
                <div className="w-9 h-9 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center">{step}</div>
                <h3 className="font-semibold text-gray-900">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Flagship offering: the Appointed-Interview Job Fair */}
      <section className="max-w-5xl mx-auto px-4 py-12 md:py-16">
        <div className="text-center max-w-3xl mx-auto">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Flagship offering for dealerships</p>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mt-2">
            The Appointed-Interview Job Fair — three days of candidates worth meeting.
          </h2>
          <p className="text-gray-600 mt-3 leading-relaxed">
            We fill your managers' calendars with pre-screened, camera-interviewed candidates —
            briefed with footage, scores, and the exact questions to ask before every handshake.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-10">
          {[
            ['🎬', 'Screened on camera first', 'Every attendee has already completed the full role-specific video battery — scripts read aloud, objection handling, timed cognitive tests, written samples — before they get a seat.'],
            ['📅', 'Appointment-only calendars', 'No walk-in lines. Confirmed 25-minute appointments with automatic confirmations and 24-hour and 1-hour reminders; no-shows backfill from the pre-screened bench.'],
            ['📋', 'Managers briefed in advance', 'Before each handshake: the candidate\'s profile and photo, playable footage, the scoring report with strengths and concerns, and 3–5 tailored follow-up questions.'],
            ['🤝', 'Hired on the spot', 'Same core questions and anchored scorecards for every interviewer, end-of-day calibration huddles — and your managers extend offers in the room, the same day.'],
          ].map(([icon, title, body]) => (
            <div key={title} className="border border-gray-200 rounded-2xl p-5">
              <div className="text-2xl">{icon}</div>
              <h3 className="font-semibold text-gray-900 mt-3">{title}</h3>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        <div className="border border-gray-200 rounded-2xl p-6 mt-6 grid md:grid-cols-3 gap-6">
          {[
            ['Days 1–3', 'Appointed interviews all three days', 'Back-to-back 25-minute appointments every day — every candidate pre-screened, every manager briefed before the handshake.'],
            ['In the room', 'Your managers hire on the spot', 'When an interviewer sees the right candidate, they extend the offer that day — company standards stated and acknowledged in writing.'],
            ['Afterward', 'We report back', 'You get the event report: appointments booked versus shown, hires made by role, and the feedback gathered from your interviewers and the candidates.'],
          ].map(([day, title, body]) => (
            <div key={day} className="space-y-1.5">
              <div className="inline-block bg-blue-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">{day}</div>
              <h3 className="font-semibold text-gray-900">{title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-8 space-y-3">
          <p className="text-sm text-gray-500 max-w-2xl mx-auto">
            After the event, we deliver the report — appointments shown, hires made, and feedback from
            interviewers and candidates — plus a standing bench of pre-screened runners-up for your
            next opening. Your new hires start development before day one through coached redos and
            pre-boarding.
          </p>
          <a href={`mailto:${DEFAULT_CONTACT_EMAIL}?subject=Job%20Fair%20%E2%80%94%20book%20a%20planning%20call`}
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-8 py-3.5 rounded-xl">
            Book a Job Fair planning call
          </a>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-4 py-14 text-center space-y-4">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Stop interviewing strangers.</h2>
        <p className="text-gray-600 max-w-xl mx-auto">
          Tell us the role you're hiring for and we'll run a screened, on-camera pipeline you can
          review by the end of the week.
        </p>
        <a href={`mailto:${DEFAULT_CONTACT_EMAIL}?subject=Insight%20Edge%20walkthrough`}
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-8 py-3.5 rounded-xl">
          Book a walkthrough
        </a>
        <p className="text-xs text-gray-400">{DEFAULT_CONTACT_EMAIL}</p>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          <span>&copy; {new Date().getFullYear()} {PLATFORM_NAME}</span>
          <div className="flex items-center gap-4">
            <Link to="/jobs" className="hover:text-gray-600">Open positions</Link>
            <Link to="/start" className="hover:text-gray-600">Interview sign-in</Link>
            <Link to="/admin/login" className="hover:text-gray-600">Admin</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
