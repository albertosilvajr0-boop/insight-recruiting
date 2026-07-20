import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { collection, query, orderBy, onSnapshot, getDocs } from "firebase/firestore"
import { db } from "../firebase"
import { format, formatDistanceToNow, subDays, isAfter, startOfDay } from "date-fns"
import {
  buildOutcomeSegmentRows,
  buildPerformanceRecords,
  buildSignalCorrelationRows,
} from "../analytics/performanceCorrelation"
import { buildSelectionRateRows } from "../compliance/adverseImpact"
import { buildDecisionReasonRows } from "../selection/decisionReasons"
import EmployerEmailTracking from "../components/EmployerEmailTracking"

const STAGE_LABELS = {
  applied: "Applied", scored: "Scored", to_schedule: "Employer Review",
  scheduled: "Legacy Scheduled", rejected: "Rejected", screening: "Applied",
  hired: "Hired", interview_2: "Applied", scheduling: "Employer Review",
}

const MONITORING_MIN_GROUP_SIZE = 5
const LIVE_NOW_WINDOW_MS = 2 * 60 * 1000
const LIVE_REFRESH_MS = 30 * 1000

function toDate(ts) {
  return ts?.toDate ? ts.toDate() : null
}

function isLiveNow(ts, now) {
  const date = toDate(ts)
  return Boolean(date && now.getTime() - date.getTime() <= LIVE_NOW_WINDOW_MS)
}

function candidatePresenceLabel(candidate) {
  const presence = candidate.presence || candidate
  const step = presence.liveCandidateStep || "interview"
  if (step === "interview") {
    const index = Number(presence.liveCandidateQuestionIndex)
    const total = Number(presence.liveCandidateQuestionCount)
    if (Number.isInteger(index) && index >= 0) {
      return `Question ${index + 1}${Number.isInteger(total) && total > 0 ? `/${total}` : ""}`
    }
    return "Interview"
  }
  if (step === "compliance") return "Compliance"
  if (step === "review") return "Reviewing answers"
  if (step === "resume") return "Resume"
  if (step === "info") return "Contact info"
  return "Application"
}

