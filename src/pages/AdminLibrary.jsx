import { useState, useEffect, useMemo } from "react"
import { useNavigate, Link } from "react-router-dom"
import { collection, getDocs, query, orderBy } from "firebase/firestore"
import { db } from "../firebase"
import { INDUSTRY_OPTIONS } from "../config/industries"

const TYPE_LABELS = {
  video_response: "Video Response",
  video_reading: "Script Reading",
  text_response: "Written",
}

const TYPE_STYLES = {
  video_response: "bg-blue-100 text-blue-700",
  video_reading: "bg-purple-100 text-purple-700",
  text_response: "bg-amber-100 text-amber-700",
}

const CATEGORY_LABELS = {
  intro: "Introduction",
  experience: "Experience & Background",
  situational: "Situational / Behavioral",
  word_track: "Word Track / Script Reading",
  competence: "Competence / Problem Solving",
  motivation: "Motivation & Culture Fit",
  values: "Values & Mindset",
  communication: "Communication / Writing",
}

// scoringWeights docs may be a flat map { criterion: weight }, an array of
// { criterion|label|name, weight|percent }, or nested { resume: {...}, interview: {...} }.
function normalizeWeights(weights) {
  if (!weights || typeof weights !== "object") return []
  if (!Array.isArray(weights) && (weights.resume || weights.interview)) {
    return [
      ...(weights.resume ? [{ group: "Resume", entries: normalizeFlat(weights.resume) }] : []),
      ...(weights.interview ? [{ group: "Interview", entries: normalizeFlat(weights.interview) }] : []),
    ]
  }
  return [{ group: null, entries: normalizeFlat(weights) }]
}

function normalizeFlat(weights) {
  const entries = Array.isArray(weights)
    ? weights.map(w => [w.criterion || w.label || w.name, w.weight ?? w.percent])
    : Object.entries(weights)
  return entries
    .filter(([label, weight]) => label && weight != null)
    .map(([label, weight]) => ({ label, weight: formatPercent(weight) }))
}

function formatPercent(weight) {
  const n = Number(weight)
  if (!Number.isFinite(n)) return String(weight)
  return n <= 1 ? `${Math.round(n * 100)}%` : `${n}%`
}

