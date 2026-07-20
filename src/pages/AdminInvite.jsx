import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, getDocs, orderBy } from 'firebase/firestore'
import { ref, uploadBytesResumable } from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import { db, storage, functions } from '../firebase'

const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '', jobId: '' }

const STAGE_LABELS = {
  invited: 'Invited',
  applied: 'Applied',
  scored: 'Scored',
  to_schedule: 'Employer Review',
  scheduled: 'Legacy Scheduled',
  hired: 'Hired',
  rejected: 'Rejected',
  screening: 'Applied',
  interview_2: 'Applied',
  scheduling: 'Employer Review',
}

const STAGE_BADGE_COLORS = {
  invited: 'bg-purple-100 text-purple-700',
  applied: 'bg-amber-100 text-amber-700',
  scored: 'bg-blue-100 text-blue-700',
  to_schedule: 'bg-indigo-100 text-indigo-700',
  scheduling: 'bg-indigo-100 text-indigo-700',
  scheduled: 'bg-green-100 text-green-700',
  hired: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
}

function candidateSortTime(candidate) {
  return Math.max(
    candidate.invitedAt?.seconds || 0,
    candidate.createdAt?.seconds || 0,
    candidate.updatedAt?.seconds || 0,
    candidate.lastSignInAt?.seconds || 0,
    candidate.firstSignInAt?.seconds || 0
  )
}

function inferResumeContentType(fileName) {
  const lower = String(fileName || '').toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lower.endsWith('.doc')) return 'application/msword'
  return 'application/octet-stream'
}

