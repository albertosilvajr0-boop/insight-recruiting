import { useState, useEffect } from "react"
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, orderBy, query } from "firebase/firestore"
import { db } from "../firebase"
import { useNavigate } from "react-router-dom"

const ROLE_KEYS = [
  { key: "bdc-agent", label: "BDC Agent or Telemarketer/Emailer/Texter" },
  { key: "sales-rep", label: "Sales Rep" },
  { key: "service-advisor", label: "Service Advisor" }
]

const APP_URL = "https://insight-recruiting-d37dc.web.app"

const JOB_BOARDS = [
  { name: "Indeed", url: "https://employers.indeed.com/jobs", free: true },
  { name: "ZipRecruiter", url: "https://www.ziprecruiter.com/post-a-job", free: false },
  { name: "LinkedIn", url: "https://www.linkedin.com/jobs/post", free: true },
  { name: "Google Jobs", url: null, free: true, auto: true },
  { name: "Craigslist SA", url: "https://sanantonio.craigslist.org/d/jobs/search/jjj", free: true },
  { name: "Facebook", url: "https://www.facebook.com/marketplace/create/job", free: true }
]

function generatePostingText(job) {
  return `${job.title} — San Antonio Dodge

${job.description || ''}

Pay: $${job.payRange?.min?.toLocaleString()} – $${job.payRange?.max?.toLocaleString()}/year
Location: 11910 N IH 35, San Antonio, TX 78233-4200
Type: Full-time

Apply online: ${APP_URL}/apply/${job.id}`
}

export default function AdminJobs() {
  const [jobs, setJobs] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ title: "", roleKey: "bdc-agent", description: "", payRange: { min: 35000, max: 80000 }, status: "active" })
  const [saving, setSaving] = useState(false)
  const [expandedJob, setExpandedJob] = useState(null)
  const [copied, setCopied] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    async function load() {
      const snap = await getDocs(query(collection(db, "jobs"), orderBy("createdAt", "desc")))
      setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }
    load()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const roleLabel = ROLE_KEYS.find(r => r.key === form.roleKey)?.label || form.title
      const data = { ...form, title: form.title || roleLabel, dealership: "San Antonio Dodge", updatedAt: serverTimestamp() }
      if (editing === "new") {
        const ref = await addDoc(collection(db, "jobs"), { ...data, createdAt: serverTimestamp() })
        setJobs(j => [{ id: ref.id, ...data }, ...j])
      } else {
        await updateDoc(doc(db, "jobs", editing), data)
        setJobs(j => j.map(x => x.id === editing ? { ...x, ...data } : x))
      }
      setEditing(null)
    } catch (err) {
      console.error("Failed to save job:", err)
      alert("Failed to save: " + err.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (job) => {
    const newStatus = job.status === "active" ? "paused" : "active"
    await updateDoc(doc(db, "jobs", job.id), { status: newStatus, updatedAt: serverTimestamp() })
    setJobs(j => j.map(x => x.id === job.id ? { ...x, status: newStatus } : x))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/admin/dashboard")} className="text-sm text-gray-500 hover:text-gray-900">Back</button>
            <span className="text-sm font-medium text-gray-900">Job postings</span>
          </div>
          <button onClick={() => { setEditing("new"); setForm({ title: "", roleKey: "bdc-agent", description: "", payRange: { min: 35000, max: 80000 }, status: "active" }) }} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg">+ New job</button>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        {editing && (
          <div className="bg-white rounded-2xl border-2 border-blue-300 p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">{editing === "new" ? "New job posting" : "Edit job posting"}</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Job title</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. BDC Agent" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role type</label>
                <select value={form.roleKey} onChange={e => setForm(f => ({ ...f, roleKey: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {ROLE_KEYS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Role overview..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pay min ($)</label>
                <input type="number" value={form.payRange.min} onChange={e => setForm(f => ({ ...f, payRange: { ...f.payRange, min: +e.target.value } }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pay max ($)</label>
                <input type="number" value={form.payRange.max} onChange={e => setForm(f => ({ ...f, payRange: { ...f.payRange, max: +e.target.value } }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleSave} disabled={saving || !form.title} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2 px-5 rounded-xl text-sm">{saving ? "Saving..." : "Save posting"}</button>
              <button onClick={() => setEditing(null)} className="border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium py-2 px-5 rounded-xl text-sm">Cancel</button>
            </div>
          </div>
        )}
        {jobs.map(job => (
          <div key={job.id} className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-gray-900">{job.title}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${job.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{job.status}</span>
                </div>
                {job.payRange && <p className="text-sm text-gray-500 mt-0.5">${job.payRange.min?.toLocaleString()} – ${job.payRange.max?.toLocaleString()}</p>}
                {job.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{job.description}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)} className="text-xs border border-blue-200 text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg">Distribute</button>
                <button onClick={() => toggleStatus(job)} className="text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">{job.status === "active" ? "Pause" : "Activate"}</button>
                <button onClick={() => { setEditing(job.id); setForm(job) }} className="text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">Edit</button>
              </div>
            </div>
            {expandedJob === job.id && (
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-700">Post to job boards</p>
                  <button
                    onClick={() => { navigator.clipboard.writeText(generatePostingText(job)); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {copied ? "Copied!" : "Copy job description"}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {JOB_BOARDS.map(board => (
                    <div key={board.name} className="border border-gray-200 rounded-lg p-3 text-center">
                      <p className="text-xs font-medium text-gray-900">{board.name}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{board.free ? "Free" : "Paid"}{board.auto ? " (auto)" : ""}</p>
                      {board.auto ? (
                        <span className="inline-block mt-1.5 text-[10px] text-green-600 font-medium">Active via JSON-LD</span>
                      ) : board.url ? (
                        <a href={board.url} target="_blank" rel="noopener noreferrer" className="inline-block mt-1.5 text-[10px] bg-blue-600 text-white px-2.5 py-1 rounded-md hover:bg-blue-700">Post now</a>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[10px] font-medium text-gray-500 mb-1">Direct apply link (include in all postings)</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded flex-1 truncate">{APP_URL}/apply/{job.id}</code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(`${APP_URL}/apply/${job.id}`); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                      className="text-xs text-blue-600 hover:underline shrink-0"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {jobs.length === 0 && !editing && (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No job postings yet.</p>
            <button onClick={() => setEditing("new")} className="mt-3 text-blue-600 text-sm hover:underline">Create your first posting</button>
          </div>
        )}
      </div>
    </div>
  )
}