export default function AdminLibrary() {
  const [rubrics, setRubrics] = useState([])
  const [questions, setQuestions] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [industry, setIndustry] = useState("")
  const [expandedRole, setExpandedRole] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    async function load() {
      try {
        const [rubricSnap, questionSnap, jobSnap] = await Promise.all([
          getDocs(collection(db, "roleRubrics")),
          getDocs(query(collection(db, "interviewQuestions"), orderBy("order", "asc"))),
          getDocs(collection(db, "jobs")),
        ])
        setRubrics(rubricSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        setQuestions(questionSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        setJobs(jobSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (err) {
        console.error("Failed to load question library:", err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const industries = useMemo(() => {
    const distinct = [...new Set(rubrics.map(r => r.industryLabel).filter(Boolean))]
    return [
      ...INDUSTRY_OPTIONS.filter(i => distinct.includes(i)),
      ...distinct.filter(i => !INDUSTRY_OPTIONS.includes(i)).sort(),
    ]
  }, [rubrics])

  useEffect(() => {
    if (!industry && industries.length > 0) setIndustry(industries[0])
  }, [industries, industry])

  const roles = useMemo(() =>
    rubrics
      .filter(r => r.industryLabel === industry)
      .map(r => ({ ...r, roleKey: r.roleKey || r.id }))
      .sort((a, b) => String(a.label || a.roleKey).localeCompare(String(b.label || b.roleKey))),
    [rubrics, industry])

  const questionsForRole = (roleKey) =>
    questions
      .filter(q => q.roleKey === roleKey)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))

  const groupByCategory = (roleQuestions) => {
    const groups = []
    for (const q of roleQuestions) {
      const key = q.category || "other"
      let group = groups.find(g => g.category === key)
      if (!group) {
        group = { category: key, items: [] }
        groups.push(group)
      }
      group.items.push(q)
    }
    return groups
  }

  const jobsForRole = (roleKey) => jobs.filter(j => j.roleKey === roleKey)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/admin/dashboard")} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <img src="/brand-mark.png" alt="Insight Edge" className="w-7 h-7 object-contain" />
            <span className="font-semibold text-gray-900 text-sm">Question Library</span>
          </div>
          <button onClick={() => navigate("/admin/questions")} className="text-sm border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50">Manage questions</button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : rubrics.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No role rubrics found.</p>
            <p className="text-gray-400 text-xs mt-2">Run the seed script (seed_interview_questions.mjs) to load the question batteries and role rubrics.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500">Company type:</label>
              <select value={industry} onChange={e => { setIndustry(e.target.value); setExpandedRole(null) }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                {industries.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
              <span className="text-xs text-gray-400">{roles.length} role{roles.length === 1 ? "" : "s"}</span>
            </div>

            {roles.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-400 text-sm">No roles in this industry yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {roles.map(role => {
                  const roleQuestions = questionsForRole(role.roleKey)
                  const roleJobs = jobsForRole(role.roleKey)
                  const expanded = expandedRole === role.roleKey
                  return (
                    <div key={role.roleKey} className="bg-white rounded-xl border-2 border-gray-200">
                      <button onClick={() => setExpandedRole(expanded ? null : role.roleKey)} className="w-full flex items-center justify-between gap-4 p-4 text-left">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{role.label || role.roleKey}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {roleQuestions.length} question{roleQuestions.length === 1 ? "" : "s"}
                            {roleJobs.length > 0 && ` · ${roleJobs.length} job${roleJobs.length === 1 ? "" : "s"} using this role`}
                          </p>
                        </div>
                        <svg className={`w-5 h-5 text-gray-400 transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>

                      {expanded && (
                        <div className="border-t border-gray-100 p-4 space-y-5">
                          {/* Scoring rubric */}
                          <div className="grid md:grid-cols-2 gap-4">
                            <div className="bg-gray-50 rounded-lg p-3">
                              <p className="text-xs font-semibold text-gray-700 mb-2">Scoring weights</p>
                              {normalizeWeights(role.scoringWeights).length === 0 ? (
                                <p className="text-xs text-gray-400">Not defined — default weights are used.</p>
                              ) : normalizeWeights(role.scoringWeights).map((group, gi) => (
                                <div key={gi} className={gi > 0 ? "mt-2" : ""}>
                                  {group.group && <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{group.group}</p>}
                                  <ul className="space-y-1">
                                    {group.entries.map((w, wi) => (
                                      <li key={wi} className="flex items-center justify-between gap-2 text-xs text-gray-600">
                                        <span>{w.label}</span>
                                        <span className="font-medium text-gray-900 shrink-0">{w.weight}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                            <div className="bg-gray-50 rounded-lg p-3">
                              <p className="text-xs font-semibold text-gray-700 mb-2">Hard disqualifiers</p>
                              {Array.isArray(role.hardDisqualifiers) && role.hardDisqualifiers.length > 0 ? (
                                <ul className="space-y-1">
                                  {role.hardDisqualifiers.map((d, di) => (
                                    <li key={di} className="text-xs text-red-700 flex gap-1.5"><span className="shrink-0">•</span><span>{d}</span></li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-gray-400">None defined.</p>
                              )}
                            </div>
                          </div>

                          {/* Questions grouped by category */}
                          {roleQuestions.length === 0 ? (
                            <p className="text-xs text-gray-400">No questions seeded for this role yet.</p>
                          ) : groupByCategory(roleQuestions).map(group => (
                            <div key={group.category}>
                              <p className="text-xs font-semibold text-gray-700 mb-2">{CATEGORY_LABELS[group.category] || group.category}</p>
                              <div className="space-y-2">
                                {group.items.map((q, qi) => (
                                  <div key={q.id} className={`border border-gray-200 rounded-lg p-3 ${q.active === false ? "opacity-50" : ""}`}>
                                    <div className="flex items-start gap-2">
                                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-600 shrink-0 mt-0.5">{qi + 1}</span>
                                      <p className="text-sm text-gray-900 leading-relaxed flex-1">{q.text}</p>
                                    </div>
                                    <div className="flex items-center gap-2 mt-2 flex-wrap pl-7">
                                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${TYPE_STYLES[q.type] || "bg-gray-100 text-gray-600"}`}>{TYPE_LABELS[q.type] || q.type}</span>
                                      {q.timerType === "hard" && (
                                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">Hard {q.timerSeconds}s</span>
                                      )}
                                      {q.timerType === "soft" && (
                                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">Soft {q.timerSeconds}s</span>
                                      )}
                                      {q.active === false && (
                                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600">Inactive</span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}

                          {/* Jobs using this role */}
                          <div>
                            <p className="text-xs font-semibold text-gray-700 mb-2">Jobs using this role</p>
                            {roleJobs.length === 0 ? (
                              <p className="text-xs text-gray-400">No jobs are using this role yet.</p>
                            ) : (
                              <div className="space-y-2">
                                {roleJobs.map(job => (
                                  <div key={job.id} className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-sm text-gray-900 truncate">{job.title}</span>
                                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${job.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{job.status}</span>
                                    </div>
                                    <Link to={`/admin/jobs?edit=${job.id}`} className="text-xs text-blue-600 hover:text-blue-800 shrink-0">Edit job</Link>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