export default function AdminInvite() {
  const [jobs, setJobs] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [resumeFile, setResumeFile] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null) // { accessCode, inviteLink, emailSent, email, name }
  const [people, setPeople] = useState([])
  const [peopleSearch, setPeopleSearch] = useState('')
  const [loadingPeople, setLoadingPeople] = useState(true)
  const [copied, setCopied] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    async function load() {
      try {
        const jobSnap = await getDocs(query(collection(db, 'jobs'), orderBy('createdAt', 'desc')))
        setJobs(jobSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (err) {
        console.error('Failed to load jobs:', err)
      }
      await refreshPeople()
    }
    load()
  }, [])

  async function refreshPeople() {
    setLoadingPeople(true)
    try {
      const snap = await getDocs(collection(db, 'candidates'))
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => candidateSortTime(b) - candidateSortTime(a))
      setPeople(list)
    } catch (err) {
      console.error('Failed to load candidates:', err)
    } finally {
      setLoadingPeople(false)
    }
  }

  const handleResumeSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { alert('Resume too large. Maximum 10MB.'); return }
    setResumeFile(file)
  }

  const canSend = form.firstName.trim() && form.lastName.trim()
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)
    && form.phone.trim().length >= 10
    && form.jobId

  const handleSend = async () => {
    if (!canSend || sending) return
    setSending(true)
    setError(null)
    try {
      const createCandidateInvite = httpsCallable(functions, 'createCandidateInvite')
      const { data } = await createCandidateInvite({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        jobId: form.jobId,
      })

      if (resumeFile) {
        try {
          const contentType = resumeFile.type || inferResumeContentType(resumeFile.name)
          const resumePath = `resumes/${data.candidateId}/${resumeFile.name}`
          const uploadTask = uploadBytesResumable(ref(storage, resumePath), resumeFile, { contentType })
          await new Promise((resolve, reject) => uploadTask.on('state_changed', null, reject, resolve))
          const attachInviteResume = httpsCallable(functions, 'attachInviteResume')
          await attachInviteResume({ candidateId: data.candidateId, resumeUrl: resumePath })
        } catch (err) {
          console.error('Resume upload failed:', err)
          alert('The invite was created, but the resume upload failed. You can retry from the candidate page.')
        }
      }

      setResult({
        ...data,
        email: form.email.trim(),
        phone: form.phone.trim(),
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
      })
      setForm(EMPTY_FORM)
      setResumeFile(null)
      await refreshPeople()
    } catch (err) {
      console.error('Invite failed:', err)
      setError(err?.message || 'Failed to create the invite. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const copy = (text, key) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const jobTitle = (jobId) => jobs.find(j => j.id === jobId)?.title || jobId

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate('/admin/dashboard')} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <img src="/brand-mark.png" alt="Insight Edge" className="w-7 h-7 object-contain" />
          <span className="font-semibold text-gray-900 text-sm">Invite candidate</span>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Success panel */}
        {result && (
          <div className="bg-white rounded-2xl border-2 border-green-300 p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-gray-900">Invite created for {result.name}</p>
                <p className="text-sm mt-0.5 text-gray-500">
                  {result.emailSent
                    ? <>Invitation emailed to <span className="font-medium">{result.email}</span>. You can also text them the code below.</>
                    : <span className="text-amber-700">The email could not be sent — text or email them the code below yourself.</span>}
                </p>
              </div>
              <button onClick={() => setResult(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-center">
              <p className="text-xs text-blue-800 mb-1">Interview code</p>
              <p className="text-3xl font-bold font-mono tracking-[0.4em] text-blue-700">{result.accessCode}</p>
            </div>
            <div className={`grid gap-3 ${result.phone ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
              <button onClick={() => copy(result.accessCode, 'code')} className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">
                {copied === 'code' ? 'Copied!' : 'Copy code'}
              </button>
              <button onClick={() => copy(result.inviteLink, 'link')} className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">
                {copied === 'link' ? 'Copied!' : 'Copy interview link'}
              </button>
              {result.phone && (
                <button onClick={() => copy(result.phone, 'invite-phone')} className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">
                  {copied === 'invite-phone' ? 'Copied!' : 'Copy phone'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Invite form */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-900">New invite</h2>
            <p className="text-xs text-gray-500 mt-0.5">The candidate gets a private code that opens their interview directly — no job board, no duplicate steps.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
              <input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
              <input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Job opening</label>
            <select value={form.jobId} onChange={e => setForm(f => ({ ...f, jobId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select a job…</option>
              {jobs.map(j => (
                <option key={j.id} value={j.id}>
                  {j.title}{(j.clientName || j.organizationName) ? ` — ${j.clientName || j.organizationName}` : ''}{j.status !== 'active' ? ` (${j.status})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Resume (recommended)</label>
            <label className={`block border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${resumeFile ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}`}>
              <input type="file" accept=".pdf,.doc,.docx" onChange={handleResumeSelect} className="hidden" />
              {resumeFile ? (
                <p className="text-sm font-medium text-green-700">&#10003; {resumeFile.name} — click to replace</p>
              ) : (
                <p className="text-sm text-gray-500">Attach the resume they sent you (PDF, DOC, DOCX)</p>
              )}
            </label>
          </div>
          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>}
          <button onClick={handleSend} disabled={!canSend || sending}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors">
            {sending ? 'Creating invite…' : 'Create invite & send email'}
          </button>
        </div>

        {/* People list — always the FULL candidate list, searchable */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-700 shrink-0">People ({people.length})</h3>
            <input
              type="text"
              value={peopleSearch}
              onChange={e => setPeopleSearch(e.target.value)}
              placeholder="Search name, email, phone, or role…"
              className="flex-1 max-w-xs border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={refreshPeople} className="text-xs text-blue-600 hover:underline shrink-0">Refresh</button>
          </div>
          {loadingPeople ? (
            <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : people.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No candidates found yet.</p>
          ) : (
            people.filter(c => {
              const s = peopleSearch.trim().toLowerCase()
              if (!s) return true
              return `${c.firstName || ''} ${c.lastName || ''} ${c.email || ''} ${c.phone || ''} ${c.jobTitle || ''}`.toLowerCase().includes(s)
            }).map(c => {
              const stageLabel = STAGE_LABELS[c.stage] || c.stage || 'Unknown'
              const stageBadgeColor = STAGE_BADGE_COLORS[c.stage] || 'bg-gray-100 text-gray-600'
              const candidateJobTitle = c.jobTitle || jobTitle(c.jobId) || 'No job selected'

              return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.firstName} {c.lastName}</p>
                  <p className="text-xs text-gray-500 truncate">{candidateJobTitle} · {c.email || 'No email'}</p>
                  {c.phone && (
                    <p className="text-xs text-gray-500 flex items-center gap-2">
                      <a href={`tel:${c.phone}`} className="hover:text-blue-600">{c.phone}</a>
                      <button
                        type="button"
                        onClick={() => copy(c.phone, `${c.id}:phone`)}
                        className="text-[11px] font-medium text-blue-600 hover:text-blue-700"
                      >
                        {copied === `${c.id}:phone` ? 'Copied!' : 'Copy phone'}
                      </button>
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${stageBadgeColor}`}>{stageLabel}</span>
                    {c.inviteEmailSentAt && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Email sent</span>}
                    {c.accessCode && (c.firstSignInAt
                      ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">Signed in</span>
                      : <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Not opened yet</span>)}
                    {c.resumeUrl && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Resume on file</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right space-y-1">
                  {c.accessCode ? (
                    <>
                      <p className="font-mono font-semibold text-gray-700 tracking-widest">{c.accessCode}</p>
                      <button onClick={() => copy(c.accessCode, c.id)} className="text-xs text-blue-600 hover:underline">
                        {copied === c.id ? 'Copied!' : 'Copy code'}
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-gray-400">No code</span>
                  )}
                  <button onClick={() => navigate(`/admin/candidates/${c.id}`)} className="block text-xs text-gray-500 hover:text-blue-600 hover:underline">
                    Open profile
                  </button>
                </div>
              </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
