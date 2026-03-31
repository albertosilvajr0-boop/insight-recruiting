import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { collection, query, orderBy, onSnapshot, doc, getDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { signOut } from "firebase/auth"
import { db, auth } from "../firebase"
import { format } from "date-fns"

const STAGES = ["applied","scored","to_schedule","scheduled","rejected"]
const STAGE_LABELS = { applied:"Applied", scored:"Scored", to_schedule:"To Schedule", scheduled:"Scheduled", rejected:"Rejected" }

export default function AdminDashboard() {
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const q = query(collection(db, "candidates"), orderBy("createdAt", "desc"))
    const unsub = onSnapshot(q, snap => { setCandidates(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false) })
    return unsub
  }, [])

  useEffect(() => {
    if (!auth.currentUser) return
    getDoc(doc(db, "users", auth.currentUser.uid)).then(snap => {
      if (snap.exists()) setUserRole(snap.data().role)
    })
  }, [])

  const rejectCandidate = async (e, c) => {
    e.stopPropagation()
    await updateDoc(doc(db, "candidates", c.id), { stage: "rejected", updatedAt: serverTimestamp() })
  }

  const deleteCandidate = async () => {
    if (!deleteConfirm) return
    await deleteDoc(doc(db, "candidates", deleteConfirm.id))
    setDeleteConfirm(null)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center"><span className="text-white text-xs font-bold">SA</span></div>
            <span className="font-semibold text-gray-900 text-sm">Insight Recruiting</span>
          </div>
          <div className="flex items-center gap-3">
            {(userRole === "admin" || userRole === "hiring_manager") && (
              <>
                <button onClick={() => navigate("/admin/jobs")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Jobs</button>
                <button onClick={() => navigate("/admin/questions")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Questions</button>
                <button onClick={() => navigate("/admin/availability")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Availability</button>
              </>
            )}
            {userRole === "admin" && (
              <button onClick={() => navigate("/admin/users")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Manage users</button>
            )}
            <button onClick={() => navigate("/")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">View site</button>
            <button onClick={() => signOut(auth)} className="text-sm text-gray-400 hover:text-gray-600">Sign out</button>
          </div>
        </div>
      </div>
      <div className="max-w-screen-xl mx-auto px-4 py-6">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 mb-1">Total candidates</p><p className="text-2xl font-semibold">{candidates.length}</p></div>
          <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 mb-1">Needs scoring</p><p className="text-2xl font-semibold text-amber-600">{candidates.filter(c => c.stage === "applied").length}</p></div>
          <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs text-gray-500 mb-1">Scheduled today</p><p className="text-2xl font-semibold text-green-600">{candidates.filter(c => { if (!c.scheduledAt?.toDate) return false; return c.scheduledAt.toDate().toDateString() === new Date().toDateString() }).length}</p></div>
        </div>
        <div className="overflow-x-auto"><div className="flex gap-4 min-w-max">
          {STAGES.map(stage => {
            const cols = candidates.filter(c => c.stage === stage)
            return (
              <div key={stage} className="w-64 flex-shrink-0">
                <div className="flex items-center gap-2 mb-3"><span className="text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">{STAGE_LABELS[stage]}</span><span className="text-xs text-gray-400">{cols.length}</span></div>
                <div className="space-y-2 min-h-16">
                  {cols.length === 0 ? <div className="border-2 border-dashed border-gray-200 rounded-xl h-16 flex items-center justify-center"><p className="text-xs text-gray-400">Empty</p></div>
                  : cols.map(c => (
                    <div key={c.id} onClick={() => navigate(`/admin/candidates/${c.id}`)} className="bg-white border border-gray-200 rounded-xl p-3 cursor-pointer hover:border-blue-300 transition-all group">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{c.firstName} {c.lastName}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{c.jobTitle}</p>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {c.stage !== "rejected" && (
                            <button onClick={(e) => rejectCandidate(e, c)} title="Reject" className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 text-xs">&#x2717;</button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(c) }} title="Delete" className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 text-xs">&#x1D5EB;</button>
                        </div>
                      </div>
                      {c.manualScore?.avg != null && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full mt-1 inline-block ${c.manualScore.avg >= 4 ? "bg-green-100 text-green-800" : c.manualScore.avg >= 3 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{c.manualScore.avg.toFixed(1)}/5</span>}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div></div>

        {/* Upcoming Interviews — visible to all managers */}
        {(() => {
          const scheduled = candidates
            .filter(c => c.stage === "scheduled" && c.scheduledAt?.toDate)
            .sort((a, b) => a.scheduledAt.toDate() - b.scheduledAt.toDate())
          const upcoming = scheduled.filter(c => c.scheduledAt.toDate() >= new Date())
          if (upcoming.length === 0 && scheduled.length === 0) return null
          return (
            <div className="mt-8">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Upcoming In-Person Interviews</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left text-xs font-semibold text-gray-600 px-4 py-3">Candidate</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-4 py-3">Position</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-4 py-3">Date & Time</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-4 py-3">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(upcoming.length > 0 ? upcoming : scheduled).map(c => {
                      const dt = c.scheduledAt.toDate()
                      const isPast = dt < new Date()
                      return (
                        <tr key={c.id} onClick={() => navigate(`/admin/candidates/${c.id}`)}
                          className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer ${isPast ? "opacity-50" : ""}`}>
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-gray-900">{c.firstName} {c.lastName}</p>
                            <p className="text-xs text-gray-500">{c.email}</p>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">{c.jobTitle}</td>
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-gray-900">{format(dt, "EEE, MMM d")}</p>
                            <p className="text-xs text-gray-500">{format(dt, "h:mm a")}</p>
                          </td>
                          <td className="px-4 py-3">
                            {c.manualScore?.avg != null ? (
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.manualScore.avg >= 4 ? "bg-green-100 text-green-800" : c.manualScore.avg >= 3 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                                {c.manualScore.avg.toFixed(1)}/5
                              </span>
                            ) : <span className="text-xs text-gray-400">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900">Delete application?</h3>
            <p className="text-sm text-gray-500 mt-1">
              This will permanently delete <span className="font-medium text-gray-700">{deleteConfirm.firstName} {deleteConfirm.lastName}</span>'s application. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={() => setDeleteConfirm(null)} className="text-sm text-gray-600 font-medium px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={deleteCandidate} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
