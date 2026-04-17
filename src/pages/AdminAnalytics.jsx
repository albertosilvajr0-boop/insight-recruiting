import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { collection, query, orderBy, onSnapshot } from "firebase/firestore"
import { db } from "../firebase"
import { format, subDays, isAfter, startOfDay } from "date-fns"

const STAGE_LABELS = {
  applied: "Applied", scored: "Scored", to_schedule: "To Schedule",
  scheduled: "Scheduled", rejected: "Rejected", screening: "Applied",
  interview_2: "Applied", scheduling: "To Schedule",
}

export default function AdminAnalytics() {
  const [users, setUsers] = useState([])
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState("all") // "all" | "admins" | "candidates"
  const [dateRange, setDateRange] = useState("30") // days
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
    return () => { unsubUsers(); unsubCandidates() }
  }, [])

  const cutoff = startOfDay(subDays(new Date(), Number(dateRange)))
  const inRange = (ts) => ts?.toDate && isAfter(ts.toDate(), cutoff)

  // Filtered candidates by date range
  const rangedCandidates = candidates.filter((c) => inRange(c.createdAt))

  // ─── KPI Calculations ─────────────────────────────────────────────
  const totalApplications = rangedCandidates.length
  const totalScheduled = rangedCandidates.filter((c) => c.stage === "scheduled").length
  const totalRejected = rangedCandidates.filter((c) => c.stage === "rejected").length
  const totalScored = rangedCandidates.filter((c) => c.compositeScore != null).length
  const avgComposite = totalScored > 0
    ? (rangedCandidates.reduce((sum, c) => sum + (c.compositeScore || 0), 0) / totalScored).toFixed(1)
    : "—"
  const conversionRate = totalApplications > 0
    ? ((totalScheduled / totalApplications) * 100).toFixed(1)
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
    const order = ['applied', 'scored', 'to_schedule', 'scheduled']
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
    { key: 'to_schedule', label: 'Invited to interview' },
    { key: 'scheduled', label: 'Scheduled' },
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
  const adminsSorted = [...users].sort((a, b) => {
    const aTime = a.lastLoginAt?.toDate?.() || new Date(0)
    const bTime = b.lastLoginAt?.toDate?.() || new Date(0)
    return bTime - aTime
  })

  // ─── Filter logic ─────────────────────────────────────────────────
  const showAdmins = filterType === "all" || filterType === "admins"
  const showCandidates = filterType === "all" || filterType === "candidates"

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
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">SA</span>
            </div>
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="Total Applications" value={totalApplications} />
                <KpiCard label="Scheduled Interviews" value={totalScheduled} color="green" />
                <KpiCard label="Conversion Rate" value={`${conversionRate}%`} color="blue" />
                <KpiCard label="Avg Composite Score" value={avgComposite} color="purple" />
              </div>
            )}

            {showAdmins && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="Total Admin Users" value={users.length} />
                <KpiCard label={`Active (last ${dateRange}d)`} value={activeAdmins.length} color="green" />
                <KpiCard label="Total Logins" value={users.reduce((s, u) => s + (u.loginCount || 0), 0)} color="blue" />
                <KpiCard label="Superadmins" value={users.filter((u) => u.role === "superadmin").length} color="purple" />
              </div>
            )}

            {/* ─── Conversion Funnel ────────────────────────────────── */}
            {showCandidates && funnelTop > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900">Conversion funnel</h3>
                  <p className="text-xs text-gray-500">Applied → Scheduled</p>
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
                              i === 0 ? 'bg-blue-500' : i === 1 ? 'bg-indigo-500' : i === 2 ? 'bg-purple-500' : 'bg-green-500'
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
                  Overall conversion (applied → scheduled): <span className="font-semibold text-gray-900">{funnel[3]?.count && funnelTop ? ((funnel[3].count / funnelTop) * 100).toFixed(1) : '0'}%</span>
                </p>
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
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Recent Applications</h3>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Candidate</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Position</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Stage</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Score</th>
                      <th className="text-left text-xs font-semibold text-gray-600 px-5 py-3">Applied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rangedCandidates.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-8 text-sm text-gray-400">No applications in this period</td></tr>
                    ) : (
                      rangedCandidates.slice(0, 25).map((c) => {
                        const stageBadgeColor = {
                          scheduled: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-700",
                          scored: "bg-blue-100 text-blue-700", applied: "bg-amber-100 text-amber-700",
                        }
                        const stage = STAGE_LABELS[c.stage] || c.stage
                        return (
                          <tr key={c.id} onClick={() => navigate(`/admin/candidates/${c.id}`)}
                            className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer">
                            <td className="px-5 py-3">
                              <p className="text-sm font-medium text-gray-900">{c.firstName} {c.lastName}</p>
                              <p className="text-xs text-gray-500">{c.email}</p>
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
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
                {rangedCandidates.length > 25 && (
                  <div className="px-5 py-3 border-t border-gray-100 text-center">
                    <span className="text-xs text-gray-400">Showing 25 of {rangedCandidates.length} applications</span>
                  </div>
                )}
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
    green: "text-green-600", blue: "text-blue-600",
    purple: "text-purple-600", red: "text-red-600",
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${colors[color] || "text-gray-900"}`}>{value}</p>
    </div>
  )
}
