import { useState, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { collection, query, orderBy, onSnapshot, doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from "firebase/firestore"
import { signOut } from "firebase/auth"
import { db, auth } from "../firebase"
import { format, differenceInHours } from "date-fns"
import { downloadCandidateProfile } from "../utils/downloadProfile"
import { adminAuditFields } from "../security/auditFields"
import {
  DECISION_OUTCOMES,
  buildDecisionEntry,
  buildDecisionHistory,
  getDecisionReasons,
} from "../selection/decisionReasons"
import {  PLATFORM_NAME } from "../config/organization"

const STAGES = ["invited","applied","scored","to_schedule","scheduled","hired","rejected"]
const STAGE_LABELS = { invited:"Invited", applied:"Applied", scored:"Scored", to_schedule:"To Schedule", scheduled:"Scheduled", hired:"Hired", rejected:"Rejected" }
// Map old stages to new ones for backwards compatibility
const STAGE_MIGRATION = { screening: "applied", interview_2: "applied", scheduling: "to_schedule" }
const ROLE_GROUPS = [
  { key: "bdc-agent", label: "Customer outreach" },
  { key: "sales-rep", label: "Sales" },
]

// SLA: how long a candidate can sit in a stage before it's considered stale.
// These numbers reflect what a recruiter actually cares about — an "Applied"
// candidate still unscored at 48h is falling through the cracks.
const STAGE_SLA_HOURS = { invited: 72, applied: 48, scored: 48, to_schedule: 72, scheduled: 0, hired: 0, rejected: 0 }

function stageOf(c) {
  return STAGE_MIGRATION[c.stage] || c.stage
}

function ageInStageHours(c) {
  const t = c.updatedAt?.toDate?.() || c.createdAt?.toDate?.()
  if (!t) return 0
  return differenceInHours(new Date(), t)
}

export default function AdminDashboard() {
  const [candidates, setCandidates] = useState([])
  const [, setLoading] = useState(true)
  const [userRole, setUserRole] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [refreshConfirm, setRefreshConfirm] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dragOverStage, setDragOverStage] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [filterJob, setFilterJob] = useState("all")
  const [filterSearch, setFilterSearch] = useState("")
  const [filterAging, setFilterAging] = useState(false)
  const [filterFlagged, setFilterFlagged] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState(null) // { action, ids }
  const [rejectConfirm, setRejectConfirm] = useState(null)
  const [rejectDecision, setRejectDecision] = useState({ reasonCode: getDecisionReasons(DECISION_OUTCOMES.REJECTED)[0].code, note: "" })
  const [downloadingId, setDownloadingId] = useState(null)
  const navigate = useNavigate()

  const handleCardDownload = async (e, c) => {
    e.stopPropagation()
    if (downloadingId) return
    setDownloadingId(c.id)
    try {
      const { issues } = await downloadCandidateProfile(c)
      if (issues.length) {
        alert(`Downloaded ${c.firstName} ${c.lastName}'s profile, but some files were missing:\n\n${issues.join('\n')}`)
      }
    } catch (err) {
      alert('Download failed: ' + (err.message || err))
    } finally {
      setDownloadingId(null)
    }
  }

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

  // Filter the candidate list before slotting into columns.
  const filteredCandidates = useMemo(() => {
    const s = filterSearch.trim().toLowerCase()
    return candidates.filter(c => {
      if (filterJob !== "all" && c.jobTitle !== filterJob) return false
      if (filterFlagged && !c.needsReview) return false
      if (filterAging) {
        const sla = STAGE_SLA_HOURS[stageOf(c)] || 0
        if (sla === 0 || ageInStageHours(c) < sla) return false
      }
      if (s) {
        const hay = `${c.firstName || ''} ${c.lastName || ''} ${c.email || ''} ${c.jobTitle || ''}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [candidates, filterJob, filterSearch, filterAging, filterFlagged])

  const availableJobs = useMemo(() => {
    const set = new Set()
    candidates.forEach(c => { if (c.jobTitle) set.add(c.jobTitle) })
    return Array.from(set).sort()
  }, [candidates])

  const resetRejectDecision = () => {
    const firstReason = getDecisionReasons(DECISION_OUTCOMES.REJECTED)[0]
    setRejectDecision({ reasonCode: firstReason.code, note: "" })
  }

  const buildDecisionFields = (candidate, { outcome, stage, reasonCode, note }) => {
    const entry = buildDecisionEntry({
      outcome,
      stage,
      reasonCode,
      note,
      candidate,
      actor: {
        uid: auth.currentUser?.uid || null,
        email: auth.currentUser?.email || null,
      },
    })
    return {
      latestDecision: entry,
      decisionHistory: buildDecisionHistory(candidate?.decisionHistory, entry),
      decisionRecordedAt: serverTimestamp(),
    }
  }

  const openRejectCandidate = (e, c) => {
    e?.stopPropagation?.()
    resetRejectDecision()
    setRejectConfirm(c)
  }

  const rejectCandidate = async () => {
    if (!rejectConfirm) return
    try {
      await updateDoc(doc(db, "candidates", rejectConfirm.id), {
        stage: "rejected",
        ...buildDecisionFields(rejectConfirm, {
          outcome: DECISION_OUTCOMES.REJECTED,
          stage: "rejected",
          reasonCode: rejectDecision.reasonCode,
          note: rejectDecision.note,
        }),
        ...adminAuditFields(),
      })
      setRejectConfirm(null)
    } catch (err) {
      alert(`Reject failed: ${err.message}`)
    }
  }

  const toggleFlag = async (e, c) => {
    e.stopPropagation()
    await updateDoc(doc(db, "candidates", c.id), { needsReview: !c.needsReview, ...adminAuditFields() })
  }

  const deleteCandidate = async () => {
    if (!deleteConfirm) return
    await deleteDoc(doc(db, "candidates", deleteConfirm.id))
    setDeleteConfirm(null)
  }

  const handleDrop = async (e, stage) => {
    e.preventDefault()
    setDragOverStage(null)
    const id = e.dataTransfer.getData("text/plain")
    if (!id) return
    const c = candidates.find(x => x.id === id)
    if (!c || stageOf(c) === stage) return
    if (stage === "rejected") {
      openRejectCandidate(null, c)
      return
    }
    try {
      await updateDoc(doc(db, "candidates", id), {
        stage,
        ...buildDecisionFields(c, {
          outcome: DECISION_OUTCOMES.ADVANCED,
          stage,
          reasonCode: "structured_review_complete",
          note: "",
        }),
        ...adminAuditFields(),
      })
    } catch (err) {
      alert(`Move failed: ${err.message}`)
    }
  }

  const toggleSelect = (e, id) => {
    e.stopPropagation()
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const runBulk = async (action) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    try {
      const batch = writeBatch(db)
      for (const id of ids) {
        const r = doc(db, "candidates", id)
        const c = candidates.find(x => x.id === id)
        if (action === "reject") batch.update(r, {
          stage: "rejected",
          ...buildDecisionFields(c, {
            outcome: DECISION_OUTCOMES.REJECTED,
            stage: "rejected",
            reasonCode: rejectDecision.reasonCode,
            note: rejectDecision.note,
          }),
          ...adminAuditFields(),
        })
        else if (action === "advance") {
          const cur = stageOf(c)
          const idx = STAGES.indexOf(cur)
          const next = idx >= 0 && idx < STAGES.length - 2 ? STAGES[idx + 1] : cur
          if (next === cur) continue
          batch.update(r, {
            stage: next,
            ...buildDecisionFields(c, {
              outcome: DECISION_OUTCOMES.ADVANCED,
              stage: next,
              reasonCode: "structured_review_complete",
              note: "",
            }),
            ...adminAuditFields(),
          })
        } else if (action === "flag") {
          batch.update(r, { needsReview: true, ...adminAuditFields() })
        } else if (action === "unflag") {
          batch.update(r, { needsReview: false, ...adminAuditFields() })
        }
      }
      await batch.commit()
      clearSelection()
    } catch (err) {
      alert(`Bulk action failed: ${err.message}`)
    }
    setBulkConfirm(null)
  }

  const forceRefreshAllUsers = async () => {
    setRefreshing(true)
    try {
      await setDoc(doc(db, "system", "refresh"), { refreshAt: serverTimestamp() }, { merge: true })
      setRefreshConfirm(false)
    } catch (err) {
      alert(`Failed to trigger refresh: ${err.message}`)
      setRefreshing(false)
    }
  }

  const agingCount = useMemo(() => (
    candidates.filter(c => {
      const sla = STAGE_SLA_HOURS[stageOf(c)] || 0
      return sla > 0 && ageInStageHours(c) >= sla
    }).length
  ), [candidates])

  const groupedCandidates = useMemo(() => {
    const groups = ROLE_GROUPS.map(group => ({
      ...group,
      candidates: filteredCandidates.filter(c => c.roleKey === group.key),
    }))
    const matchedIds = new Set(groups.flatMap(group => group.candidates.map(c => c.id)))
    const otherCandidates = filteredCandidates.filter(c => !matchedIds.has(c.id))
    if (otherCandidates.length) groups.push({ key: "other", label: "Other Roles", candidates: otherCandidates })
    return groups
  }, [filteredCandidates])

  const renderKanbanBoard = (roleCandidates, roleScope) => (
    <div className="overflow-x-auto">
      <div className="flex gap-4 min-w-max">
        {STAGES.map(stage => {
          const cols = roleCandidates.filter(c => stageOf(c) === stage)
          const stageScope = `${roleScope}:${stage}`
          const isDragOver = dragOverStage === stageScope
          return (
            <div
              key={stageScope}
              className={`w-64 flex-shrink-0 rounded-xl transition-colors ${isDragOver ? "bg-blue-50 ring-2 ring-blue-400" : ""}`}
              onDragOver={e => { e.preventDefault(); setDragOverStage(stageScope) }}
              onDragLeave={() => setDragOverStage(p => p === stageScope ? null : p)}
              onDrop={e => handleDrop(e, stage)}
            >
              <div className="flex items-center gap-2 mb-3 px-2 pt-2">
                <span className="text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">{STAGE_LABELS[stage]}</span>
                <span className="text-xs text-gray-400">{cols.length}</span>
              </div>
              <div className="space-y-2 min-h-16 px-2 pb-2">
                {cols.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-xl h-16 flex items-center justify-center">
                    <p className="text-xs text-gray-400">{isDragOver ? "Drop here" : "Empty"}</p>
                  </div>
                ) : cols.map(c => {
                  const sla = STAGE_SLA_HOURS[stage] || 0
                  const age = ageInStageHours(c)
                  const isAging = sla > 0 && age >= sla
                  const isSelected = selectedIds.has(c.id)
                  return (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={e => e.dataTransfer.setData("text/plain", c.id)}
                      onClick={() => navigate(`/admin/candidates/${c.id}`)}
                      className={`bg-white border rounded-xl p-3 cursor-pointer hover:border-blue-300 transition-all group ${
                        isSelected ? "border-blue-500 ring-2 ring-blue-200" : isAging ? "border-red-300" : "border-gray-200"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => toggleSelect(e, c.id)}
                          onClick={e => e.stopPropagation()}
                          className="mt-0.5 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm truncate">{c.firstName} {c.lastName}</p>
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{c.jobTitle}</p>
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {c.manualScore?.avg != null && (
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.manualScore.avg >= 4 ? "bg-green-100 text-green-800" : c.manualScore.avg >= 3 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                                {c.manualScore.avg.toFixed(1)}/5
                              </span>
                            )}
                            {isAging && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700" title={`In this stage for ${age}h (SLA ${sla}h)`}>
                                {Math.floor(age / 24) > 0 ? `${Math.floor(age / 24)}d` : `${age}h`}
                              </span>
                            )}
                            {c.needsReview && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700" title="Flagged for second opinion">Flagged</span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => handleCardDownload(e, c)}
                            disabled={downloadingId === c.id}
                            title="Download profile (resume + videos) as ZIP"
                            className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-blue-50 hover:text-blue-600 text-xs disabled:opacity-60 disabled:cursor-wait"
                          >
                            {downloadingId === c.id ? (
                              <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            ) : '↓'}
                          </button>
                          <button onClick={(e) => toggleFlag(e, c)} title={c.needsReview ? "Unflag" : "Flag for review"} className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-amber-50 hover:text-amber-600 text-xs">⚑</button>
                          {stage !== "rejected" && (
                            <button onClick={(e) => openRejectCandidate(e, c)} title="Reject" className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 text-xs">&#x2717;</button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(c) }} title="Delete" className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 text-xs">&#x1D5EB;</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/brand-mark.png" alt="Insight Edge" className="w-7 h-7 object-contain" />
            <span className="font-semibold text-gray-900 text-sm">{PLATFORM_NAME}</span>
          </div>
          <div className="flex items-center gap-3">
            {userRole === "superadmin" && (
              <>
                <button onClick={() => navigate("/admin/jobs")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Jobs</button>
                <button onClick={() => navigate("/admin/questions")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Questions</button>
                <button onClick={() => navigate("/admin/library")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Library</button>
                <button onClick={() => navigate("/admin/availability")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Availability</button>
                <button onClick={() => navigate("/admin/onboarding")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Onboarding</button>
                <button onClick={() => navigate("/admin/users")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Users</button>
                <button onClick={() => navigate("/admin/analytics")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Analytics</button>
                <button onClick={() => navigate("/admin/demo")} className="text-sm text-purple-700 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-50">Demo</button>
              </>
            )}
            <button onClick={() => navigate("/admin/invite")} className="text-sm text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg font-medium">+ Invite candidate</button>
            <button onClick={() => navigate("/")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">View site</button>
            <button
              onClick={() => setRefreshConfirm(true)}
              title="Force every open tab (admins + candidates) to reload"
              className="text-sm text-white bg-red-600 hover:bg-red-700 border border-red-600 px-3 py-1.5 rounded-lg"
            >
              Refresh all users
            </button>
            <button onClick={() => signOut(auth)} className="text-sm text-gray-400 hover:text-gray-600">Sign out</button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-6">
        {/* KPI row */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Total candidates</p>
            <p className="text-2xl font-semibold">{candidates.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Needs scoring</p>
            <p className="text-2xl font-semibold text-amber-600">{candidates.filter(c => stageOf(c) === "applied").length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Scheduled today</p>
            <p className="text-2xl font-semibold text-green-600">{candidates.filter(c => { if (!c.scheduledAt?.toDate) return false; return c.scheduledAt.toDate().toDateString() === new Date().toDateString() }).length}</p>
          </div>
          <button onClick={() => setFilterAging(v => !v)} className={`rounded-xl border p-4 text-left transition-colors ${filterAging ? "bg-red-50 border-red-200" : "bg-white border-gray-200 hover:border-red-200"}`}>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              Falling through cracks
              {filterAging && <span className="text-[10px] font-semibold text-red-700">(filtering)</span>}
            </p>
            <p className={`text-2xl font-semibold ${agingCount > 0 ? "text-red-600" : "text-gray-400"}`}>{agingCount}</p>
          </button>
        </div>

        {/* Filter bar */}
        <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4 flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Search name, email, or role…"
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
            className="flex-1 min-w-[220px] text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select value={filterJob} onChange={e => setFilterJob(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">All roles</option>
            {availableJobs.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
          <label className={`text-xs px-3 py-1.5 rounded-full font-medium cursor-pointer ${filterFlagged ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            <input type="checkbox" className="hidden" checked={filterFlagged} onChange={e => setFilterFlagged(e.target.checked)} />
            Flagged for review
          </label>
          {(filterJob !== "all" || filterSearch || filterAging || filterFlagged) && (
            <button onClick={() => { setFilterJob("all"); setFilterSearch(""); setFilterAging(false); setFilterFlagged(false) }} className="text-xs text-gray-500 hover:text-gray-900">
              Clear filters
            </button>
          )}
        </div>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="bg-blue-600 text-white rounded-xl px-4 py-2.5 mb-4 flex items-center justify-between sticky top-14 z-10 shadow">
            <p className="text-sm font-medium">{selectedIds.size} selected</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setBulkConfirm({ action: "advance" })} className="text-xs font-medium bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg">Advance stage</button>
              <button onClick={() => runBulk("flag")} className="text-xs font-medium bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg">Flag for review</button>
              <button onClick={() => runBulk("unflag")} className="text-xs font-medium bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg">Unflag</button>
              <button onClick={() => { resetRejectDecision(); setBulkConfirm({ action: "reject" }) }} className="text-xs font-medium bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg">Reject all</button>
              <button onClick={clearSelection} className="text-xs font-medium text-white/80 hover:text-white px-2">Clear</button>
            </div>
          </div>
        )}

        {/* Kanban by role group */}
        <div className="space-y-6">
          {groupedCandidates.map(group => (
            <section key={group.key}>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-900">{group.label}</h2>
                <span className="text-xs text-gray-500">{group.candidates.length} candidate{group.candidates.length !== 1 ? "s" : ""}</span>
              </div>
              {renderKanbanBoard(group.candidates, group.key)}
            </section>
          ))}
        </div>

        {/* Upcoming Interviews */}
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

      {/* Bulk confirmation modal */}
      {bulkConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900">
              {bulkConfirm.action === "reject" ? "Reject these candidates?" : "Advance these candidates?"}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              This will affect <span className="font-medium text-gray-700">{selectedIds.size} candidate{selectedIds.size !== 1 ? "s" : ""}</span>.
              {bulkConfirm.action === "reject" && " They'll be moved to Rejected."}
              {bulkConfirm.action === "advance" && " Each will move one stage forward."}
            </p>
            {bulkConfirm.action === "reject" && (
              <DecisionReasonFields
                form={rejectDecision}
                onChange={setRejectDecision}
              />
            )}
            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={() => setBulkConfirm(null)} className="text-sm text-gray-600 font-medium px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={() => runBulk(bulkConfirm.action)} className={`text-white text-sm font-medium px-5 py-2.5 rounded-xl ${bulkConfirm.action === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}`}>
                {bulkConfirm.action === "reject" ? "Reject all" : "Advance all"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject rationale modal */}
      {rejectConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900">Reject candidate?</h3>
            <p className="text-sm text-gray-500 mt-1">
              Record the closest job-related reason before moving <span className="font-medium text-gray-700">{rejectConfirm.firstName} {rejectConfirm.lastName}</span> to Rejected.
            </p>
            <DecisionReasonFields form={rejectDecision} onChange={setRejectDecision} />
            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={() => setRejectConfirm(null)} className="text-sm text-gray-600 font-medium px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={rejectCandidate} disabled={!rejectDecision.reasonCode} className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-xl">
                Reject candidate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Force-refresh Confirmation Modal */}
      {refreshConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900">Refresh all users?</h3>
            <p className="text-sm text-gray-500 mt-1">
              Every open tab — admins <span className="font-medium text-gray-700">and any candidate currently filling out an application</span> — will reload immediately. Use this after a deploy to force everyone onto the latest version.
            </p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={() => setRefreshConfirm(false)} disabled={refreshing} className="text-sm text-gray-600 font-medium px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button onClick={forceRefreshAllUsers} disabled={refreshing} className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-xl">
                {refreshing ? "Refreshing…" : "Refresh everyone"}
              </button>
            </div>
          </div>
        </div>
      )}

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

function DecisionReasonFields({ form, onChange }) {
  const reasons = getDecisionReasons(DECISION_OUTCOMES.REJECTED)
  return (
    <div className="space-y-4 mt-5">
      <label className="block">
        <span className="block text-sm font-medium text-gray-700 mb-1">Decision reason</span>
        <select
          value={form.reasonCode}
          onChange={(e) => onChange({ ...form, reasonCode: e.target.value })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        >
          {reasons.map((reason) => (
            <option key={reason.code} value={reason.code}>{reason.label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-gray-700 mb-1">Evidence note</span>
        <textarea
          value={form.note}
          onChange={(e) => onChange({ ...form, note: e.target.value })}
          rows={3}
          maxLength={600}
          placeholder="Optional: cite job-related evidence from the resume, interview, availability, or current opening."
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
        <span className="text-[11px] text-gray-400">{form.note.length}/600</span>
      </label>
    </div>
  )
}
