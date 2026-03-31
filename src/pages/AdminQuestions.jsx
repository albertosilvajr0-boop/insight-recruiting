import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, where, writeBatch } from "firebase/firestore"
import { db } from "../firebase"

const QUESTION_TYPES = [
  { value: "video_response", label: "Video Response", description: "Candidate records a video answering the question" },
  { value: "video_reading", label: "Video Script Reading", description: "Candidate reads a script on camera (word track)" },
  { value: "text_response", label: "Written Response", description: "Candidate types a written answer" },
]

const ROLE_OPTIONS = [
  { value: "all", label: "All Roles" },
  { value: "bdc-agent", label: "BDC Agent" },
  { value: "sales-rep", label: "Sales Rep" },
  { value: "service-advisor", label: "Service Advisor" },
]

const CATEGORY_OPTIONS = [
  { value: "intro", label: "Introduction" },
  { value: "experience", label: "Experience & Background" },
  { value: "situational", label: "Situational / Behavioral" },
  { value: "word_track", label: "Word Track / Script Reading" },
  { value: "competence", label: "Competence / Problem Solving" },
  { value: "motivation", label: "Motivation & Culture Fit" },
]

export default function AdminQuestions() {
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [filterRole, setFilterRole] = useState("all")
  const [seeding, setSeeding] = useState(false)
  const navigate = useNavigate()

  const [form, setForm] = useState({
    text: "",
    type: "video_response",
    roleKey: "all",
    category: "intro",
    order: 0,
    active: true,
  })

  useEffect(() => {
    const q = query(collection(db, "interviewQuestions"), orderBy("order", "asc"))
    const unsub = onSnapshot(q, (snap) => {
      setQuestions(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [])

  const resetForm = () => {
    setForm({ text: "", type: "video_response", roleKey: "all", category: "intro", order: questions.length, active: true })
    setEditing(null)
  }

  const openCreate = () => {
    resetForm()
    setForm((f) => ({ ...f, order: questions.length }))
    setShowModal(true)
  }

  const openEdit = (q) => {
    setEditing(q)
    setForm({ text: q.text, type: q.type, roleKey: q.roleKey, category: q.category, order: q.order, active: q.active !== false })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.text.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await updateDoc(doc(db, "interviewQuestions", editing.id), {
          ...form,
          text: form.text.trim(),
          updatedAt: serverTimestamp(),
        })
      } else {
        await addDoc(collection(db, "interviewQuestions"), {
          ...form,
          text: form.text.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      }
      setShowModal(false)
      resetForm()
    } catch (err) {
      alert("Failed to save: " + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    await deleteDoc(doc(db, "interviewQuestions", deleteConfirm.id))
    setDeleteConfirm(null)
  }

  const seedDefaultQuestions = async () => {
    if (questions.length > 0 && !window.confirm("This will add default questions. Existing questions will not be removed. Continue?")) return
    setSeeding(true)
    const defaults = [
      // Universal questions
      { text: "Tell me about yourself and why you're interested in this role.", type: "video_response", roleKey: "all", category: "intro", order: 0 },
      { text: "What did you like most and least about your current or previous supervisor?", type: "video_response", roleKey: "all", category: "experience", order: 1 },
      { text: "Why did you leave or why are you looking to leave your current role?", type: "video_response", roleKey: "all", category: "experience", order: 2 },
      { text: "What does great customer service look like to you?", type: "video_response", roleKey: "all", category: "motivation", order: 3 },

      // BDC Agent questions
      { text: "A customer calls frustrated about a follow-up that was missed. Walk me through how you handle that call.", type: "video_response", roleKey: "bdc-agent", category: "situational", order: 10 },
      { text: "How do you stay motivated making high-volume outbound calls?", type: "video_response", roleKey: "bdc-agent", category: "motivation", order: 11 },
      { text: "If you had 50 leads to follow up on and only 3 hours, how would you prioritize them?", type: "text_response", roleKey: "bdc-agent", category: "competence", order: 12 },
      { text: "A customer says they're just browsing and don't want to come in. How do you keep the conversation going without being pushy?", type: "video_response", roleKey: "bdc-agent", category: "situational", order: 13 },

      // Sales Rep questions
      { text: "A customer says the monthly payment is too high. Walk me through your response.", type: "video_response", roleKey: "sales-rep", category: "situational", order: 20 },
      { text: "What does your follow-up process look like after a customer visits but doesn't buy?", type: "video_response", roleKey: "sales-rep", category: "experience", order: 21 },
      { text: "A customer is comparing your price to a competitor's online quote. What do you do?", type: "video_response", roleKey: "sales-rep", category: "situational", order: 22 },
      { text: "You have two customers on the lot at the same time and no other reps available. Walk me through how you handle it.", type: "text_response", roleKey: "sales-rep", category: "competence", order: 23 },

      // Service Advisor questions
      { text: "A customer is upset their car wasn't ready when promised. How do you handle it?", type: "video_response", roleKey: "service-advisor", category: "situational", order: 30 },
      { text: "How do you upsell additional services without feeling pushy?", type: "video_response", roleKey: "service-advisor", category: "situational", order: 31 },
      { text: "A customer gets a repair estimate that's higher than expected. How do you walk them through it?", type: "video_response", roleKey: "service-advisor", category: "situational", order: 32 },
      { text: "A technician tells you a job will take 2 more hours than quoted. The customer is waiting. What do you do?", type: "text_response", roleKey: "service-advisor", category: "competence", order: 33 },

      // Word tracks (all roles)
      { text: "Thank you for calling San Antonio Dodge, how can I assist you in finding a vehicle today?", type: "video_reading", roleKey: "all", category: "word_track", order: 40 },
      { text: "I think I have an idea that may apply to you but I do not want to overpromise and underdeliver, may I put you on hold for one quick second?", type: "video_reading", roleKey: "all", category: "word_track", order: 41 },
      { text: "I have some really really great news to share, to save you time is there a best number and time to connect with a quick phone call?", type: "video_reading", roleKey: "all", category: "word_track", order: 42 },
    ]

    try {
      const batch = writeBatch(db)
      for (const q of defaults) {
        const ref = doc(collection(db, "interviewQuestions"))
        batch.set(ref, { ...q, active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
      }
      await batch.commit()
    } catch (err) {
      alert("Failed to seed questions: " + err.message)
    } finally {
      setSeeding(false)
    }
  }

  const filtered = filterRole === "all"
    ? questions
    : questions.filter((q) => q.roleKey === "all" || q.roleKey === filterRole)

  const typeLabel = (t) => QUESTION_TYPES.find((x) => x.value === t)?.label || t
  const catLabel = (c) => CATEGORY_OPTIONS.find((x) => x.value === c)?.label || c
  const roleLabel = (r) => ROLE_OPTIONS.find((x) => x.value === r)?.label || r

  const typeBadge = (t) => {
    const styles = { video_response: "bg-blue-100 text-blue-700", video_reading: "bg-purple-100 text-purple-700", text_response: "bg-amber-100 text-amber-700" }
    return <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${styles[t] || "bg-gray-100 text-gray-600"}`}>{typeLabel(t)}</span>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/admin/dashboard")} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">SA</span>
            </div>
            <span className="font-semibold text-gray-900 text-sm">Interview Questions</span>
          </div>
          <div className="flex gap-2">
            {questions.length === 0 && (
              <button onClick={seedDefaultQuestions} disabled={seeding} className="text-sm border border-green-200 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-50">
                {seeding ? "Seeding…" : "Load defaults"}
              </button>
            )}
            <button onClick={openCreate} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg font-medium">+ Add question</button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Filter by role:</span>
          {ROLE_OPTIONS.map((r) => (
            <button key={r.value} onClick={() => setFilterRole(r.value)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${filterRole === r.value ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
              {r.label}
            </button>
          ))}
        </div>

        {/* Questions list */}
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No questions yet.</p>
            <button onClick={seedDefaultQuestions} disabled={seeding} className="mt-3 text-blue-600 text-sm hover:underline">
              {seeding ? "Loading…" : "Load default questions"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((q) => (
              <div key={q.id} className={`bg-white rounded-xl border border-gray-200 p-4 ${q.active === false ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm text-gray-900 leading-relaxed">{q.text}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {typeBadge(q.type)}
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{catLabel(q.category)}</span>
                      {q.roleKey !== "all" && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">{roleLabel(q.roleKey)}</span>
                      )}
                      {q.active === false && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600">Inactive</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(q)} className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                    <button onClick={() => setDeleteConfirm(q)} className="text-xs text-red-600 hover:text-red-800 px-2 py-1 rounded hover:bg-red-50">Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {questions.length > 0 && (
          <div className="flex justify-end">
            <button onClick={seedDefaultQuestions} disabled={seeding} className="text-xs text-gray-400 hover:text-gray-600">
              {seeding ? "Adding…" : "Add default questions"}
            </button>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <h2 className="text-lg font-semibold text-gray-900">{editing ? "Edit Question" : "Add Question"}</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Question Text</label>
              <textarea value={form.text} onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" placeholder="Enter the question or script…" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                  {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select value={form.roleKey} onChange={(e) => setForm((f) => ({ ...f, roleKey: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                  {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                <input type="number" value={form.order} onChange={(e) => setForm((f) => ({ ...f, order: Number(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} className="accent-blue-600 w-4 h-4" />
              <span className="text-sm text-gray-700">Active (shown to candidates)</span>
            </label>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={() => { setShowModal(false); resetForm() }} className="text-sm text-gray-600 font-medium px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.text.trim()} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium px-5 py-2.5 rounded-xl">
                {saving ? "Saving…" : editing ? "Save changes" : "Add question"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900">Delete question?</h3>
            <p className="text-sm text-gray-500 mt-1 line-clamp-2">"{deleteConfirm.text}"</p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={() => setDeleteConfirm(null)} className="text-sm text-gray-600 font-medium px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
