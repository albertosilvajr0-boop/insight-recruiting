import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc, deleteDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { ref, getDownloadURL, listAll } from 'firebase/storage'
import { auth, db, storage } from '../firebase'
import { format } from 'date-fns'
import ResumeViewer from '../components/ResumeViewer'
import { downloadCandidateProfile } from '../utils/downloadProfile'
import { adminAuditFields } from '../security/auditFields'
import { buildInitialOnboardingDoc } from '../onboarding/plan'
import {
  DECISION_OUTCOMES,
  buildDecisionEntry,
  buildDecisionHistory,
  getDecisionReasons,
} from '../selection/decisionReasons'

const STAGE_LABELS = {
  applied: 'Applied', scored: 'Scored', to_schedule: 'To Schedule',
  scheduled: 'Scheduled', hired: 'Hired', rejected: 'Rejected'
}
const STAGE_COLORS = {
  applied: 'bg-blue-100 text-blue-800', scored: 'bg-amber-100 text-amber-800',
  to_schedule: 'bg-purple-100 text-purple-800', scheduled: 'bg-green-100 text-green-800',
  hired: 'bg-emerald-100 text-emerald-800', rejected: 'bg-gray-100 text-gray-600'
}
const STAGE_FLOW = ['applied', 'scored', 'to_schedule', 'scheduled', 'hired']

const RESUME_CRITERIA = [
  { key: 'relevant_experience', label: 'Relevant experience for this role' },
  { key: 'no_gaps', label: 'No unexplained gaps in employment' },
  { key: 'accuracy', label: 'Application filled out accurately and completely' },
  { key: 'tenure', label: 'Good tenure / stability at previous jobs' },
  { key: 'presentation', label: 'Resume is well-organized and professional' },
  { key: 'skills_match', label: 'Skills align with job requirements' },
]

function ScoreButton({ value, selected, onClick }) {
  return (
    <button onClick={onClick}
      className={`w-9 h-9 rounded-lg text-sm font-semibold transition-colors ${
        selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      }`}>
      {value}
    </button>
  )
}

