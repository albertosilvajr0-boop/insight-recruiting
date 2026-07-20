import { useState, useEffect, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { collection, query, orderBy, onSnapshot, doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from "firebase/firestore"
import { signOut } from "firebase/auth"
import { db, auth } from "../firebase"
import { differenceInHours } from "date-fns"
import { downloadCandidateProfile } from "../utils/downloadProfile"
import { adminAuditFields } from "../security/auditFields"
import {
  DECISION_OUTCOMES,
  buildDecisionEntry,
  buildDecisionHistory,
  getDecisionReasons,
} from "../selection/decisionReasons"
import { PLATFORM_NAME } from "../config/organization"
import ShareCandidateModal from "../components/ShareCandidateModal"
import BulkShareCandidatesModal from "../components/BulkShareCandidatesModal"

const STAGES = ["invited","applied","scored","to_schedule","scheduled","hired","rejected"]
const ACTIVE_STAGE_FLOW = ["invited","applied","scored","to_schedule","hired"]
const STAGE_LABELS = { invited:"Invited", applied:"Applied", scored:"Scored", to_schedule:"Employer Review", scheduled:"Legacy Scheduled", hired:"Hired", rejected:"Rejected" }
// Map old stages to new ones for backwards compatibility
const STAGE_MIGRATION = { screening: "applied", interview_2: "applied", scheduling: "to_schedule" }

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

function timestampDate(value) {
  if (!value) return null
  if (value.toDate) return value.toDate()
  if (value.seconds) return new Date(value.seconds * 1000)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function hoursSince(value) {
  const date = timestampDate(value)
  return date ? differenceInHours(new Date(), date) : 0
}

function formatAge(hours) {
  if (hours >= 48) return `${Math.floor(hours / 24)}d`
  return `${Math.max(0, hours)}h`
}

function candidateName(c) {
  return `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Candidate"
}

function hasVideoResponses(c) {
  return Object.values(c.videoResponses || {}).some(path => path && !String(path).startsWith("skipped"))
}

function hasSharedWithEmployer(c) {
  return Array.isArray(c.sharedWith) && c.sharedWith.length > 0
}

const WORK_QUEUE_GROUPS = {
  score: {
    title: "Score applicants",
    detail: "Submitted interviews waiting for a 5-point review.",
  },
  reopened: {
    title: "Reopened interviews",
    detail: "Candidates who can redo video responses.",
  },
  unopened: {
    title: "Invite reminders",
    detail: "Invited candidates who have not opened their interview.",
  },
  started: {
    title: "Started but not submitted",
    detail: "Candidates who opened the interview and have not finished.",
  },
  stale: {
    title: "Stale pipeline stages",
    detail: "Candidates sitting past the stage follow-up window.",
  },
  share: {
    title: "Employer follow-up",
    detail: "High-scoring candidates ready to share with employers.",
  },
  flagged: {
    title: "Flagged reviews",
    detail: "Candidates marked for a second look.",
  },
}

function queueTaskKey(candidate, item) {
  if (item.type === "stale") return `stale_${stageOf(candidate)}`
  return item.type
}

function isQueueTaskCleared(candidate, key) {
  return Boolean(candidate.workQueueDone?.[key] || candidate.workQueueDismissed?.[key])
}

function groupWorkQueue(items) {
  const groups = new Map()
  items.forEach(item => {
    const key = item.type
    const meta = WORK_QUEUE_GROUPS[key] || { title: item.title, detail: "Open work queue items." }
    const existing = groups.get(key) || {
      key,
      title: meta.title,
      detail: meta.detail,
      rank: item.rank,
      priority: item.priority,
      items: [],
    }
    existing.rank = Math.min(existing.rank, item.rank)
    existing.priority = existing.priority === "High" || item.priority === "High" ? "High" : item.priority
    existing.items.push(item)
    groups.set(key, existing)
  })
  return Array.from(groups.values())
    .sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
}

function buildWorkQueue(candidates) {
  const items = []
  const add = (candidate, item) => {
    const taskKey = queueTaskKey(candidate, item)
    if (isQueueTaskCleared(candidate, taskKey)) return
    items.push({
      candidate,
      id: `${candidate.id}:${taskKey}`,
      taskKey,
      stage: stageOf(candidate),
      age: ageInStageHours(candidate),
      ...item,
    })
  }

  for (const c of candidates) {
    const stage = stageOf(c)
    const age = ageInStageHours(c)
    const inviteAge = hoursSince(c.invitedAt || c.createdAt)
    const final = ["hired", "rejected"].includes(stage)

    if (stage === "applied" && c.manualScore?.avg == null) {
      add(c, {
        type: "score",
        priority: "High",
        rank: 10,
        title: "Score applicant",
        detail: "Interview is submitted and needs your 5-point AI score.",
        action: "Open profile",
      })
    }

    if (stage === "invited" && c.reopenedAt) {
      add(c, {
        type: "reopened",
        priority: "High",
        rank: 15,
        title: "Reopened interview pending",
        detail: `${candidateName(c)} can redo video answers with the same code. Written answers stay locked.`,
        action: "Open profile",
      })
    }

    if (stage === "invited" && !c.firstSignInAt && inviteAge >= 24) {
      add(c, {
        type: "unopened",
        priority: inviteAge >= 72 ? "High" : "Medium",
        rank: inviteAge >= 72 ? 20 : 35,
        title: "Invite not opened",
        detail: `${formatAge(inviteAge)} since invite. Send a reminder or copy their code.`,
        action: "Open profile",
      })
    }

    if (stage === "invited" && c.firstSignInAt && !c.reopenedAt && inviteAge >= 24) {
      add(c, {
        type: "started",
        priority: "Medium",
        rank: 40,
        title: "Started but not submitted",
        detail: `${candidateName(c)} opened the interview but has not finished yet.`,
        action: "Open profile",
      })
    }

    const sla = STAGE_SLA_HOURS[stage] || 0
    if (sla > 0 && age >= sla) {
      add(c, {
        type: "stale",
        priority: "High",
        rank: 25,
        title: "Stage is stale",
        detail: `${formatAge(age)} in ${STAGE_LABELS[stage] || stage}. Decide the next move.`,
        action: "Open profile",
      })
    }

    if (!final && c.manualScore?.avg >= 4 && !hasSharedWithEmployer(c)) {
      add(c, {
        type: "share",
        priority: "Medium",
        rank: 45,
        title: "High score not shared",
        detail: `${c.manualScore.avg.toFixed(1)}/5 with ${hasVideoResponses(c) ? "video evidence" : "response evidence"} ready for employer review.`,
        action: "Share",
      })
    }

    if (!final && c.needsReview) {
      add(c, {
        type: "flagged",
        priority: "Medium",
        rank: 50,
        title: "Flagged for review",
        detail: "Needs a second look before a decision is recorded.",
        action: "Open profile",
      })
    }
  }

  return items
    .sort((a, b) => a.rank - b.rank || b.age - a.age || candidateName(a.candidate).localeCompare(candidateName(b.candidate)))
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
  const [shareTarget, setShareTarget] = useState(null)
  const [bulkShareOpen, setBulkShareOpen] = useState(false)
  const [expandedQueueGroups, setExpandedQueueGroups] = useState({})
  const [queueUpdating, setQueueUpdating] = useState(null)
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

  const selectedCandidates = useMemo(() => (
    candidates.filter(candidate => selectedIds.has(candidate.id))
  ), [candidates, selectedIds])

  const workQueue = useMemo(() => buildWorkQueue(candidates), [candidates])
  const workQueueGroups = useMemo(() => groupWorkQueue(workQueue), [workQueue])
  const highPriorityQueueCount = workQueue.filter(item => item.priority === "High").length

  const handleQueueAction = (item) => {
    if (item.type === "share") {
      setShareTarget(item.candidate)
      return
    }
    navigate(`/admin/candidates/${item.candidate.id}`)
  }

  const toggleQueueGroup = (key) => {
    setExpandedQueueGroups(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const updateQueueItem = async (e, item, disposition) => {
    e.stopPropagation()
    if (queueUpdating) return
    const field = disposition === "done" ? "workQueueDone" : "workQueueDismissed"
    const payload = {
      [`${field}.${item.taskKey}`]: serverTimestamp(),
      ...adminAuditFields(),
    }
    if (disposition === "done" && item.type === "flagged") payload.needsReview = false
    setQueueUpdating(item.id)
    try {
      await updateDoc(doc(db, "candidates", item.candidate.id), payload)
    } catch (err) {
      alert(`Could not update work queue item: ${err.message}`)
    } finally {
      setQueueUpdating(null)
    }
  }

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
    if (stage === "scheduled") {
      alert("Legacy Scheduled is read-only. Move candidates to Employer Review, Hired, or Rejected instead.")
      return
    }
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
          const idx = ACTIVE_STAGE_FLOW.indexOf(cur)
          const next = idx >= 0 && idx < ACTIVE_STAGE_FLOW.length - 1 ? ACTIVE_STAGE_FLOW[idx + 1] : cur
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
                          <button
                            onClick={(e) => { e.stopPropagation(); setShareTarget(c) }}
                            title="Email an employer-ready candidate packet"
                            className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-blue-50 hover:text-blue-600 text-xs"
                          >&#9993;</button>
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
                <button onClick={() => navigate("/admin/onboarding")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Onboarding</button>
                <button onClick={() => navigate("/admin/employers")} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Employers</button>
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
            <p className="text-xs text-gray-500 mb-1">Shared with employers</p>
            <p className="text-2xl font-semibold text-green-600">{candidates.filter(hasSharedWithEmployer).length}</p>
          </div>
          <button onClick={() => setFilterAging(v => !v)} className={`rounded-xl border p-4 text-left transition-colors ${filterAging ? "bg-red-50 border-red-200" : "bg-white border-gray-200 hover:border-red-200"}`}>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              Falling through cracks
              {filterAging && <span className="text-[10px] font-semibold text-red-700">(filtering)</span>}
            </p>
            <p className={`text-2xl font-semibold ${agingCount > 0 ? "text-red-600" : "text-gray-400"}`}>{agingCount}</p>
          </button>
        </div>

        {/* Pipeline */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Pipeline</h2>
            <span className="text-xs text-gray-500">{filteredCandidates.length} candidate{filteredCandidates.length !== 1 ? "s" : ""}</span>
          </div>

        {/* Work queue */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Today&apos;s work queue</h3>
              <p className="text-xs text-gray-500 mt-0.5">Candidates who need scoring, reminders, review, or employer follow-up.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full">{workQueue.length} open</span>
              {highPriorityQueueCount > 0 && (
                <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">{highPriorityQueueCount} high</span>
              )}
            </div>
          </div>
          {workQueue.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400">No urgent admin work right now.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {workQueueGroups.map(group => {
                const expanded = expandedQueueGroups[group.key] === true
                const highCount = group.items.filter(item => item.priority === "High").length
                return (
                  <div key={group.key}>
                    <button
                      type="button"
                      onClick={() => toggleQueueGroup(group.key)}
                      className="w-full px-4 py-3 flex items-center justify-between gap-4 hover:bg-gray-50 text-left"
                    >
                      <div className="min-w-0 flex-1 flex items-start gap-3">
                        <span className="w-6 h-6 mt-0.5 shrink-0 rounded-full border border-gray-200 text-gray-500 flex items-center justify-center text-sm font-semibold">
                          {expanded ? "-" : "+"}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-900">{group.title}</p>
                            <span className="text-xs font-semibold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                              {group.items.length} item{group.items.length === 1 ? "" : "s"}
                            </span>
                            {highCount > 0 && (
                              <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
                                {highCount} high
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{group.detail}</p>
                        </div>
                      </div>
                    </button>
                    {expanded && (
                      <div className="bg-gray-50/60 border-t border-gray-100 divide-y divide-gray-100">
                        {group.items.map(item => {
                          const updating = queueUpdating === item.id
                          return (
                            <div key={item.id} className="px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white hover:bg-blue-50/40">
                              <div className="min-w-0 flex-1 md:pl-9">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                    item.priority === "High" ? "bg-red-50 text-red-700 border border-red-100" : "bg-amber-50 text-amber-700 border border-amber-100"
                                  }`}>
                                    {item.priority}
                                  </span>
                                  <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                                  <span className="text-xs text-gray-400">{STAGE_LABELS[item.stage] || item.stage}</span>
                                </div>
                                <p className="text-sm text-gray-700 mt-1 truncate">{candidateName(item.candidate)} - {item.candidate.jobTitle || "Open role"}</p>
                                <p className="text-xs text-gray-500 mt-0.5">{item.detail}</p>
                              </div>
                              <div className="w-full md:w-auto shrink-0 flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => updateQueueItem(e, item, "done")}
                                  disabled={updating}
                                  title="Mark done"
                                  aria-label={`Mark ${item.title} done`}
                                  className="w-8 h-8 rounded-lg border border-green-100 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 font-semibold"
                                >
                                  &#10003;
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => updateQueueItem(e, item, "dismissed")}
                                  disabled={updating}
                                  title="Delete from work queue"
                                  aria-label={`Delete ${item.title} from work queue`}
                                  className="w-8 h-8 rounded-lg border border-red-100 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 font-semibold"
                                >
                                  &#10005;
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleQueueAction(item)}
                                  className="ml-1 text-xs font-medium bg-white border border-gray-200 text-gray-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 px-3 py-1.5 rounded-lg"
                                >
                                  {item.action}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>


        {/* Filter bar */}
        <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-2 flex-wrap">
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
          <div className="bg-blue-600 text-white rounded-xl px-4 py-2.5 flex items-center justify-between sticky top-14 z-10 shadow">
            <p className="text-sm font-medium">{selectedIds.size} selected</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setBulkConfirm({ action: "advance" })} className="text-xs font-medium bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg">Advance stage</button>
              <button onClick={() => setBulkShareOpen(true)} className="text-xs font-medium bg-white text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-lg">Share shortlist</button>
              <button onClick={() => runBulk("flag")} className="text-xs font-medium bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg">Flag for review</button>
              <button onClick={() => runBulk("unflag")} className="text-xs font-medium bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg">Unflag</button>
              <button onClick={() => { resetRejectDecision(); setBulkConfirm({ action: "reject" }) }} className="text-xs font-medium bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg">Reject all</button>
              <button onClick={clearSelection} className="text-xs font-medium text-white/80 hover:text-white px-2">Clear</button>
            </div>
          </div>
        )}


          {/* Kanban - one board for everyone; each card shows the role under the name */}
          {renderKanbanBoard(filteredCandidates, "all")}
        </section>

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
      {shareTarget && (
        <ShareCandidateModal candidate={shareTarget} onClose={() => setShareTarget(null)} />
      )}

      {bulkShareOpen && (
        <BulkShareCandidatesModal
          candidates={selectedCandidates}
          onClose={() => setBulkShareOpen(false)}
          onSent={clearSelection}
        />
      )}

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
          placeholder="Optional: cite job-related evidence from the resume, interview, scorecard, or current opening."
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
        <span className="text-[11px] text-gray-400">{form.note.length}/600</span>
      </label>
    </div>
  )
}