export default function AdminAnalytics() {
  const [users, setUsers] = useState([])
  const [candidates, setCandidates] = useState([])
  const [candidatePresenceRecords, setCandidatePresenceRecords] = useState([])
  const [shareRecords, setShareRecords] = useState([])
  const [shareClicksByShareId, setShareClicksByShareId] = useState({})
  const [complianceRecords, setComplianceRecords] = useState([])
  const [eeoRecords, setEeoRecords] = useState([])
  const [onboardingRecords, setOnboardingRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState("all") // "all" | "admins" | "candidates"
  const [dateRange, setDateRange] = useState("30") // days
  const [now, setNow] = useState(() => new Date())
  const navigate = useNavigate()

  useEffect(() => {
    const unsubUsers = onSnapshot(
      query(collection(db, "users"), orderBy("createdAt", "desc")),
      (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    )
    const unsubCandidates = onSnapshot(
      query(collection(db, "candidates"), orderBy("createdAt", "desc")),
      (snap) => {
        setCandidates(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
      }
    )
    const unsubCandidatePresence = onSnapshot(
      collection(db, "candidatePresence"),
      (snap) => setCandidatePresenceRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setCandidatePresenceRecords([])
    )
    let shareFetchVersion = 0
    let active = true
    const unsubShares = onSnapshot(
      query(collection(db, "shares"), orderBy("createdAt", "desc")),
      (snap) => {
        const nextShares = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        const fetchVersion = ++shareFetchVersion
        setShareRecords(nextShares)
        Promise.all(nextShares.map(async (share) => {
          try {
            const clickSnap = await getDocs(query(collection(db, "shares", share.id, "clicks"), orderBy("at", "asc")))
            return [share.id, clickSnap.docs.map((d) => ({ id: d.id, ...d.data() }))]
          } catch {
            return [share.id, []]
          }
        })).then((entries) => {
          if (active && fetchVersion === shareFetchVersion) setShareClicksByShareId(Object.fromEntries(entries))
        })
      },
      () => {
        setShareRecords([])
        setShareClicksByShareId({})
      }
    )
    const unsubCompliance = onSnapshot(
      query(collection(db, "candidateCompliance"), orderBy("createdAt", "desc")),
      (snap) => setComplianceRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setComplianceRecords([])
    )
    const unsubEeo = onSnapshot(
      query(collection(db, "eeoResponses"), orderBy("createdAt", "desc")),
      (snap) => setEeoRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setEeoRecords([])
    )
    const unsubOnboarding = onSnapshot(
      query(collection(db, "onboardings"), orderBy("createdAt", "desc")),
      (snap) => setOnboardingRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setOnboardingRecords([])
    )
    return () => {
      active = false
      unsubUsers(); unsubCandidates(); unsubCandidatePresence(); unsubShares(); unsubCompliance(); unsubEeo(); unsubOnboarding()
    }
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), LIVE_REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [])

  const cutoff = startOfDay(subDays(new Date(), Number(dateRange)))
  const inRange = (ts) => ts?.toDate && isAfter(ts.toDate(), cutoff)

  // Filtered candidates by date range
  const rangedCandidates = candidates.filter((c) => inRange(c.createdAt))
  const decisionReasonRows = buildDecisionReasonRows(candidates, { startDate: cutoff })
  const complianceByCandidateId = new Map(complianceRecords.map((record) => [record.candidateId, record]))
  const eeoByCandidateId = new Map(eeoRecords.map((record) => [record.candidateId, record]))
  const selectionMonitoringRecords = rangedCandidates
    .map((candidate) => ({
      candidate,
      compliance: {
        ...complianceByCandidateId.get(candidate.candidateId),
        eeoSurvey: eeoByCandidateId.get(candidate.candidateId)?.eeoSurvey,
      },
    }))
    .filter((record) => record.compliance?.eeoSurvey)
  const raceEthnicitySelection = buildSelectionRateRows(selectionMonitoringRecords, "raceEthnicity", {
    minGroupSize: MONITORING_MIN_GROUP_SIZE,
    milestone: "invited",
  })
  const genderSelection = buildSelectionRateRows(selectionMonitoringRecords, "gender", {
    minGroupSize: MONITORING_MIN_GROUP_SIZE,
    milestone: "invited",
  })
  const monitoringVersions = Array.from(new Set(
    selectionMonitoringRecords
      .map((record) => record.compliance.selectionProcessVersion)
      .filter(Boolean)
  ))
  const performanceRecords = buildPerformanceRecords(candidates, onboardingRecords)
  const performanceCorrelationRows = buildSignalCorrelationRows(performanceRecords)
  const performanceByRole = buildOutcomeSegmentRows(performanceRecords, "role")
  const performanceByProcess = buildOutcomeSegmentRows(performanceRecords, "selectionProcessVersion")
  const avgPerformanceOutcome = performanceRecords.length > 0
    ? performanceRecords.reduce((sum, record) => sum + record.outcome.averageRating, 0) / performanceRecords.length
    : null
  const topPerformerCount = performanceRecords.filter((record) => record.outcome.averageRating >= 4).length
  const presenceByCandidateId = new Map(candidatePresenceRecords.map((record) => [record.candidateId || record.id, record]))
  const rangedShares = shareRecords.filter((share) => inRange(share.createdAt))
  // ─── KPI Calculations ─────────────────────────────────────────────
  const totalApplications = rangedCandidates.length
  const totalEmployerReady = rangedCandidates.filter((c) => ["to_schedule", "scheduled", "hired"].includes(c.stage)).length
  const totalSharedWithEmployers = rangedCandidates.filter((c) => Array.isArray(c.sharedWith) && c.sharedWith.length > 0).length
  const totalRejected = rangedCandidates.filter((c) => c.stage === "rejected").length
  const _totalScored = rangedCandidates.filter((c) => c.compositeScore != null).length
  const _avgComposite = _totalScored > 0
    ? (rangedCandidates.reduce((sum, c) => sum + (c.compositeScore || 0), 0) / _totalScored).toFixed(1)
    : "—"
  const conversionRate = totalApplications > 0
    ? ((totalEmployerReady / totalApplications) * 100).toFixed(1)
    : "0"
  const rejectionRate = totalApplications > 0
    ? ((totalRejected / totalApplications) * 100).toFixed(1)
    : "0"

  // Applications by role
  const byRole = rangedCandidates.reduce((acc, c) => {
    const role = c.jobTitle || "Unknown"
    acc[role] = (acc[role] || 0) + 1
    return acc
  }, {})

  // Pipeline stage breakdown
  const byStage = rangedCandidates.reduce((acc, c) => {
    const stage = STAGE_LABELS[c.stage] || c.stage
    acc[stage] = (acc[stage] || 0) + 1
    return acc
  }, {})

  // Funnel — how the pipeline actually converts from top to bottom.
  // Each stage counts candidates who reached AT LEAST that stage (so
  // the Applied count is the entry cohort, Scored is everyone who got
  // past review, etc.). Rejected pulls from any stage.
  const stageReached = (c, stage) => {
    const order = ['applied', 'scored', 'to_schedule']
    const mapped = STAGE_LABELS[c.stage] === STAGE_LABELS[stage] ? c.stage : c.stage
    const current = mapped === 'screening' ? 'applied' : mapped === 'interview_2' ? 'applied' : mapped === 'scheduling' ? 'to_schedule' : mapped
    const curIdx = order.indexOf(current)
    const tgtIdx = order.indexOf(stage)
    if (c.stage === 'rejected') {
      // Rejected candidates still passed any stage up to where they were last
      // — we don't track their peak, so assume they hit at least "applied".
      return stage === 'applied'
    }
    if (c.stage === 'hired') return true
    return curIdx >= tgtIdx
  }
  const funnel = [
    { key: 'applied', label: 'Applied' },
    { key: 'scored', label: 'Reviewed' },
    { key: 'to_schedule', label: 'Employer-ready' },
  ].map(s => ({ ...s, count: rangedCandidates.filter(c => stageReached(c, s.key)).length }))
  const funnelTop = funnel[0]?.count || 0

  // Avg score by role — surfaces roles where the AI is systematically high/low
  const scoreByRole = rangedCandidates.reduce((acc, c) => {
    if (c.compositeScore == null || !c.jobTitle) return acc
    if (!acc[c.jobTitle]) acc[c.jobTitle] = { sum: 0, count: 0 }
    acc[c.jobTitle].sum += c.compositeScore
    acc[c.jobTitle].count += 1
    return acc
  }, {})
  const avgScoreByRole = Object.entries(scoreByRole).map(([role, { sum, count }]) => ({
    role, avg: (sum / count), count
  })).sort((a, b) => b.avg - a.avg)

  // Applications per day (last N days)
  const dailyApps = {}
  const days = Number(dateRange)
  for (let i = 0; i < Math.min(days, 30); i++) {
    const d = format(subDays(new Date(), i), "MMM d")
    dailyApps[d] = 0
  }
  rangedCandidates.forEach((c) => {
    if (c.createdAt?.toDate) {
      const d = format(c.createdAt.toDate(), "MMM d")
      if (d in dailyApps) dailyApps[d]++
    }
  })
  const dailyEntries = Object.entries(dailyApps).reverse()
  const maxDaily = Math.max(...Object.values(dailyApps), 1)

  // Admin login activity
  const activeAdmins = users.filter((u) => inRange(u.lastLoginAt))
  const liveAdmins = users
    .filter((u) => !u.disabled && isLiveNow(u.liveAdminAt, now))
    .sort((a, b) => (toDate(b.liveAdminAt)?.getTime() || 0) - (toDate(a.liveAdminAt)?.getTime() || 0))
  const liveCandidates = candidates
    .map((candidate) => ({ ...candidate, presence: presenceByCandidateId.get(candidate.id) }))
    .filter((c) => isLiveNow(c.presence?.liveCandidateAt, now))
    .sort((a, b) => (toDate(b.presence?.liveCandidateAt)?.getTime() || 0) - (toDate(a.presence?.liveCandidateAt)?.getTime() || 0))
  const adminsSorted = [...users].sort((a, b) => {
    const aLive = isLiveNow(a.liveAdminAt, now) ? 1 : 0
    const bLive = isLiveNow(b.liveAdminAt, now) ? 1 : 0
    if (aLive !== bLive) return bLive - aLive
    const aTime = a.lastLoginAt?.toDate?.() || new Date(0)
    const bTime = b.lastLoginAt?.toDate?.() || new Date(0)
    return bTime - aTime
  })

  // ─── Filter logic ─────────────────────────────────────────────────
  const showAdmins = filterType === "all" || filterType === "admins"
  const showCandidates = filterType === "all" || filterType === "candidates"
  const visibleLiveCount = (showCandidates ? liveCandidates.length : 0) + (showAdmins ? liveAdmins.length : 0)

  const roleBadge = (role) => {
    const styles = { superadmin: "bg-purple-100 text-purple-800", manager: "bg-blue-100 text-blue-800" }
    const labels = { superadmin: "Superadmin", manager: "Manager" }
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[role] || "bg-gray-100 text-gray-700"}`}>{labels[role] || role}</span>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/admin/dashboard")} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <img src="/brand-mark.png" alt="Insight Edge" className="w-7 h-7 object-contain" />
            <span className="font-semibold text-gray-900 text-sm">Analytics</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Filter buttons */}
            {["all", "admins", "candidates"].map((f) => (
              <button key={f} onClick={() => setFilterType(f)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  filterType === f ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}>
                {f === "all" ? "All" : f === "admins" ? "Admins" : "Candidates"}
              </button>
            ))}
            <span className="text-gray-300 mx-1">|</span>
            {/* Date range */}
            <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}
              className="text-xs border border-gray-200 rounded-full px-3 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ─── KPI Cards ─────────────────────────────────────────── */}
            {showCandidates && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <KpiCard label="Total Applications" value={totalApplications} />
                <KpiCard label="Candidates Live Now" value={liveCandidates.length} color="green" />
                <KpiCard label="Employer-ready" value={totalEmployerReady} color="green" />
                <KpiCard label="Shared with Employers" value={totalSharedWithEmployers} color="blue" />
                <KpiCard label="Conversion Rate" value={`${conversionRate}%`} color="purple" />
              </div>
            )}

            {showAdmins && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <KpiCard label="Total Admin Users" value={users.length} />
                <KpiCard label="Admins Live Now" value={liveAdmins.length} color="green" />
                <KpiCard label={`Active (last ${dateRange}d)`} value={activeAdmins.length} color="green" />
                <KpiCard label="Total Logins" value={users.reduce((s, u) => s + (u.loginCount || 0), 0)} color="blue" />
                <KpiCard label="Superadmins" value={users.filter((u) => u.role === "superadmin").length} color="purple" />
              </div>
            )}

            {/* ─── Conversion Funnel ────────────────────────────────── */}
            {(showCandidates || showAdmins) && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-70" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                      </span>
                      <h3 className="text-sm font-semibold text-gray-900">Live now</h3>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Shows candidate and admin pages with activity in the last 2 minutes.</p>
                  </div>
                  <span className="text-xs font-medium text-gray-600 px-2.5 py-1 rounded-full bg-gray-100 w-fit">
                    {visibleLiveCount} live
                  </span>
                </div>

                {visibleLiveCount === 0 ? (
                  <p className="text-xs text-gray-400 py-5 text-center">No live activity right now.</p>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {showCandidates && (
                      <div>
                        <p className="text-xs font-semibold text-gray-600 mb-2">Candidates</p>
                        {liveCandidates.length === 0 ? (
                          <p className="text-xs text-gray-400 border border-gray-100 rounded-lg px-3 py-3">No candidates live.</p>
                        ) : (
                          <div className="space-y-2">
                            {liveCandidates.map((candidate) => (
                              <button
                                key={candidate.id}
                                onClick={() => navigate(`/admin/candidates/${candidate.id}`)}
                                className="w-full text-left border border-green-100 bg-green-50 hover:bg-green-100 rounded-lg px-3 py-2.5 transition-colors"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900">{candidate.firstName} {candidate.lastName}</p>
                                    <p className="text-xs text-gray-600">{candidate.jobTitle || "Candidate"} - {candidatePresenceLabel(candidate)}</p>
                                  </div>
                                  <LivePill />
                                </div>
                                {toDate(candidate.presence?.liveCandidateAt) && (
                                  <p className="text-[11px] text-gray-500 mt-1">
                                    Last heartbeat {formatDistanceToNow(toDate(candidate.presence?.liveCandidateAt), { addSuffix: true })}
                                  </p>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {showAdmins && (
                      <div>
                        <p className="text-xs font-semibold text-gray-600 mb-2">Admins</p>
                        {liveAdmins.length === 0 ? (
                          <p className="text-xs text-gray-400 border border-gray-100 rounded-lg px-3 py-3">No admins live.</p>
                        ) : (
                          <div className="space-y-2">
                            {liveAdmins.map((admin) => (
                              <div key={admin.id} className="border border-blue-100 bg-blue-50 rounded-lg px-3 py-2.5">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900">{admin.displayName || admin.email || "Admin"}</p>
                                    <p className="text-xs text-gray-600">{admin.liveAdminPath || "/admin"}</p>
                                  </div>
                                  <LivePill />
                                </div>
                                {toDate(admin.liveAdminAt) && (
                                  <p className="text-[11px] text-gray-500 mt-1">
                                    Last heartbeat {formatDistanceToNow(toDate(admin.liveAdminAt), { addSuffix: true })}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {showCandidates && (
              <EmployerEmailTracking shares={rangedShares} shareClicksByShareId={shareClicksByShareId} dateRange={dateRange} />
            )}

            {showCandidates && funnelTop > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900">Conversion funnel</h3>
                  <p className="text-xs text-gray-500">Applied to employer-ready</p>
                </div>
                <div className="space-y-2">
                  {funnel.map((s, i) => {
                    const prev = i === 0 ? s.count : funnel[i - 1].count
                    const pctOfTop = funnelTop > 0 ? (s.count / funnelTop) * 100 : 0
                    const pctOfPrev = prev > 0 ? (s.count / prev) * 100 : 0
                    return (
                      <div key={s.key} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 w-32 shrink-0">{s.label}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden relative">
                          <div
                            className={`h-full rounded-full flex items-center justify-end pr-2 text-[11px] font-semibold text-white ${
                              i === 0 ? 'bg-blue-500' : i === 1 ? 'bg-indigo-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${Math.max(pctOfTop, 4)}%` }}
                          >
                            {s.count}
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 w-16 text-right">
                          {i === 0 ? '100%' : `${pctOfPrev.toFixed(0)}%`}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-4">
                  Overall conversion (applied to employer-ready): <span className="font-semibold text-gray-900">{funnel[2]?.count && funnelTop ? ((funnel[2].count / funnelTop) * 100).toFixed(1) : '0'}%</span>
                </p>
              </div>
            )}

            {showCandidates && selectionMonitoringRecords.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-5">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Selection process monitoring</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      Aggregate voluntary EEO data only. Do not use this information for candidate-level decisions.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-gray-500">
                    <span className="px-2 py-1 rounded-full bg-gray-100">{selectionMonitoringRecords.length} monitored applications</span>
                    <span className="px-2 py-1 rounded-full bg-gray-100">Minimum group n={MONITORING_MIN_GROUP_SIZE}</span>
                    {monitoringVersions.length > 0 && (
                      <span className="px-2 py-1 rounded-full bg-gray-100">Process {monitoringVersions.join(", ")}</span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <SelectionMonitoringTable title="Race/ethnicity" result={raceEthnicitySelection} />
                  <SelectionMonitoringTable title="Gender" result={genderSelection} />
                </div>
              </div>
            )}

            {showCandidates && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-5">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Decision rationale mix</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      Latest recorded decision reasons in this date range. Use this to spot process drift and review patterns before changing criteria.
                    </p>
                  </div>
                  <span className="text-[11px] text-gray-500 px-2 py-1 rounded-full bg-gray-100 h-fit">
                    {decisionReasonRows.reduce((sum, row) => sum + row.count, 0)} recorded decisions
                  </span>
                </div>
                <DecisionReasonTable rows={decisionReasonRows} />
              </div>
            )}

            {showCandidates && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-5">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Selection-to-performance correlation</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      Based on completed 30/60/90 onboarding checkpoint ratings. Directional only; validate before changing the process.
                    </p>
                  </div>
                  <button onClick={() => navigate("/admin/onboarding")} className="text-xs font-medium text-blue-700 border border-blue-100 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg">
                    Open onboarding
                  </button>
                </div>

                {performanceRecords.length === 0 ? (
                  <p className="text-xs text-gray-400 py-8 text-center">
                    No completed performance checkpoints yet. Ratings from onboarding will appear here once 30/60/90 reviews are completed.
                  </p>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Metric label="Rated hires" value={performanceRecords.length} />
                      <Metric label="Avg outcome" value={`${avgPerformanceOutcome.toFixed(1)}/5`} />
                      <Metric label="Top performers" value={topPerformerCount} />
                      <Metric label="Top performer rate" value={`${((topPerformerCount / performanceRecords.length) * 100).toFixed(0)}%`} />
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-3">Signal correlation with performance</h4>
                      <CorrelationTable rows={performanceCorrelationRows} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <OutcomeSegmentTable title="Outcome by role" rows={performanceByRole} />
                      <OutcomeSegmentTable title="Outcome by selection process" rows={performanceByProcess} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─── Avg Score by Role ────────────────────────────────── */}
            {showCandidates && avgScoreByRole.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">AI score by role</h3>
                <div className="space-y-2">
                  {avgScoreByRole.map(({ role, avg, count }) => (
                    <div key={role} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-40 shrink-0 truncate">{role}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div className={`h-full rounded-full ${avg >= 8 ? 'bg-green-500' : avg >= 5 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${(avg / 10) * 100}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-gray-700 w-10 text-right">{avg.toFixed(1)}</span>
                      <span className="text-[10px] text-gray-400 w-10 text-right">n={count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ─── Application Trend ────────────────────────────────── */}
            {showCandidates && dailyEntries.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Applications Over Time</h3>
                <div className="flex items-end gap-1 h-32">
                  {dailyEntries.map(([day, count]) => (
                    <div key={day} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[10px] text-gray-500">{count > 0 ? count : ""}</span>
                      <div
                        className="w-full bg-blue-500 rounded-t transition-all"
                        style={{ height: `${Math.max((count / maxDaily) * 100, count > 0 ? 8 : 2)}%`, minHeight: count > 0 ? 8 : 2 }}
                      />
                      <span className="text-[9px] text-gray-400 -rotate-45 origin-top-left whitespace-nowrap mt-1">
                        {dailyEntries.length <= 14 ? day : ""}
                      </span>
                    </div>
                  ))}
                </div>
                {dailyEntries.length > 14 && (
                  <div className="flex justify-between mt-2">
                    <span className="text-[10px] text-gray-400">{dailyEntries[0]?.[0]}</span>
                    <span className="text-[10px] text-gray-400">{dailyEntries[dailyEntries.length - 1]?.[0]}</span>
                  </div>
                )}
              </div>
            )}

            {/* ─── Pipeline & Role Breakdown ─────────────────────────── */}
            {showCandidates && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Pipeline stages */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Pipeline Breakdown</h3>
                  <div className="space-y-2">
                    {Object.entries(byStage).sort((a, b) => b[1] - a[1]).map(([stage, count]) => (
                      <div key={stage} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 w-24 shrink-0">{stage}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(count / totalApplications) * 100}%` }} />
                        </div>
                        <span className="text-xs font-medium text-gray-700 w-8 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-500">
                    <span>Rejection rate: {rejectionRate}%</span>
                    <span>Conversion: {conversionRate}%</span>
                  </div>
                </div>

                {/* By role */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Applications by Role</h3>
                  <div className="space-y-2">
                    {Object.entries(byRole).sort((a, b) => b[1] - a[1]).map(([role, count]) => (
                      <div key={role} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 w-40 shrink-0 truncate">{role}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div className="h-full bg-purple-500 rounded-full" style={{ width: `${(count / totalApplications) * 100}%` }} />
                        </div>
                        <span className="text-xs font-medium text-gray-700 w-8 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                  {Object.keys(byRole).length === 0 && (
                    <p className="text-xs text-gray-400 text-center py-4">No applications in this period</p>
                  )}
                </div>
              </div>
            )}

            {/* ─── Admin Login Activity ───────────────────────────────── */}
            {showAdmins && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Admin Login Activity</h3>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">User</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Role</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Last Login</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Total Logins</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminsSorted.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-8 text-sm text-gray-400">No admin users found</td></tr>
                    ) : (
                      adminsSorted.map((u) => {
                        const lastLogin = u.lastLoginAt?.toDate?.()
                        const isRecent = lastLogin && isAfter(lastLogin, subDays(new Date(), 7))
                        const live = isLiveNow(u.liveAdminAt, now)
                        return (
                          <tr key={u.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                            <td className="px-5 py-3">
                              <p className="text-sm font-medium text-gray-900">{u.displayName || "—"}</p>
                              <p className="text-xs text-gray-500">{u.email}</p>
                            </td>
                            <td className="px-5 py-3">{roleBadge(u.role)}</td>
                            <td className="px-5 py-3">
                              {lastLogin ? (
                                <div>
                                  <p className="text-sm text-gray-900">{format(lastLogin, "MMM d, yyyy")}</p>
                                  <p className="text-xs text-gray-500">{format(lastLogin, "h:mm a")}</p>
                                </div>
                              ) : (
                                <span className="text-xs text-gray-400">Never</span>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <span className="text-sm font-medium text-gray-700">{u.loginCount || 0}</span>
                            </td>
                            <td className="px-5 py-3">
                              {u.disabled ? (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">Disabled</span>
                              ) : live ? (
                                <LivePill />
                              ) : isRecent ? (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">Active</span>
                              ) : (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Inactive</span>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* ─── Recent Candidates Table ───────────────────────────── */}
            {showCandidates && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-gray-900">Applications</h3>
                  <span className="text-xs text-gray-400">
                    {rangedCandidates.length} application{rangedCandidates.length === 1 ? "" : "s"}
                  </span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Candidate</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Position</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Stage</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Score</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Applied</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Last Sign-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rangedCandidates.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8 text-sm text-gray-400">No applications in this period</td></tr>
                    ) : (
                      rangedCandidates.map((c) => {
                        const stageBadgeColor = {
                          scheduled: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-700",
                          scored: "bg-blue-100 text-blue-700", applied: "bg-amber-100 text-amber-700",
                        }
                        const stage = STAGE_LABELS[c.stage] || c.stage
                        const presence = presenceByCandidateId.get(c.id)
                        const live = isLiveNow(presence?.liveCandidateAt, now)
                        const candidateWithPresence = { ...c, presence }
                        return (
                          <tr key={c.id} onClick={() => navigate(`/admin/candidates/${c.id}`)}
                            className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-gray-900">{c.firstName} {c.lastName}</p>
                                {live && <LivePill />}
                              </div>
                              <p className="text-xs text-gray-500">{c.email}</p>
                              {live && (
                                <p className="text-[11px] text-green-700 mt-0.5">{candidatePresenceLabel(candidateWithPresence)}</p>
                              )}
                            </td>
                            <td className="px-5 py-3 text-sm text-gray-700">{c.jobTitle || "—"}</td>
                            <td className="px-5 py-3">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                stageBadgeColor[c.stage] || "bg-gray-100 text-gray-600"
                              }`}>{stage}</span>
                            </td>
                            <td className="px-5 py-3">
                              {c.compositeScore != null ? (
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                  c.compositeScore >= 8 ? "bg-green-100 text-green-800" : c.compositeScore >= 5 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"
                                }`}>{c.compositeScore.toFixed(1)}/10</span>
                              ) : <span className="text-xs text-gray-400">—</span>}
                            </td>
                            <td className="px-5 py-3 text-xs text-gray-500">
                              {c.createdAt?.toDate ? format(c.createdAt.toDate(), "MMM d, h:mm a") : "—"}
                            </td>
                            <td className="px-5 py-3 text-xs">
                              {(c.lastSignInAt || c.firstSignInAt)?.toDate ? (
                                <span className="text-gray-500">{format((c.lastSignInAt || c.firstSignInAt).toDate(), "MMM d, h:mm a")}</span>
                              ) : c.accessCode ? (
                                <span className="font-medium text-amber-600">Never</span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

    </div>
  )
}

function KpiCard({ label, value, color }) {
  const colors = {
    green: "text-green-600",
    blue: "text-blue-600",
    purple: "text-purple-600",
    red: "text-red-600",
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${colors[color] || "text-gray-900"}`}>{value}</p>
    </div>
  )
}

function LivePill() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      Live now
    </span>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-semibold text-gray-900">{value}</p>
    </div>
  )
}

function DecisionReasonTable({ rows }) {
  if (rows.length === 0) {
    return (
      <div className="border border-gray-200 rounded-xl p-6 text-center">
        <p className="text-xs text-gray-400">No recorded decision reasons in this period.</p>
      </div>
    )
  }

  const outcomeStyles = {
    hired: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    advanced: "bg-blue-100 text-blue-700",
    restored: "bg-gray-100 text-gray-600",
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="text-left text-[11px] font-semibold text-gray-500 px-4 py-2">Reason</th>
            <th className="text-left text-[11px] font-semibold text-gray-500 px-3 py-2">Outcome</th>
            <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">Count</th>
            <th className="text-right text-[11px] font-semibold text-gray-500 px-4 py-2">Rejected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-gray-100 last:border-0">
              <td className="px-4 py-2">
                <p className="text-xs font-medium text-gray-800">{row.reasonLabel}</p>
                <p className="text-[11px] text-gray-400">{row.reasonCode}</p>
              </td>
              <td className="px-3 py-2">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${outcomeStyles[row.outcome] || outcomeStyles.restored}`}>
                  {row.outcome}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-gray-600 text-right">{row.count}</td>
              <td className="px-4 py-2 text-xs text-gray-600 text-right">{row.rejectedCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CorrelationTable({ rows }) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="text-left text-[11px] font-semibold text-gray-500 px-4 py-2">Signal</th>
            <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">n</th>
            <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">r</th>
            <th className="text-left text-[11px] font-semibold text-gray-500 px-4 py-2">Read</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-gray-100 last:border-0">
              <td className="px-4 py-2">
                <p className="text-xs font-medium text-gray-800">{row.label}</p>
                <p className="text-[11px] text-gray-400">
                  Avg signal {formatMetric(row.averageSignal, row.formatSignal)} - outcome {formatMetric(row.averageOutcome, (value) => `${value.toFixed(1)}/5`)}
                </p>
              </td>
              <td className="px-3 py-2 text-xs text-gray-600 text-right">{row.sampleSize}</td>
              <td className="px-3 py-2 text-xs text-gray-600 text-right">{row.coefficient === null ? "n/a" : row.coefficient.toFixed(2)}</td>
              <td className="px-4 py-2"><CorrelationBadge strength={row.strength} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OutcomeSegmentTable({ title, rows }) {
  if (rows.length === 0) {
    return (
      <div className="border border-gray-200 rounded-xl p-4">
        <h4 className="text-xs font-semibold text-gray-700 mb-3">{title}</h4>
        <p className="text-xs text-gray-400 py-6 text-center">No rated hires yet</p>
      </div>
    )
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h4 className="text-xs font-semibold text-gray-700">{title}</h4>
      </div>
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="text-left text-[11px] font-semibold text-gray-500 px-4 py-2">Segment</th>
            <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">n</th>
            <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">Outcome</th>
            <th className="text-right text-[11px] font-semibold text-gray-500 px-4 py-2">Top</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-gray-100 last:border-0">
              <td className="px-4 py-2">
                <p className="text-xs font-medium text-gray-800 truncate">{row.label}</p>
                <p className="text-[11px] text-gray-400">
                  Manual {formatMetric(row.averageManualScore, (value) => value.toFixed(1))} - AI {formatMetric(row.averageCompositeScore, (value) => value.toFixed(1))}
                </p>
              </td>
              <td className="px-3 py-2 text-xs text-gray-600 text-right">{row.sampleSize}</td>
              <td className="px-3 py-2 text-xs font-semibold text-gray-700 text-right">{row.averageOutcome.toFixed(1)}/5</td>
              <td className="px-4 py-2 text-xs text-gray-600 text-right">{row.topPerformerCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CorrelationBadge({ strength }) {
  const labels = {
    insufficient: "Need more data",
    strong_positive: "Strong positive",
    moderate_positive: "Moderate positive",
    weak_positive: "Weak positive",
    flat: "No clear signal",
    weak_negative: "Weak negative",
    moderate_negative: "Moderate negative",
    strong_negative: "Strong negative",
  }
  const styles = {
    insufficient: "bg-gray-100 text-gray-500",
    strong_positive: "bg-green-100 text-green-700",
    moderate_positive: "bg-green-100 text-green-700",
    weak_positive: "bg-blue-100 text-blue-700",
    flat: "bg-gray-100 text-gray-600",
    weak_negative: "bg-amber-100 text-amber-700",
    moderate_negative: "bg-red-100 text-red-700",
    strong_negative: "bg-red-100 text-red-700",
  }
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${styles[strength] || styles.flat}`}>{labels[strength] || labels.flat}</span>
}

function formatMetric(value, formatter) {
  if (value === null || value === undefined) return "n/a"
  return formatter(value)
}

function SelectionMonitoringTable({ title, result }) {
  if (result.rows.length === 0) {
    return (
      <div className="border border-gray-200 rounded-xl p-4">
        <h4 className="text-xs font-semibold text-gray-700 mb-3">{title}</h4>
        <p className="text-xs text-gray-400 py-6 text-center">No reportable voluntary responses yet</p>
      </div>
    )
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-700">{title}</h4>
        <span className="text-[11px] text-gray-400">{result.totalSelected}/{result.totalApplicants} invited</span>
      </div>
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="text-left text-[11px] font-semibold text-gray-500 px-4 py-2">Group</th>
            <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">n</th>
            <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">Rate</th>
            <th className="text-right text-[11px] font-semibold text-gray-500 px-4 py-2">Ratio</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.group} className="border-b border-gray-100 last:border-0">
              <td className="px-4 py-2 text-xs text-gray-700">{row.group}</td>
              <td className="px-3 py-2 text-xs text-gray-600 text-right">{row.applicants}</td>
              <td className="px-3 py-2 text-xs text-gray-600 text-right">{formatRate(row.selectionRate)}</td>
              <td className="px-4 py-2 text-right">
                <SelectionStatusBadge row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SelectionStatusBadge({ row }) {
  if (row.status === "low_n") {
    return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">low n</span>
  }
  if (row.status === "attention") {
    return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{formatRate(row.rateRatio)}</span>
  }
  return <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">{formatRate(row.rateRatio)}</span>
}

function formatRate(value) {
  if (value === null || value === undefined) return "n/a"
  return `${(value * 100).toFixed(1)}%`
}
