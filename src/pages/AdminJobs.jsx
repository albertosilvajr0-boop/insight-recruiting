import { useState, useEffect } from "react"
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, orderBy, query } from "firebase/firestore"
import { db } from "../firebase"
import { useNavigate } from "react-router-dom"

const ROLE_KEYS = [
  { key: "bdc-agent", label: "BDC Agent" },
  { key: "sales-rep", label: "Sales Rep" },
  { key: "service-advisor", label: "Service Advisor" }
]

export default function AdminJobs() {
  const [jobs, setJobs] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ title: "", roleKey: "bdc-agent", description: "", payRange: { min: 35000, max: 80000 }, status: "active" })
  const [saving, setSaving] = useState(false)
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
    const data = { ...form, dealership: "San Antonio Dodge", updatedAt: serverTimestamp() }
    if (editing === "new") {
      const ref = await addDoc(collection(db, "jobs"), { ...data, createdAt: serverTimestamp() })
      setJobs(j => [{ id: ref.id, ...data }, ...j])
    } else {
      await updateDoc(doc(db, "jobs", editing), data)
      setJobs(j => j.map(x => x.id === editing ? { ...x, ...data } : x))
    }
    setEditing(null)
    setSaving(false)
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
                {job.payRange && <p className="text-sm text-gray-500 mt-0.5">${job.payRange.min?.toLocaleString()}–${job.payRange.max?.toLocaleString()}</p>}
                {job.description && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{job.description}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => toggleStatus(job)} className="text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">{job.status === "active" ? "Pause" : "Activate"}</button>
                <button onClick={() => { setEditing(job.id); setForm(job) }} className="text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">Edit</button>
              </div>
            </div>
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
