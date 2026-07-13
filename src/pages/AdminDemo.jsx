import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import VideoRecorder from '../components/VideoRecorder'
import { DEFAULT_CLIENT_INITIALS, PLATFORM_NAME } from '../config/organization'
import { INDUSTRY_OPTIONS } from '../config/industries'

// Superadmin-only sales demo: walk a prospective client through the exact
// interview experience their candidates would get. Nothing is saved.
export default function AdminDemo() {
  const [rubrics, setRubrics] = useState([])
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [industry, setIndustry] = useState('')
  const [activeRole, setActiveRole] = useState(null) // rubric being previewed
  const navigate = useNavigate()

  useEffect(() => {
    async function load() {
      try {
        const [rubricSnap, qSnap] = await Promise.all([
          getDocs(collection(db, 'roleRubrics')),
          getDocs(query(collection(db, 'interviewQuestions'), where('active', '==', true), orderBy('order', 'asc'))),
        ])
        setRubrics(rubricSnap.docs.map(d => ({ id: d.id, roleKey: d.id, ...d.data() })))
        setQuestions(qSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (err) {
        console.error('Failed to load demo data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const industries = useMemo(() => {
    const distinct = [...new Set(rubrics.map(r => r.industryLabel).filter(Boolean))]
    return [
      ...INDUSTRY_OPTIONS.filter(i => distinct.includes(i)),
      ...distinct.filter(i => !INDUSTRY_OPTIONS.includes(i)).sort(),
    ]
  }, [rubrics])

  useEffect(() => {
    if (!industry && industries.length > 0) setIndustry(industries[0])
  }, [industries, industry])

  const roles = useMemo(() =>
    rubrics
      .filter(r => r.industryLabel === industry)
      .sort((a, b) => String(a.label || a.roleKey).localeCompare(String(b.label || b.roleKey))),
    [rubrics, industry])

  const questionsForRole = (roleKey) =>
    questions
      .filter(q => q.roleKey === roleKey)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))

  if (activeRole) {
    return (
      <DemoInterview
        role={activeRole}
        questions={questionsForRole(activeRole.roleKey)}
        onExit={() => setActiveRole(null)}
      />
    )
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Demo banner */}
      <div className="bg-purple-600 text-white text-center text-xs font-medium py-2 px-4">
        Demo mode — superadmin preview. Nothing here is recorded or saved.
        <button onClick={() => navigate('/admin/dashboard')} className="ml-3 underline hover:no-underline">Exit</button>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-14 flex flex-col items-center">
        <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mb-5">
          <span className="text-white text-lg font-bold">{DEFAULT_CLIENT_INITIALS}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 text-center">{PLATFORM_NAME} Careers</h1>
        <p className="text-sm text-gray-500 mt-2 text-center max-w-md">
          Pick a company type and role to walk through the exact interview a candidate experiences — questions, timers, and video recording included.
        </p>

        <div className="w-full mt-8 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company type</label>
            <select value={industry} onChange={e => setIndustry(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {industries.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : roles.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No roles seeded for this industry yet.</p>
          ) : (
            <div className="space-y-3">
              {roles.map(role => {
                const count = questionsForRole(role.roleKey).length
                return (
                  <div key={role.roleKey} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900">{role.label || role.roleKey}</h3>
                      <p className="text-sm text-gray-500 mt-0.5">{count} question{count === 1 ? '' : 's'} · timed cognitive checks · video + written answers</p>
                    </div>
                    <button
                      onClick={() => setActiveRole(role)}
                      disabled={count === 0}
                      className="shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium px-5 py-2.5 rounded-xl"
                    >
                      Start Interview
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function summarizeQuestionTime(q) {
  if (q?.timerType === 'hard' && q.timerSeconds) return q.timerSeconds
  if (q?.timerType === 'soft' && q.timerSeconds) return q.timerSeconds
  if (q?.type === 'text_response') return 180
  if (q?.type === 'video_reading') return 60
  return 120
}

function formatTimer(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`
}

function DemoInterview({ role, questions, onExit }) {
  const [started, setStarted] = useState(false)
  const [finished, setFinished] = useState(false)
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState({}) // { idx: true } — just progress, nothing kept
  const [textDraft, setTextDraft] = useState('')
  const [hardRemaining, setHardRemaining] = useState(null)
  const [softRemaining, setSoftRemaining] = useState(null)

  const q = questions[current]

  // Reset timers on question change
  useEffect(() => {
    if (!started || finished || !q) return
    setHardRemaining(q.timerType === 'hard' && q.timerSeconds > 0 ? q.timerSeconds : null)
    setSoftRemaining(q.timerType === 'soft' && q.timerSeconds > 0 ? q.timerSeconds : null)
    setTextDraft('')
  }, [current, started, finished, q])

  // Hard countdown with auto-advance — same behavior candidates get
  useEffect(() => {
    if (hardRemaining === null || hardRemaining <= 0) return
    const t = setInterval(() => {
      setHardRemaining(prev => {
        if (prev <= 1) { clearInterval(t); setTimeout(() => advance(), 600); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardRemaining !== null && current])

  useEffect(() => {
    if (softRemaining === null || softRemaining <= 0) return
    const t = setInterval(() => setSoftRemaining(prev => (prev <= 1 ? 0 : prev - 1)), 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [softRemaining !== null && current])

  const advance = () => {
    setAnswers(prev => ({ ...prev, [current]: true }))
    if (current < questions.length - 1) setCurrent(c => c + 1)
    else setFinished(true)
  }

  const totalMinutes = Math.max(5, Math.round(questions.reduce((s, x) => s + summarizeQuestionTime(x), 0) / 60))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-purple-600 text-white text-center text-xs font-medium py-2 px-4">
        Demo mode — nothing is recorded or saved.
        <button onClick={onExit} className="ml-3 underline hover:no-underline">Back to roles</button>
      </div>

      {/* Candidate-style header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">{DEFAULT_CLIENT_INITIALS}</span>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{role.label || role.roleKey}</p>
            <p className="text-xs text-gray-500">
              {started && !finished ? `Interview (${current + 1}/${questions.length})` : 'Candidate interview preview'}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Intro card */}
        {!started && !finished && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Here's what candidates see</h2>
              <p className="text-sm text-gray-500 mt-1">
                {questions.length} questions · about {totalMinutes} minutes total. Timed questions show a live countdown and auto-advance, exactly like the real thing.
              </p>
            </div>
            <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside max-h-48 overflow-y-auto border border-gray-100 rounded-xl p-3 bg-gray-50">
              {questions.map((x, i) => {
                const typeLabel = x.type === 'video_reading' ? 'Script reading' : x.type === 'text_response' ? 'Written' : 'Video'
                const timerLabel = x.timerType === 'hard' ? ` · ${x.timerSeconds}s hard timer` : x.timerType === 'soft' ? ` · ~${x.timerSeconds}s suggested` : ''
                return <li key={x.id || i}><span className="font-medium">{typeLabel}</span>{timerLabel}</li>
              })}
            </ol>
            <button onClick={() => setStarted(true)} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl">
              Start Interview Preview
            </button>
          </div>
        )}

        {/* Progress map */}
        {started && !finished && (
          <div className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500">Interview progress</p>
              <p className="text-xs text-gray-400">{current + 1} / {questions.length}</p>
            </div>
            <div className="flex gap-1">
              {questions.map((_, i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full ${i === current ? 'bg-blue-500' : answers[i] ? 'bg-green-400' : 'bg-gray-200'}`} />
              ))}
            </div>
          </div>
        )}

        {/* Question card */}
        {started && !finished && q && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Question {current + 1} of {questions.length}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {q.type === 'video_reading'
                    ? 'Please read the following script on camera clearly and confidently.'
                    : q.type === 'text_response'
                    ? 'Please type your answer below.'
                    : 'Record a video response — take your time, up to 3 minutes.'}
                </p>
              </div>
              {q.timerType === 'hard' && hardRemaining !== null && (
                <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full font-mono text-sm font-semibold ${
                  hardRemaining <= 10 ? 'bg-red-100 text-red-700 animate-pulse' : hardRemaining <= 20 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {formatTimer(hardRemaining)}
                </div>
              )}
              {q.timerType === 'soft' && softRemaining !== null && (
                <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${softRemaining <= 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-50 text-gray-500'}`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {softRemaining > 0 ? `~${formatTimer(softRemaining)} suggested` : 'Take your time'}
                </div>
              )}
            </div>

            <div className={`border rounded-xl p-4 ${q.type === 'video_reading' ? 'bg-purple-50 border-purple-200' : 'bg-blue-50 border-blue-100'}`}>
              {q.type === 'video_reading' && (
                <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-2">Read this on camera:</p>
              )}
              <p className={`font-medium text-sm leading-relaxed ${q.type === 'video_reading' ? 'text-purple-900 text-base' : 'text-blue-900'}`}>{q.text}</p>
            </div>

            {(q.type === 'video_response' || q.type === 'video_reading') && (
              <VideoRecorder
                key={current}
                candidateId="demo-preview"
                questionIndex={current}
                mode="video"
                demoMode
                onComplete={() => advance()}
              />
            )}

            {q.type === 'text_response' && (
              <div className="space-y-3">
                {hardRemaining === 0 && q.timerType === 'hard' ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 text-center font-medium">
                    Time's up — moving to next question...
                  </div>
                ) : (
                  <>
                    <textarea
                      value={textDraft}
                      onChange={(e) => setTextDraft(e.target.value)}
                      rows={q.category === 'communication' ? 8 : 5}
                      placeholder="Type your answer here..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={advance}
                      disabled={!textDraft.trim()}
                      className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl"
                    >
                      {current < questions.length - 1 ? 'Submit & Next Question' : 'Submit & Finish'}
                    </button>
                  </>
                )}
              </div>
            )}

            <button onClick={advance} className="w-full text-xs text-gray-400 hover:text-gray-600 pt-1">
              Skip this question (demo only)
            </button>
          </div>
        )}

        {/* Finish card with rubric summary — the sales close */}
        {finished && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
            <div className="text-center">
              <div className="text-green-500 text-4xl mb-2">&#10003;</div>
              <h2 className="text-xl font-semibold text-gray-900">That's the candidate experience</h2>
              <p className="text-sm text-gray-500 mt-1">
                Every answer is transcribed and scored by AI against this role's rubric — you only meet candidates who clear the bar.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-700 mb-2">Scored on</p>
                <ul className="space-y-1">
                  {Object.entries(role.scoringWeights || {}).map(([label, weight]) => (
                    <li key={label} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                      <span>{label}</span>
                      <span className="font-medium text-gray-900 shrink-0">{Number(weight) <= 1 ? Math.round(weight * 100) : weight}%</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-700 mb-2">Automatic red flags</p>
                {Array.isArray(role.hardDisqualifiers) && role.hardDisqualifiers.length > 0 ? (
                  <ul className="space-y-1">
                    {role.hardDisqualifiers.map((d, i) => (
                      <li key={i} className="text-xs text-red-700 flex gap-1.5"><span className="shrink-0">•</span><span>{d}</span></li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-gray-400">None configured.</p>}
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setFinished(false); setStarted(false); setCurrent(0); setAnswers({}) }}
                className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-3 rounded-xl">
                Replay this role
              </button>
              <button onClick={onExit} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl">
                Try another role
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
