import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore'
import { ref, uploadBytesResumable } from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import { db, storage, functions } from '../firebase'

const EMPTY_FORM = { firstName: '', lastName: '', email: '', phone: '', jobId: '' }

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
  const [invites, setInvites] = useState([])
  const [loadingInvites, setLoadingInvites] = useState(true)
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
      await refreshInvites()
    }
    load()
  }, [])

  async function refreshInvites() {
    setLoadingInvites(true)
    try {
      const snap = await getDocs(query(collection(db, 'candidates'), where('stage', '==', 'invited')))
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (b.invitedAt?.seconds || 0) - (a.invitedAt?.seconds || 0))
      setInvites(list)
    } catch (err) {
      console.error('Failed to load invites:', err)
    } finally {
      setLoadingInvites(false)
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
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
      })
      setForm(EMPTY_FORM)
      setResumeFile(null)
      await refreshInvites()
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
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => copy(result.accessCode, 'code')} className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">
                {copied === 'code' ? 'Copied!' : 'Copy code'}
              </button>
              <button onClick={() => copy(result.inviteLink, 'link')} className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium py-2.5 rounded-xl">
                {copied === 'link' ? 'Copied!' : 'Copy interview link'}
              </button>
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

        {/* Pending invites */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">Waiting on {invites.length} invited candidate{invites.length === 1 ? '' : 's'}</h3>
            <button onClick={refreshInvites} className="text-xs text-blue-600 hover:underline">Refresh</button>
          </div>
          {loadingInvites ? (
            <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
          ) : invites.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No open invites. Candidates appear here until they submit their interview.</p>
          ) : (
            invites.map(c => (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.firstName} {c.lastName}</p>
                  <p className="text-xs text-gray-500 truncate">{c.jobTitle || jobTitle(c.jobId)} · {c.email}</p>
                  {c.phone && (
                    <p className="text-xs text-gray-500">
                      <a href={`tel:${c.phone}`} className="hover:text-blue-600">{c.phone}</a>
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {c.inviteEmailSentAt && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Email sent</span>}
                    {c.firstSignInAt
                      ? <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">Signed in</span>
                      : <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Not opened yet</span>}
                    {c.resumeUrl && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Resume on file</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right space-y-1">
                  <p className="font-mono font-semibold text-gray-700 tracking-widest">{c.accessCode}</p>
                  <button onClick={() => copy(c.accessCode, c.id)} className="text-xs text-blue-600 hover:underline">
                    {copied === c.id ? 'Copied!' : 'Copy code'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