function DecisionModal({ modal, form, onChange, onCancel, onSubmit, loading }) {
  const reasons = getDecisionReasons(modal.outcome)
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-lg p-6 space-y-5">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{modal.title}</h3>
          <p className="text-sm text-gray-500 mt-1">{modal.body}</p>
        </div>

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
            rows={4}
            maxLength={600}
            placeholder="Optional: cite job-related evidence from the resume, interview, scorecard, availability, or business need."
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <span className="text-[11px] text-gray-400">{form.note.length}/600</span>
        </label>

        <div className="flex items-center justify-end gap-3">
          <button onClick={onCancel} disabled={loading} className="text-sm text-gray-600 font-medium px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onSubmit} disabled={loading || !form.reasonCode} className={`text-white text-sm font-medium px-5 py-2.5 rounded-xl disabled:opacity-60 ${
            modal.outcome === DECISION_OUTCOMES.REJECTED ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
          }`}>
            {loading ? 'Saving...' : modal.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminCandidate() {
  const { candidateId } = useParams()
  const navigate = useNavigate()
  const [candidate, setCandidate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [resumeDownloadUrl, setResumeDownloadUrl] = useState(null)
  const [videoUrls, setVideoUrls] = useState({})
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [decisionModal, setDecisionModal] = useState(null)
  const [decisionForm, setDecisionForm] = useState({ reasonCode: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [downloadStatus, setDownloadStatus] = useState('') // '' | progress text

  // Manual scores
  const [resumeScores, setResumeScores] = useState({})
  const [answerScores, setAnswerScores] = useState({})
  const [expandedTranscripts, setExpandedTranscripts] = useState({})
  const [saveStatus, setSaveStatus] = useState('idle') // idle | saving | saved
  const videoElRefs = useRef({})
  const saveTimerRef = useRef(null)
  const dirtyRef = useRef(false)

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'candidates', candidateId))
        if (!snap.exists()) { navigate('/admin/dashboard'); return }
        const data = { id: snap.id, ...snap.data() }
        // Migrate old stages
        const STAGE_MIGRATION = { screening: 'applied', interview_2: 'applied', scheduling: 'to_schedule' }
        if (STAGE_MIGRATION[data.stage]) data.stage = STAGE_MIGRATION[data.stage]
        setCandidate(data)
        setNotes(data.adminNotes || '')
        setResumeScores(data.manualResumeScores || {})
        setAnswerScores(data.manualAnswerScores || {})

        if (data.resumeUrl) {
          try {
            const url = await getDownloadURL(ref(storage, data.resumeUrl))
            setResumeDownloadUrl(url)
          } catch { /* resume may not exist */ }
        }

        if (data.videoResponses) {
          const urls = {}
          for (const [qIndex, path] of Object.entries(data.videoResponses)) {
            if (path && !path.startsWith('skipped')) {
              try {
                const dirRef = ref(storage, path)
                const fileList = await listAll(dirRef)
                const fullRecording = fileList.items.find(f => f.name === 'full_recording.webm')
                const firstWebm = fileList.items.find(f => f.name.endsWith('.webm'))
                const videoFile = fullRecording || firstWebm
                if (videoFile) {
                  const url = await getDownloadURL(videoFile)
                  urls[qIndex] = url
                }
              } catch (err) {
                console.error(`Failed to load video for Q${qIndex}:`, err)
              }
            }
          }
          setVideoUrls(urls)
        }
      } catch (err) {
        console.error('Failed to load candidate:', err)
        navigate('/admin/dashboard')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [candidateId, navigate])

  const actorSnapshot = () => ({
    uid: auth.currentUser?.uid || null,
    email: auth.currentUser?.email || null,
  })

  const buildDecisionFields = ({ outcome, stage, reasonCode, note }) => {
    const entry = buildDecisionEntry({
      outcome,
      stage,
      reasonCode,
      note,
      candidate,
      actor: actorSnapshot(),
    })

    return {
      latestDecision: entry,
      decisionHistory: buildDecisionHistory(candidate.decisionHistory, entry),
      decisionRecordedAt: serverTimestamp(),
    }
  }

  const openDecisionModal = (config) => {
    const firstReason = getDecisionReasons(config.outcome)[0]
    setDecisionForm({ reasonCode: firstReason?.code || '', note: '' })
    setDecisionModal(config)
  }

  const closeDecisionModal = () => {
    setDecisionModal(null)
    setDecisionForm({ reasonCode: '', note: '' })
  }

  const updateStage = async (newStage, decision = null) => {
    setActionLoading(true)
    try {
      const decisionFields = decision
        ? buildDecisionFields({ ...decision, stage: newStage })
        : {}
      await updateDoc(doc(db, 'candidates', candidateId), {
        stage: newStage,
        ...decisionFields,
        ...adminAuditFields(),
      })
      setCandidate(c => ({
        ...c,
        stage: newStage,
        latestDecision: decisionFields.latestDecision || c.latestDecision,
        decisionHistory: decisionFields.decisionHistory || c.decisionHistory,
      }))
      return true
    } catch (err) {
      alert('Failed to update stage: ' + err.message)
      return false
    }
    finally { setActionLoading(false) }
  }

  const startOnboarding = async (decision) => {
    setActionLoading(true)
    try {
      const onboardingRef = doc(db, 'onboardings', candidateId)
      const existing = await getDoc(onboardingRef)
      if (!existing.exists()) {
        await setDoc(onboardingRef, buildInitialOnboardingDoc(candidate, {
          uid: auth.currentUser?.uid,
          email: auth.currentUser?.email,
        }, serverTimestamp()))
      }
      const decisionFields = buildDecisionFields({
        ...decision,
        outcome: DECISION_OUTCOMES.HIRED,
        stage: 'hired',
      })
      await updateDoc(doc(db, 'candidates', candidateId), {
        stage: 'hired',
        onboardingStatus: 'active',
        onboardingStartedAt: serverTimestamp(),
        hiredAt: candidate.hiredAt || serverTimestamp(),
        ...decisionFields,
        ...adminAuditFields(),
      })
      setCandidate(c => ({
        ...c,
        stage: 'hired',
        onboardingStatus: 'active',
        latestDecision: decisionFields.latestDecision,
        decisionHistory: decisionFields.decisionHistory,
      }))
      navigate('/admin/onboarding')
      return true
    } catch (err) {
      alert('Failed to start onboarding: ' + err.message)
      return false
    } finally {
      setActionLoading(false)
    }
  }

  const submitDecision = async () => {
    if (!decisionModal) return
    const decision = {
      outcome: decisionModal.outcome,
      reasonCode: decisionForm.reasonCode,
      note: decisionForm.note,
    }

    const success = decisionModal.outcome === DECISION_OUTCOMES.HIRED
      ? await startOnboarding(decision)
      : await updateStage(decisionModal.stage, decision)
    if (success) closeDecisionModal()
  }

  const saveNotes = async () => {
    setSavingNotes(true)
    try {
      await updateDoc(doc(db, 'candidates', candidateId), { adminNotes: notes, ...adminAuditFields() })
    } catch (err) { alert('Failed to save notes: ' + err.message) }
    finally { setSavingNotes(false) }
  }

  const deleteCandidate = async () => {
    setActionLoading(true)
    try { await deleteDoc(doc(db, 'candidates', candidateId)); navigate('/admin/dashboard') }
    catch (err) { alert('Failed to delete: ' + err.message) }
    finally { setActionLoading(false) }
  }

  const getNextStage = () => {
    const idx = STAGE_FLOW.indexOf(candidate?.stage)
    if (idx === -1 || idx >= STAGE_FLOW.length - 1) return null
    return STAGE_FLOW[idx + 1]
  }

  // Calculate cumulative score
  const calcCumulativeScore = () => {
    const allScores = []
    Object.values(resumeScores).forEach(v => { if (v) allScores.push(v) })
    Object.values(answerScores).forEach(v => { if (v) allScores.push(v) })
    if (allScores.length === 0) return null
    const sum = allScores.reduce((a, b) => a + b, 0)
    return { sum, count: allScores.length, avg: (sum / allScores.length).toFixed(1), max: allScores.length * 5 }
  }

  const setResumeScore = (key, value) => {
    setResumeScores(prev => ({ ...prev, [key]: value }))
    dirtyRef.current = true
  }

  const setAnswerScore = (qIndex, value) => {
    setAnswerScores(prev => ({ ...prev, [qIndex]: value }))
    dirtyRef.current = true
  }

  // Auto-save scores ~800ms after the last change. Keeps manual evaluation
  // incremental — evaluators never lose work mid-review.
  useEffect(() => {
    if (!candidate) return
    if (!dirtyRef.current) return
    clearTimeout(saveTimerRef.current)
    setSaveStatus('saving')
    saveTimerRef.current = setTimeout(async () => {
      try {
        const cumulative = calcCumulativeScore()
        await updateDoc(doc(db, 'candidates', candidateId), {
          manualResumeScores: resumeScores,
          manualAnswerScores: answerScores,
          manualScore: cumulative ? { avg: parseFloat(cumulative.avg), sum: cumulative.sum, count: cumulative.count, max: cumulative.max } : null,
          ...adminAuditFields()
        })
        dirtyRef.current = false
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 1500)
      } catch (err) {
        console.error('Auto-save failed:', err)
        setSaveStatus('idle')
      }
    }, 800)
    return () => clearTimeout(saveTimerRef.current)
  }, [resumeScores, answerScores]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = async () => {
    if (downloadStatus) return
    try {
      const { issues } = await downloadCandidateProfile(candidate, setDownloadStatus)
      if (issues.length) {
        alert(`Downloaded, but some files were missing:\n\n${issues.join('\n')}`)
      }
    } catch (err) {
      alert('Download failed: ' + (err.message || err))
    } finally {
      setDownloadStatus('')
    }
  }

  const toggleFlag = async () => {
    try {
      await updateDoc(doc(db, 'candidates', candidateId), { needsReview: !candidate.needsReview, ...adminAuditFields() })
      setCandidate(c => ({ ...c, needsReview: !c.needsReview }))
    } catch (err) { alert('Failed to flag: ' + err.message) }
  }

  const saveAllScores = async () => {
    setSaving(true)
    try {
      const cumulative = calcCumulativeScore()
      await updateDoc(doc(db, 'candidates', candidateId), {
        manualResumeScores: resumeScores,
        manualAnswerScores: answerScores,
        manualScore: cumulative ? { avg: parseFloat(cumulative.avg), sum: cumulative.sum, count: cumulative.count, max: cumulative.max } : null,
        stage: candidate.stage === 'applied' ? 'scored' : candidate.stage,
        ...adminAuditFields()
      })
      setCandidate(c => ({
        ...c,
        manualResumeScores: resumeScores,
        manualAnswerScores: answerScores,
        manualScore: cumulative ? { avg: parseFloat(cumulative.avg), sum: cumulative.sum, count: cumulative.count, max: cumulative.max } : null,
        stage: c.stage === 'applied' ? 'scored' : c.stage,
      }))
    } catch (err) { alert('Failed to save scores: ' + err.message) }
    finally { setSaving(false) }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!candidate) return null

  const cumulative = calcCumulativeScore()
  const scoreColor = (avg) => {
    if (avg == null) return 'text-gray-400'
    if (avg >= 4) return 'text-green-600'
    if (avg >= 3) return 'text-amber-600'
    return 'text-red-600'
  }

  // Determine which questions are "scorable" (not competence puzzle type that's right/wrong)
  const isScorableQuestion = (qData) => {
    return qData?.type !== 'text_response'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/admin/dashboard')} className="text-sm text-gray-500 hover:text-gray-900">&larr; Back</button>
            <span className="text-sm font-medium text-gray-900">{candidate.firstName} {candidate.lastName}</span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STAGE_COLORS[candidate.stage] || 'bg-gray-100 text-gray-600'}`}>
              {STAGE_LABELS[candidate.stage] || candidate.stage}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {saveStatus !== 'idle' && (
              <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${saveStatus === 'saving' ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                {saveStatus === 'saving' ? 'Saving…' : 'Saved'}
              </span>
            )}
            <button onClick={handleDownload} disabled={!!downloadStatus}
              title="Download resume + videos + summary as a ZIP you can email"
              className="text-xs font-medium px-3 py-1.5 rounded-lg border bg-white text-gray-700 border-gray-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 disabled:opacity-60 disabled:cursor-wait">
              {downloadStatus || '↓ Download profile'}
            </button>
            <button onClick={toggleFlag} title={candidate.needsReview ? 'Unflag' : 'Flag for second opinion'}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${candidate.needsReview ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-amber-50 hover:text-amber-700'}`}>
              {candidate.needsReview ? '⚑ Flagged' : 'Flag'}
            </button>
            {candidate.stage === 'hired' ? (
              <button onClick={() => navigate('/admin/onboarding')}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                Open onboarding
              </button>
            ) : ['scheduled', 'to_schedule'].includes(candidate.stage) && (
              <button onClick={() => openDecisionModal({
                outcome: DECISION_OUTCOMES.HIRED,
                stage: 'hired',
                title: 'Start onboarding?',
                body: 'Record the job-related reason for moving this candidate into onboarding.',
                confirmLabel: 'Start onboarding',
              })} disabled={actionLoading}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                Start onboarding
              </button>
            )}
            {getNextStage() && getNextStage() !== 'hired' && candidate.stage !== 'rejected' && (
              <button onClick={() => updateStage(getNextStage(), {
                outcome: DECISION_OUTCOMES.ADVANCED,
                reasonCode: 'structured_review_complete',
                note: '',
              })} disabled={actionLoading}
                className="bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                Move to {STAGE_LABELS[getNextStage()]}
              </button>
            )}
            {candidate.stage !== 'rejected' && (
              <button onClick={() => openDecisionModal({
                outcome: DECISION_OUTCOMES.REJECTED,
                stage: 'rejected',
                title: 'Reject candidate?',
                body: 'Choose the closest job-related reason before moving this application to Rejected.',
                confirmLabel: 'Reject candidate',
              })} disabled={actionLoading}
                className="border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60 text-xs font-medium px-3 py-1.5 rounded-lg">
                Reject
              </button>
            )}
            {candidate.stage === 'rejected' && (
              <button onClick={() => openDecisionModal({
                outcome: DECISION_OUTCOMES.RESTORED,
                stage: 'applied',
                title: 'Restore application?',
                body: 'Record why this application is being reopened for review.',
                confirmLabel: 'Restore application',
              })} disabled={actionLoading}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                Restore
              </button>
            )}
            <button onClick={() => setShowDeleteConfirm(true)} disabled={actionLoading}
              className="border border-gray-200 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-60 text-xs font-medium px-3 py-1.5 rounded-lg">
              Delete
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* Cumulative Score Card — side-by-side with AI composite where available */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your score</p>
              <p className="text-xs text-gray-500 mt-0.5">Manual scoring below</p>
              {cumulative ? (
                <div className="mt-2">
                  <p className={`text-3xl font-bold ${scoreColor(cumulative.avg)}`}>{cumulative.avg}<span className="text-lg text-gray-400">/5</span></p>
                  <p className="text-xs text-gray-500">{cumulative.sum} of {cumulative.max} points ({cumulative.count} items)</p>
                </div>
              ) : (
                <p className="text-sm text-gray-400 mt-2">Not yet scored</p>
              )}
            </div>
            <div className="border-l border-gray-100 pl-6">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">AI score</p>
              <p className="text-xs text-gray-500 mt-0.5">Claude's blended assessment</p>
              {candidate.compositeScore != null ? (
                <div className="mt-2">
                  <p className={`text-3xl font-bold ${
                    candidate.compositeScore >= 8 ? 'text-green-600' : candidate.compositeScore >= 5 ? 'text-amber-600' : 'text-red-600'
                  }`}>{candidate.compositeScore.toFixed(1)}<span className="text-lg text-gray-400">/10</span></p>
                  <p className="text-xs text-gray-500">
                    Resume {candidate.resumeScore ?? '—'}/10 · Interview {candidate.interviewScore ?? '—'}/10
                  </p>
                  {(() => {
                    // Flag large disagreements (>2 on a normalized scale)
                    // so the evaluator knows to look closer.
                    if (!cumulative || candidate.compositeScore == null) return null
                    const normalizedManual = parseFloat(cumulative.avg) * 2 // 5-scale → 10-scale
                    const delta = Math.abs(normalizedManual - candidate.compositeScore)
                    if (delta < 2) return null
                    return (
                      <p className="mt-2 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                        ⚠ You and the AI disagree by {delta.toFixed(1)} points — worth a second look.
                      </p>
                    )
                  })()}
                </div>
              ) : (
                <p className="text-sm text-gray-400 mt-2">AI scoring pending</p>
              )}
            </div>
          </div>
        </div>

        {/* Overview */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Position</p>
            <p className="text-sm font-semibold text-gray-900">{candidate.jobTitle}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Applied</p>
            <p className="text-sm font-medium text-gray-900">
              {candidate.createdAt?.toDate ? format(candidate.createdAt.toDate(), 'MMM d, yyyy') : '—'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Contact</p>
            <p className="text-sm text-gray-900">{candidate.email}</p>
            <p className="text-xs text-gray-500">{candidate.phone}</p>
          </div>
        </div>

        {/* Resume + Scoring */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Resume Review</h2>
            {resumeDownloadUrl && (
              <a href={resumeDownloadUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Download</a>
            )}
          </div>
          {resumeDownloadUrl && (
            <ResumeViewer url={resumeDownloadUrl} fileName={candidate.resumeUrl} />
          )}
          {candidate.resumeSkipped && !resumeDownloadUrl && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Candidate skipped resume upload.
            </div>
          )}
          {!candidate.resumeSkipped && !resumeDownloadUrl && (
            <p className="text-sm text-gray-400">No resume uploaded.</p>
          )}

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Score Resume (1-5)</h3>
            <div className="space-y-3">
              {RESUME_CRITERIA.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <p className="text-sm text-gray-700 flex-1">{label}</p>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(v => (
                      <ScoreButton key={v} value={v} selected={resumeScores[key] === v} onClick={() => setResumeScore(key, v)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Interview Responses + Scoring */}
        {(Object.keys(videoUrls).length > 0 || Object.keys(candidate.textResponses || {}).length > 0 || candidate.questions) && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
            <h2 className="text-sm font-semibold text-gray-900">Interview Responses</h2>
            {Object.entries(candidate.questions || {}).sort(([a], [b]) => Number(a) - Number(b)).map(([qIndex, qData]) => {
              const hasVideo = videoUrls[qIndex]
              const hasText = candidate.textResponses?.[qIndex]
              const isSkipped = candidate.videoResponses?.[qIndex]?.startsWith?.('skipped')
              const scorable = isScorableQuestion(qData)
              const typeBadge = qData.type === 'video_reading' ? 'bg-purple-100 text-purple-700'
                : qData.type === 'text_response' ? 'bg-amber-100 text-amber-700'
                : 'bg-blue-100 text-blue-700'
              const typeLabel = qData.type === 'video_reading' ? 'Script Reading'
                : qData.type === 'text_response' ? 'Written Response'
                : 'Video Response'

              return (
                <div key={qIndex} className="border-b border-gray-100 last:border-0 pb-6 last:pb-0 space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="text-xs font-bold text-gray-400 bg-gray-100 w-6 h-6 rounded-full flex items-center justify-center shrink-0">{parseInt(qIndex) + 1}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${typeBadge}`}>{typeLabel}</span>
                        {qData.category && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{qData.category}</span>}
                      </div>
                      <p className="text-sm text-gray-900 font-medium leading-relaxed">"{qData.text}"</p>
                    </div>
                  </div>
                  {hasVideo && (
                    <div className="ml-9 space-y-2">
                      <video
                        ref={el => { if (el) videoElRefs.current[qIndex] = el }}
                        controls src={videoUrls[qIndex]}
                        className="w-full rounded-lg border border-gray-200" />
                      {candidate.videoTranscripts?.[qIndex] && (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg">
                          <button
                            onClick={() => setExpandedTranscripts(p => ({ ...p, [qIndex]: !p[qIndex] }))}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                          >
                            <span className="flex items-center gap-2">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                              Transcript
                            </span>
                            <span className="text-gray-400">{expandedTranscripts[qIndex] ? 'Hide' : 'Show'}</span>
                          </button>
                          {expandedTranscripts[qIndex] && (
                            <div className="px-3 pb-3 space-y-1 max-h-64 overflow-y-auto">
                              {(candidate.videoTranscripts[qIndex].segments || []).length > 0
                                ? candidate.videoTranscripts[qIndex].segments.map((seg, i) => (
                                    <button
                                      key={i}
                                      onClick={() => {
                                        const el = videoElRefs.current[qIndex]
                                        if (el) { el.currentTime = seg.start; el.play?.() }
                                      }}
                                      className="flex items-start gap-2 w-full text-left hover:bg-white rounded px-1.5 py-1"
                                    >
                                      <span className="text-[11px] font-mono text-blue-600 shrink-0 w-10">
                                        {Math.floor(seg.start / 60)}:{String(Math.floor(seg.start % 60)).padStart(2, '0')}
                                      </span>
                                      <span className="text-xs text-gray-700 leading-relaxed">{seg.text}</span>
                                    </button>
                                  ))
                                : (
                                  <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
                                    {candidate.videoTranscripts[qIndex].transcript || '(No transcript available)'}
                                  </p>
                                )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {hasText && (
                    <div className="ml-9 bg-gray-50 rounded-lg p-3">
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{candidate.textResponses[qIndex]}</p>
                    </div>
                  )}
                  {isSkipped && !hasVideo && (
                    <p className="ml-9 text-xs text-gray-400 italic">Skipped</p>
                  )}
                  {/* Score this answer (not for text/puzzle questions) */}
                  {scorable && (
                    <div className="ml-9 flex items-center gap-3">
                      <span className="text-xs text-gray-500 font-medium">Score:</span>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map(v => (
                          <ScoreButton key={v} value={v} selected={answerScores[qIndex] === v} onClick={() => setAnswerScore(qIndex, v)} />
                        ))}
                      </div>
                      {answerScores[qIndex] && <span className="text-xs text-gray-400">{answerScores[qIndex]}/5</span>}
                    </div>
                  )}
                </div>
              )
            })}
            {/* Fallback for old applications without question data */}
            {!candidate.questions && Object.entries(videoUrls).map(([qIndex, url]) => (
              <div key={qIndex} className="space-y-3">
                <p className="text-xs font-medium text-gray-500">Question {parseInt(qIndex) + 1}</p>
                <video controls src={url} className="w-full rounded-lg border border-gray-200" />
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 font-medium">Score:</span>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(v => (
                      <ScoreButton key={v} value={v} selected={answerScores[qIndex] === v} onClick={() => setAnswerScore(qIndex, v)} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Mark as scored — only relevant while still in Applied */}
        {candidate.stage === 'applied' && (
          <div className="flex justify-center">
            <button onClick={saveAllScores} disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-3 px-8 rounded-xl text-sm transition-colors">
              {saving ? 'Saving…' : 'Mark as Scored'}
            </button>
          </div>
        )}

        {/* AI Analysis (if available) */}
        {(candidate.resumeAnalysis || candidate.interviewAnalysis) && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">AI Analysis</h2>
            {candidate.resumeAnalysis && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Resume</p>
                <p className="text-sm text-gray-700 leading-relaxed">{candidate.resumeAnalysis}</p>
              </div>
            )}
            {candidate.interviewAnalysis && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Interview</p>
                <p className="text-sm text-gray-700 leading-relaxed">{candidate.interviewAnalysis}</p>
              </div>
            )}
          </div>
        )}

        {/* Video Transcript */}
        {candidate.videoTranscript && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Interview Transcript</h2>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{candidate.videoTranscript}</p>
          </div>
        )}

        {/* Decision Rationale */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Decision rationale</h2>
            {candidate.latestDecision?.selectionProcessVersion && (
              <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                Process {candidate.latestDecision.selectionProcessVersion}
              </span>
            )}
          </div>
          {candidate.latestDecision ? (
            <div className="space-y-3">
              <div className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{candidate.latestDecision.reasonLabel}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {candidate.latestDecision.outcome} to {STAGE_LABELS[candidate.latestDecision.stage] || candidate.latestDecision.stage || 'stage'}
                      {candidate.latestDecision.decidedBy?.email ? ` by ${candidate.latestDecision.decidedBy.email}` : ''}
                    </p>
                  </div>
                  <span className="text-[11px] text-gray-400 shrink-0">
                    {candidate.latestDecision.decidedAt ? format(new Date(candidate.latestDecision.decidedAt), 'MMM d, h:mm a') : ''}
                  </span>
                </div>
                {candidate.latestDecision.note && (
                  <p className="text-sm text-gray-700 mt-3 whitespace-pre-wrap">{candidate.latestDecision.note}</p>
                )}
              </div>
              {(candidate.decisionHistory || []).length > 1 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">History</p>
                  {(candidate.decisionHistory || []).slice(-5).reverse().map((decision) => (
                    <div key={decision.id} className="flex items-start justify-between gap-3 text-xs border-b border-gray-100 last:border-0 pb-2 last:pb-0">
                      <div>
                        <p className="font-medium text-gray-700">{decision.reasonLabel}</p>
                        <p className="text-gray-400">{decision.outcome} to {STAGE_LABELS[decision.stage] || decision.stage || 'stage'}</p>
                      </div>
                      <span className="text-gray-400 shrink-0">{decision.decidedAt ? format(new Date(decision.decidedAt), 'MMM d') : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No recorded decision rationale yet.</p>
          )}
        </div>

        {/* Admin Notes */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Notes</h2>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Add notes about this candidate..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={saveNotes} disabled={savingNotes}
            className="mt-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {savingNotes ? 'Saving...' : 'Save notes'}
          </button>
        </div>
      </div>

      {/* Decision rationale modal */}
      {decisionModal && (
        <DecisionModal
          modal={decisionModal}
          form={decisionForm}
          onChange={setDecisionForm}
          onCancel={closeDecisionModal}
          onSubmit={submitDecision}
          loading={actionLoading}
        />
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900">Delete application?</h3>
            <p className="text-sm text-gray-500 mt-1">
              This will permanently delete <span className="font-medium text-gray-700">{candidate.firstName} {candidate.lastName}</span>'s application. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={() => setShowDeleteConfirm(false)} className="text-sm text-gray-600 font-medium px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={deleteCandidate} disabled={actionLoading} className="bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium px-5 py-2.5 rounded-xl">
                {actionLoading ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
