import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, collection, query, where, orderBy, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import { ref, uploadBytesResumable } from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import { v4 as uuidv4 } from 'uuid'
import { db, storage, functions } from '../firebase'
import VideoRecorder from '../components/VideoRecorder'
import DeviceCheck from '../components/DeviceCheck'
import JobPostingSchema from '../components/JobPostingSchema'
import {
  ACCOMMODATION_EMAIL,
  ACCOMMODATION_PHONE,
  APPLICANT_PRIVACY_URL,
  COMPLIANCE_NOTICE_VERSION,
  DEFAULT_ACKNOWLEDGEMENTS,
  DEFAULT_EEO_SURVEY,
  EEO_OPTIONS,
  EEO_SURVEY_VERSION,
  PARENT_ORG_DISPLAY_NAME,
  REQUIRED_ACKNOWLEDGEMENTS,
  SELECTION_PROCESS_VERSION,
  allRequiredAcknowledgementsAccepted,
  buildRenderedSelectionNoticeText,
  getRecordingNotice,
  getTechnologyCapabilitySentence,
  normalizeEeoSurvey,
} from '../compliance/selectionProcess'
import { getInitials, getJobClientName, getJobLocation } from '../config/organization'

const STEPS = ['info', 'resume', 'compliance', 'interview', 'submitting']
const DRAFT_KEY_PREFIX = 'apply_draft_v1_'
// Total length of interview we estimate — used for the progress map.
function summarizeQuestionTime(q) {
  if (q?.timerType === 'hard' && q.timerSeconds) return q.timerSeconds
  if (q?.timerType === 'soft' && q.timerSeconds) return q.timerSeconds
  if (q?.type === 'text_response') return 180
  if (q?.type === 'video_reading') return 60
  return 120
}

function inferResumeContentType(fileName) {
  const lower = String(fileName || '').toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lower.endsWith('.doc')) return 'application/msword'
  return 'application/octet-stream'
}

async function sha256Hex(value) {
  if (!window.crypto?.subtle) return 'unavailable'
  const encoded = new TextEncoder().encode(value)
  const digest = await window.crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export default function Apply() {
  const { jobId, code } = useParams()
  const navigate = useNavigate()
  // Invite mode: the candidate arrived via an access code (/i/:code). Their
  // record already exists (created by an admin with resume on file), so we
  // skip the info + resume steps and submit through a Cloud Function.
  const inviteMode = Boolean(code)

  const [job, setJob] = useState(null)
  const [invite, setInvite] = useState(null)
  const [inviteError, setInviteError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(inviteMode ? 'compliance' : 'info')
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [questions, setQuestions] = useState([])

  // Candidate ID is stable across reloads — we derive it from localStorage so
  // that video uploads, resume uploads, and the draft all point at the same
  // record if the user drops off and returns. In invite mode it comes from the
  // server session instead (also stable across reloads).
  const draftKey = inviteMode ? `${DRAFT_KEY_PREFIX}invite_${code}` : `${DRAFT_KEY_PREFIX}${jobId}`
  const [candidateId, setCandidateId] = useState(() => {
    if (inviteMode) return null
    try {
      const existing = JSON.parse(localStorage.getItem(draftKey) || 'null')
      if (existing?.candidateId) return existing.candidateId
    } catch { /* corrupt draft — fall through */ }
    return uuidv4()
  })
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [formErrors, setFormErrors] = useState({})
  const [acknowledgements, setAcknowledgements] = useState(DEFAULT_ACKNOWLEDGEMENTS)
  const [eeoSurvey, setEeoSurvey] = useState(DEFAULT_EEO_SURVEY)
  const [complianceErrors, setComplianceErrors] = useState({})
  const [resumeFile, setResumeFile] = useState(null)
  const [resumeUrl, setResumeUrl] = useState(null)
  const [resumeFileName, setResumeFileName] = useState(null)
  const [resumeSkipped, setResumeSkipped] = useState(false)
  const [resumeUploading, setResumeUploading] = useState(false)
  const [resumeProgress, setResumeProgress] = useState(0)
  const [videoResponses, setVideoResponses] = useState({})
  const [textResponses, setTextResponses] = useState({})
  const [timingData, setTimingData] = useState({})
  const [questionStartTime, setQuestionStartTime] = useState(null)
  const [hardTimerRemaining, setHardTimerRemaining] = useState(null)
  const [softTimerRemaining, setSoftTimerRemaining] = useState(null)
  const [hardTimerExpired, setHardTimerExpired] = useState(false)
  const [hardTimerWarned, setHardTimerWarned] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const [deviceCheckPassed, setDeviceCheckPassed] = useState(false)
  const [videoUploadProgress, setVideoUploadProgress] = useState({}) // { qIndex: pct }
  // State (not ref) so the save effect can't run until AFTER restored state
  // has been committed to React. Using a ref would race against the first
  // save effect pass, briefly clobbering the persisted draft with empty state.
  const [draftLoaded, setDraftLoaded] = useState(false)
  const draftLoadedRef = useRef(false)

  // Restore draft once on mount (before loading job so UI flashes at the right step).
  useEffect(() => {
    if (draftLoadedRef.current) return
    draftLoadedRef.current = true
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const draft = JSON.parse(raw)
      if (draft.form) setForm(draft.form)
      if (draft.acknowledgements) {
        setAcknowledgements({ ...DEFAULT_ACKNOWLEDGEMENTS, ...draft.acknowledgements })
      }
      if (draft.eeoSurvey) setEeoSurvey(normalizeEeoSurvey(draft.eeoSurvey))
      if (draft.resumeUrl) setResumeUrl(draft.resumeUrl)
      if (draft.resumeFileName) setResumeFileName(draft.resumeFileName)
      if (draft.resumeSkipped) setResumeSkipped(true)
      if (draft.videoResponses) setVideoResponses(draft.videoResponses)
      if (draft.textResponses) setTextResponses(draft.textResponses)
      if (typeof draft.currentQuestion === 'number') setCurrentQuestion(draft.currentQuestion)
      if (draft.step && STEPS.includes(draft.step) && draft.step !== 'submitting') setStep(draft.step)
      if (draft.form?.firstName || draft.resumeUrl || draft.resumeSkipped || Object.keys(draft.videoResponses || {}).length > 0) {
        setDraftRestored(true)
      }
    } catch (err) {
      console.warn('Failed to restore draft:', err)
    } finally {
      // Defer flipping the "ready to save" flag to the next tick so any
      // setState calls above get committed first.
      setTimeout(() => setDraftLoaded(true), 0)
    }
  }, [draftKey])

  // Persist draft on any meaningful change. We intentionally don't store
  // binary blobs — just storage paths and primitive form fields — so the
  // draft stays well under localStorage's 5MB budget.
  useEffect(() => {
    if (!draftLoaded) return
    if (step === 'submitting') return
    try {
      const draft = {
        candidateId,
        form,
        acknowledgements,
        eeoSurvey,
        resumeUrl,
        resumeFileName,
        resumeSkipped,
        videoResponses,
        textResponses,
        currentQuestion,
        step,
        savedAt: Date.now()
      }
      localStorage.setItem(draftKey, JSON.stringify(draft))
    } catch {
      /* quota errors are non-fatal — the candidate just loses resume-on-reload */
    }
  }, [draftLoaded, candidateId, form, acknowledgements, eeoSurvey, resumeUrl, resumeFileName, resumeSkipped, videoResponses, textResponses, currentQuestion, step, draftKey])

  useEffect(() => {
    async function loadQuestions(roleKey) {
      try {
        const qSnap = await getDocs(
          query(collection(db, 'interviewQuestions'), where('active', '==', true), orderBy('order', 'asc'))
        )
        const allQuestions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        setQuestions(allQuestions.filter(
          q => q.active !== false && (q.roleKey === 'all' || q.roleKey === roleKey)
        ))
      } catch (err) {
        console.warn('Failed to load questions from Firestore, using empty set:', err)
        setQuestions([])
      }
    }

    async function loadJob() {
      try {
        const snap = await getDoc(doc(db, 'jobs', jobId))
        if (!snap.exists()) { navigate('/jobs'); return }
        const jobData = { id: snap.id, ...snap.data() }
        setJob(jobData)
        await loadQuestions(jobData.roleKey)
      } catch {
        navigate('/jobs')
      } finally {
        setLoading(false)
      }
    }

    async function loadInvite() {
      try {
        const getInviteSession = httpsCallable(functions, 'getInviteSession')
        const { data } = await getInviteSession({ code })
        if (data.alreadySubmitted) {
          if (data.statusToken) { navigate(`/status/${data.statusToken}`); return }
          setInviteError('This interview was already submitted.')
          return
        }
        setInvite(data)
        setCandidateId(data.candidateId)
        setForm({ firstName: data.firstName, lastName: data.lastName, email: data.email, phone: data.phone })
        // The job doc may not be publicly readable (e.g. paused) — the session
        // carries everything the interview needs.
        setJob({
          id: data.jobId,
          title: data.jobTitle,
          roleKey: data.roleKey,
          clientName: data.clientName,
          location: data.location,
        })
        await loadQuestions(data.roleKey)
      } catch (err) {
        console.warn('Invite session failed:', err)
        setInviteError(
          err?.code === 'functions/not-found' || err?.message?.includes('not recognized')
            ? 'That interview code was not recognized.'
            : 'We could not load your interview. Please try again in a moment.'
        )
      } finally {
        setLoading(false)
      }
    }

    if (inviteMode) loadInvite()
    else loadJob()
  }, [jobId, code, inviteMode, navigate])

  // Start silent timer whenever question changes
  useEffect(() => {
    if (step === 'interview' && questions.length > 0) {
      const now = Date.now()
      setQuestionStartTime(now)
      setHardTimerExpired(false)
      setHardTimerWarned(false)

      const q = questions[currentQuestion]
      if (q?.timerType === 'hard' && q.timerSeconds > 0) {
        setHardTimerRemaining(q.timerSeconds)
      } else {
        setHardTimerRemaining(null)
      }
      if (q?.timerType === 'soft' && q.timerSeconds > 0) {
        setSoftTimerRemaining(q.timerSeconds)
      } else {
        setSoftTimerRemaining(null)
      }
    }
  }, [currentQuestion, step, questions])

  // Hard timer countdown — also fires a one-time "30s remaining" warning so
  // candidates aren't blindsided by auto-submit on short hard timers.
  useEffect(() => {
    if (hardTimerRemaining === null || hardTimerRemaining <= 0) return
    const interval = setInterval(() => {
      setHardTimerRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          setHardTimerExpired(true)
          return 0
        }
        // Threshold depends on total timer — 30s warning on longer timers,
        // 10s on short ones so we don't warn at the same instant we start.
        const origSec = questions[currentQuestion]?.timerSeconds || 0
        const warnAt = origSec >= 60 ? 30 : origSec >= 30 ? 10 : 5
        if (prev - 1 === warnAt && !hardTimerWarned) {
          setHardTimerWarned(true)
          try {
            // Soft audible cue — safe-guarded; some browsers block autoplay.
            const ctx = new (window.AudioContext || window.webkitAudioContext)()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            gain.gain.value = 0.08
            osc.frequency.value = 880
            osc.connect(gain).connect(ctx.destination)
            osc.start()
            setTimeout(() => { osc.stop(); ctx.close() }, 200)
          } catch { /* audio not critical */ }
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [hardTimerRemaining !== null && currentQuestion])

  // Soft timer countdown
  useEffect(() => {
    if (softTimerRemaining === null || softTimerRemaining <= 0) return
    const interval = setInterval(() => {
      setSoftTimerRemaining(prev => {
        if (prev <= 1) { clearInterval(interval); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [softTimerRemaining !== null && currentQuestion])

  // Auto-submit on hard timer expiry
  useEffect(() => {
    if (hardTimerExpired && step === 'interview') {
      // Record timing then advance
      recordTiming()
      advanceQuestion(videoResponses, textResponses)
    }
  }, [hardTimerExpired])

  const recordTiming = () => {
    if (questionStartTime) {
      const elapsed = Math.round((Date.now() - questionStartTime) / 1000)
      setTimingData(prev => ({ ...prev, [currentQuestion]: elapsed }))
    }
  }

  const formatTimer = (s) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`
  }

  const validateInfo = () => {
    const errors = {}
    if (!form.firstName.trim()) errors.firstName = 'Required'
    if (!form.lastName.trim()) errors.lastName = 'Required'
    if (!form.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) errors.email = 'Valid email required'
    if (!form.phone.match(/^\+?[\d\s\-().]{10,}$/)) errors.phone = 'Valid phone required'
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleInfoNext = () => {
    if (validateInfo()) setStep('resume')
  }

  const handleResumeUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const contentType = file.type || inferResumeContentType(file.name)
    const allowedTypes = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ])
    if (!allowedTypes.has(contentType)) { alert('Unsupported file type. Please upload a PDF, DOC, or DOCX resume.'); return }
    if (file.size > 10 * 1024 * 1024) { alert('File too large. Maximum 10MB.'); return }
    setResumeFile(file)
    setResumeFileName(file.name)
    setResumeUrl(null)
    setResumeSkipped(false)
    setResumeUploading(true)
    setResumeProgress(0)
    try {
      const resumeRef = ref(storage, `resumes/${candidateId}/${file.name}`)
      const uploadTask = uploadBytesResumable(resumeRef, file, { contentType })
      await new Promise((resolve, reject) => {
        uploadTask.on('state_changed',
          (snapshot) => setResumeProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
          reject, resolve
        )
      })
      setResumeUrl(`resumes/${candidateId}/${file.name}`)
    } catch (err) {
      console.error('Resume upload failed:', err)
      alert('Upload failed. Please try again.')
      setResumeFile(null)
      setResumeFileName(null)
      setResumeUrl(null)
    } finally {
      setResumeUploading(false)
    }
  }

  const clearDraft = () => {
    try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
  }

  const discardDraft = () => {
    clearDraft()
    window.location.reload()
  }

  const handleResumeNext = () => {
    if (resumeUploading) { alert('Resume is still uploading. Please wait.'); return }
    if (!resumeUrl && !resumeSkipped) { alert('Please upload your resume or skip this step to continue.'); return }
    setStep('compliance')
  }

  const handleResumeSkip = () => {
    if (resumeUploading) return
    setResumeFile(null)
    setResumeFileName(null)
    setResumeUrl(null)
    setResumeProgress(0)
    setResumeSkipped(true)
    setStep('compliance')
  }

  const handleComplianceNext = () => {
    if (!allRequiredAcknowledgementsAccepted(acknowledgements)) {
      setComplianceErrors({ acknowledgements: 'Please review and accept each required acknowledgement to continue.' })
      return
    }

    setComplianceErrors({})
    // If no questions are configured, submit after the required compliance notice.
    if (questions.length === 0) {
      handleSubmit({}, {})
      return
    }
    setStep('interview')
  }

  const toggleAcknowledgement = (key) => {
    setComplianceErrors({})
    setAcknowledgements(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const updateEeoSurvey = (field, value) => {
    setEeoSurvey(prev => ({ ...prev, [field]: value }))
  }

  const currentQ = questions[currentQuestion]

  const handleVideoComplete = (path, _blob) => {
    recordTiming()
    const updated = { ...videoResponses, [currentQuestion]: path }
    setVideoResponses(updated)
    advanceQuestion(updated, textResponses)
  }

  const handleTextSubmit = () => {
    if (!textResponses[currentQuestion]?.trim()) return
    recordTiming()
    advanceQuestion(videoResponses, textResponses)
  }

  const advanceQuestion = (vids, texts) => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(q => q + 1)
    } else {
      handleSubmit(vids, texts)
    }
  }

  // Invite-mode submission: responses AND compliance/EEO records all go
  // through a single Cloud Function that flips the candidate from 'invited'
  // to 'applied' atomically — safe to retry after a network failure.
  const submitInvite = async (questionMap, finalVideoResponses, finalTextResponses) => {
    const submitInvitedInterview = httpsCallable(functions, 'submitInvitedInterview')
    const { data } = await submitInvitedInterview({
      code,
      videoResponses: finalVideoResponses,
      textResponses: finalTextResponses,
      questions: questionMap,
      timingData,
      selectionProcessVersion: SELECTION_PROCESS_VERSION,
      complianceNoticeVersion: COMPLIANCE_NOTICE_VERSION,
      eeoSurveyVersion: EEO_SURVEY_VERSION,
      parentOrgDisplayName: PARENT_ORG_DISPLAY_NAME,
      renderedNoticeText: buildRenderedSelectionNoticeText(job.title),
      userAgent: (window.navigator?.userAgent || 'unknown').slice(0, 600),
      acknowledgements,
      eeoSurvey: normalizeEeoSurvey(eeoSurvey),
    })
    clearDraft()
    navigate(data.statusToken ? `/thank-you?token=${data.statusToken}` : '/thank-you')
  }

  const handleSubmit = async (finalVideoResponses, finalTextResponses) => {
    if (!allRequiredAcknowledgementsAccepted(acknowledgements)) {
      setStep('compliance')
      setComplianceErrors({ acknowledgements: 'Please review and accept each required acknowledgement to continue.' })
      return
    }

    setStep('submitting')
    try {
      // Build question map for storage
      const questionMap = {}
      questions.forEach((q, i) => {
        questionMap[i] = { questionId: q.id, text: q.text, type: q.type, category: q.category }
      })

      if (inviteMode) {
        await submitInvite(questionMap, finalVideoResponses || videoResponses, finalTextResponses || textResponses)
        return
      }

      // Status portal token — lets the candidate check their application
      // status later without needing an account.
      const statusToken = uuidv4()
      const candidateRef = doc(db, 'candidates', candidateId)
      const complianceRef = doc(db, 'candidateCompliance', candidateId)
      const eeoResponseRef = doc(db, 'eeoResponses', candidateId)
      const normalizedEeoSurvey = normalizeEeoSurvey(eeoSurvey)
      const clientName = getJobClientName(job)
      const jobLocation = getJobLocation(job)
      const renderedNoticeText = buildRenderedSelectionNoticeText(job.title)
      const renderedTextHash = await sha256Hex(renderedNoticeText)
      const checkedAcknowledgementIds = REQUIRED_ACKNOWLEDGEMENTS.map((item) => item.key)
      const batch = writeBatch(db)

      batch.set(candidateRef, {
        candidateId,
        ...form,
        jobId: job.id,
        jobTitle: job.title,
        roleKey: job.roleKey,
        clientName,
        organizationName: clientName,
        location: jobLocation,
        stage: 'applied',
        resumeUrl: resumeSkipped ? null : resumeUrl,
        resumeSkipped,
        selectionProcessVersion: SELECTION_PROCESS_VERSION,
        complianceNoticeVersion: COMPLIANCE_NOTICE_VERSION,
        complianceAcknowledgedAt: serverTimestamp(),
        videoResponses: finalVideoResponses || videoResponses,
        textResponses: finalTextResponses || textResponses,
        questions: questionMap,
        timingData,
        statusToken,
        compositeScore: null,
        resumeScore: null,
        interviewScore: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })

      batch.set(complianceRef, {
        candidateId,
        jobId: job.id,
        jobTitle: job.title,
        roleKey: job.roleKey,
        selectionProcessVersion: SELECTION_PROCESS_VERSION,
        complianceNoticeVersion: COMPLIANCE_NOTICE_VERSION,
        eeoSurveyVersion: EEO_SURVEY_VERSION,
        employerDisplayName: clientName,
        parentOrgDisplayName: PARENT_ORG_DISPLAY_NAME,
        renderedTextHash,
        renderedNoticeText,
        checkedAcknowledgementIds,
        userAgent: (window.navigator?.userAgent || 'unknown').slice(0, 600),
        acknowledgements: {
          ...acknowledgements,
          acceptedAt: serverTimestamp(),
        },
        createdAt: serverTimestamp()
      })

      if (normalizedEeoSurvey.optedIn) {
        batch.set(eeoResponseRef, {
          candidateId,
          jobId: job.id,
          jobTitle: job.title,
          roleKey: job.roleKey,
          employerDisplayName: clientName,
          parentOrgDisplayName: PARENT_ORG_DISPLAY_NAME,
          eeoSurveyVersion: EEO_SURVEY_VERSION,
          eeoSurvey: normalizedEeoSurvey,
          createdAt: serverTimestamp()
        })
      }

      await batch.commit()
      clearDraft()
      navigate(`/thank-you?token=${statusToken}`)
    } catch (err) {
      console.error('Submission failed:', err)
      const detail = err?.message ? ` (${err.message})` : ''
      alert(`Submission failed. Please try again.${detail}`)
      setStep(questions.length === 0 ? 'compliance' : 'interview')
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (inviteError) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 max-w-sm text-center space-y-4">
        <p className="text-gray-900 font-semibold">We couldn't open your interview</p>
        <p className="text-sm text-gray-500">{inviteError}</p>
        <button onClick={() => navigate('/')} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-6 py-2.5 rounded-xl">
          Re-enter your code
        </button>
      </div>
    </div>
  )

  const activeSteps = inviteMode ? ['compliance', 'interview', 'submitting'] : STEPS
  const stepIndex = activeSteps.indexOf(step)
  const progress = (stepIndex / (activeSteps.length - 1)) * 100
  const requiredAcknowledgementsAccepted = allRequiredAcknowledgementsAccepted(acknowledgements)
  const jobClientName = getJobClientName(job || {})
  const employerDisplayWithParent = PARENT_ORG_DISPLAY_NAME
    ? `${jobClientName}, part of ${PARENT_ORG_DISPLAY_NAME}`
    : jobClientName
  const accommodationContact = [
    ACCOMMODATION_EMAIL && (
      <a key="email" className="font-medium underline" href={`mailto:${ACCOMMODATION_EMAIL}`}>{ACCOMMODATION_EMAIL}</a>
    ),
    ACCOMMODATION_PHONE && (
      <a key="phone" className="font-medium underline" href={`tel:${ACCOMMODATION_PHONE}`}>{ACCOMMODATION_PHONE}</a>
    ),
  ].filter(Boolean)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Google for Jobs structured data — public applications only; invite
          pages are private and must not be indexed as job postings. */}
      {!inviteMode && job && <JobPostingSchema job={job} />}
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">{getInitials(jobClientName)}</span>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{jobClientName}</p>
            <p className="text-xs text-gray-500">Application - {job?.title}</p>
          </div>
        </div>
      </div>

      {/* Progress */}
      {step !== 'submitting' && (
        <div className="bg-white border-b border-gray-100">
          <div className="max-w-2xl mx-auto px-4 py-3">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              {!inviteMode && <span className={step === 'info' ? 'text-blue-600 font-medium' : ''}>Your info</span>}
              {!inviteMode && <span className={step === 'resume' ? 'text-blue-600 font-medium' : ''}>Resume</span>}
              <span className={step === 'compliance' ? 'text-blue-600 font-medium' : ''}>Process</span>
              <span className={step === 'interview' ? 'text-blue-600 font-medium' : ''}>
                Interview {step === 'interview' ? `(${currentQuestion + 1}/${questions.length})` : ''}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Draft restored banner */}
        {draftRestored && step !== 'submitting' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-amber-900">We picked up where you left off</p>
              <p className="text-xs text-amber-700 mt-0.5">Your answers were saved to this device. You can keep going or start over.</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setDraftRestored(false)} className="text-xs font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg">Continue</button>
              <button onClick={discardDraft} className="text-xs font-medium text-gray-600 hover:text-gray-900">Start over</button>
            </div>
          </div>
        )}

        {/* Step 1: Personal info */}
        {step === 'info' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Let's get started</h1>
              <p className="text-sm text-gray-500 mt-1">Tell us a bit about yourself</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {['firstName', 'lastName'].map(field => (
                <div key={field}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field === 'firstName' ? 'First name' : 'Last name'}
                  </label>
                  <input type="text" value={form[field]}
                    onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors[field] ? 'border-red-400' : 'border-gray-300'}`} />
                  {formErrors[field] && <p className="text-xs text-red-500 mt-1">{formErrors[field]}</p>}
                </div>
              ))}
            </div>
            {['email', 'phone'].map(field => (
              <div key={field}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {field === 'email' ? 'Email address' : 'Phone number'}
                </label>
                <input type={field === 'email' ? 'email' : 'tel'} value={form[field]}
                  onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${formErrors[field] ? 'border-red-400' : 'border-gray-300'}`} />
                {formErrors[field] && <p className="text-xs text-red-500 mt-1">{formErrors[field]}</p>}
              </div>
            ))}
            <button onClick={handleInfoNext}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl transition-colors">
              Continue
            </button>
          </div>
        )}

        {/* Step 2: Resume */}
        {step === 'resume' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Upload your resume</h2>
              <p className="text-sm text-gray-500 mt-1">PDF or Word doc, max 10MB. You can skip this step if you do not have one ready.</p>
            </div>
            <label className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${resumeUrl ? 'border-green-400 bg-green-50' : resumeUploading ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}`}>
              <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleResumeUpload} className="hidden" disabled={resumeUploading} />
              {resumeUploading ? (
                <div className="space-y-2">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-sm font-medium text-blue-700">Uploading {resumeFile?.name}...</p>
                  <div className="w-48 h-2 bg-blue-100 rounded-full mx-auto overflow-hidden">
                    <div className="h-full bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${resumeProgress}%` }} />
                  </div>
                  <p className="text-xs text-blue-500">{resumeProgress}%</p>
                </div>
              ) : resumeUrl ? (
                <div className="space-y-1">
                  <div className="text-green-600 text-2xl">&#10003;</div>
                  <p className="text-sm font-medium text-green-700">{resumeFileName || resumeFile?.name || 'Resume uploaded'}</p>
                  <p className="text-xs text-green-600">Click to replace</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-gray-400 text-2xl">&#8593;</div>
                  <p className="text-sm font-medium text-gray-600">Click to upload</p>
                  <p className="text-xs text-gray-400">PDF, DOC, DOCX</p>
                </div>
              )}
            </label>
            {resumeSkipped && !resumeUrl && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Resume upload skipped. You can still upload one before continuing.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button onClick={() => setStep('info')} className="border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-3 rounded-xl transition-colors">Back</button>
              <button onClick={handleResumeSkip} disabled={resumeUploading} className="border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium py-3 rounded-xl transition-colors">Skip resume</button>
              <button onClick={handleResumeNext} disabled={resumeUploading || (!resumeUrl && !resumeSkipped)} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors">
                {resumeUploading ? 'Uploading...' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Process notice */}
        {step === 'compliance' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
            {inviteMode && invite && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-blue-950">Welcome, {invite.firstName}!</p>
                  <p className="text-xs text-blue-800 mt-0.5">
                    You're interviewing for {invite.jobTitle} with {invite.clientName}.
                  </p>
                </div>
                {invite.resumeOnFile && (
                  <span className="shrink-0 text-[11px] font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">Resume on file &#10003;</span>
                )}
              </div>
            )}
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Review the selection process</h1>
              <p className="text-sm text-gray-500 mt-1">
                Please review these notices before starting your interview for {job?.title} with {employerDisplayWithParent}.
              </p>
            </div>

            <div className="border border-blue-100 bg-blue-50 rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-blue-950">How your application is reviewed</p>
              <ul id="selection-process-details" className="list-disc pl-5 text-sm text-blue-900 space-y-1">
                <li>Your application materials and interview responses are reviewed against job-related requirements for this role.</li>
                <li>{getTechnologyCapabilitySentence()}</li>
                {getRecordingNotice() && <li>{getRecordingNotice()}</li>}
                <li>The technology does not make final hiring decisions. Human reviewers for {jobClientName} remain responsible for selection decisions.</li>
                <li>Optional EEO information, if you choose to provide it, is stored separately, hidden from hiring reviewers, and not used to evaluate your application.</li>
                <li>Please avoid including non-job-related medical, disability, genetic information, family medical history, or other protected personal details in your resume or interview responses. This does not limit your right to request a reasonable accommodation.</li>
              </ul>
            </div>

            <div id="accommodation-notice" className="border border-gray-200 rounded-xl p-4 text-sm text-gray-700">
              <p>
                <span className="font-semibold text-gray-900">Need an accommodation?</span>{' '}
                To request a reasonable accommodation for the application or interview process, contact{' '}
                {accommodationContact.map((item, index) => (
                  <span key={item.key || index}>
                    {index > 0 ? ' or ' : ''}{item}
                  </span>
                ))}
                . Accommodation requests are handled separately from interview scoring and will not negatively affect your application.
              </p>
            </div>

            <fieldset className="space-y-3" aria-describedby="selection-process-details accommodation-notice">
              <legend className="text-sm font-semibold text-gray-900">Required acknowledgements</legend>
              {REQUIRED_ACKNOWLEDGEMENTS.map((item) => (
                <label key={item.key} htmlFor={item.key} className="flex items-start gap-3 border border-gray-200 rounded-xl p-3 cursor-pointer hover:bg-gray-50">
                  <input
                    id={item.key}
                    type="checkbox"
                    checked={acknowledgements[item.key]}
                    onChange={() => toggleAcknowledgement(item.key)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{item.label}</span>
                </label>
              ))}
              {complianceErrors.acknowledgements && (
                <p className="text-xs text-red-600">{complianceErrors.acknowledgements}</p>
              )}
            </fieldset>

            <fieldset className="border border-gray-200 rounded-xl p-4 space-y-4">
              <legend className="text-sm font-semibold text-gray-900 px-1">Optional EEO information</legend>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p id="eeo-help" className="text-xs text-gray-500 mt-1">
                    Sharing this information is voluntary. You may choose "Prefer not to answer." Your choices will not affect your application or interview. This information is stored separately from your application materials, hidden from hiring reviewers, and used only for aggregate EEO/compliance monitoring.
                  </p>
                </div>
                <label htmlFor="eeo-opt-in" className="inline-flex items-center gap-2 text-sm text-gray-700 shrink-0">
                  <input
                    id="eeo-opt-in"
                    type="checkbox"
                    checked={eeoSurvey.optedIn}
                    onChange={(e) => setEeoSurvey(e.target.checked ? { ...DEFAULT_EEO_SURVEY, optedIn: true } : { ...DEFAULT_EEO_SURVEY })}
                    aria-describedby="eeo-help"
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  I voluntarily choose to provide optional EEO information.
                </label>
              </div>

              {eeoSurvey.optedIn && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <EeoSelect label="Gender" value={eeoSurvey.gender} options={EEO_OPTIONS.gender} onChange={(value) => updateEeoSurvey('gender', value)} />
                  <EeoSelect label="Race/ethnicity" value={eeoSurvey.raceEthnicity} options={EEO_OPTIONS.raceEthnicity} onChange={(value) => updateEeoSurvey('raceEthnicity', value)} />
                </div>
              )}
            </fieldset>

            <p className="text-xs text-gray-500">
              By continuing, you acknowledge the notices above. See our{' '}
              <a className="font-medium text-blue-700 underline" href={APPLICANT_PRIVACY_URL} target="_blank" rel="noreferrer">
                Applicant Privacy Notice
              </a>{' '}
              for how application and interview data are processed, retained, and shared.
            </p>

            <div className="flex gap-3">
              {!inviteMode && (
                <button onClick={() => setStep('resume')} className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-3 rounded-xl transition-colors">Back</button>
              )}
              <button
                onClick={handleComplianceNext}
                disabled={!requiredAcknowledgementsAccepted}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors"
              >
                {questions.length === 0 ? 'Submit Application' : 'Start Interview'}
              </button>
            </div>
          </div>
        )}

        {/* Total time guidance + full question map — shown once at start of interview */}
        {step === 'interview' && currentQuestion === 0 && !videoResponses[0] && !textResponses[0] && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-3">
            <div>
              <p className="font-semibold">Here's what's coming</p>
              <p className="text-xs text-blue-700 mt-0.5">
                {questions.length} questions · about {Math.max(5, Math.round(questions.reduce((s, q) => s + summarizeQuestionTime(q), 0) / 60))} minutes total.
                A few are timed — you'll see a countdown when they start.
              </p>
            </div>
            <ol className="text-xs text-blue-900 space-y-1 list-decimal list-inside max-h-40 overflow-y-auto">
              {questions.map((q, i) => {
                const typeLabel = q.type === 'video_reading' ? 'Script reading'
                  : q.type === 'text_response' ? 'Written'
                  : 'Video'
                const timerLabel = q.timerType === 'hard' ? ` · ${q.timerSeconds}s timer` : q.timerType === 'soft' ? ` · ~${q.timerSeconds}s suggested` : ''
                return (
                  <li key={q.id || i} className="truncate">
                    <span className="font-medium">{typeLabel}</span>{timerLabel}
                  </li>
                )
              })}
            </ol>
          </div>
        )}

        {/* Offline banner — visible anywhere during the apply flow */}
        {step !== 'submitting' && <OfflineBanner />}

        {/* Aggregate upload progress during interview */}
        {step === 'interview' && Object.keys(videoUploadProgress).length > 0 && (() => {
          const entries = Object.entries(videoUploadProgress)
          const done = entries.filter(([, p]) => p >= 100).length
          const avg = Math.round(entries.reduce((s, [, p]) => s + p, 0) / entries.length)
          const active = entries.find(([, p]) => p > 0 && p < 100)
          if (done === entries.length && !active) return null
          return (
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-gray-700">Saving your recordings</p>
                <p className="text-xs text-gray-500">{done}/{entries.length} uploaded</p>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-200" style={{ width: `${avg}%` }} />
              </div>
              {active && <p className="text-[11px] text-gray-400 mt-1">Keep this tab open while we upload your answer.</p>}
            </div>
          )
        })()}

        {/* Persistent per-question progress map during interview */}
        {step === 'interview' && questions.length > 0 && currentQuestion > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500">Interview progress</p>
              <p className="text-xs text-gray-400">{currentQuestion + 1} / {questions.length}</p>
            </div>
            <div className="flex gap-1">
              {questions.map((_, i) => {
                const answered = videoResponses[i] || textResponses[i]
                const isCurrent = i === currentQuestion
                return (
                  <div key={i}
                    className={`h-1.5 flex-1 rounded-full ${isCurrent ? 'bg-blue-500' : answered ? 'bg-green-400' : 'bg-gray-200'}`}
                    title={`Question ${i + 1}`}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* 30s hard timer warning toast */}
        {step === 'interview' && hardTimerWarned && hardTimerRemaining > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm text-amber-900 flex items-center gap-2 animate-pulse">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z" /></svg>
            <span>Heads up — {formatTimer(hardTimerRemaining)} left before this question auto-submits.</span>
          </div>
        )}

        {/* Device check — shown once before the first video-type question */}
        {step === 'interview' && currentQ && !deviceCheckPassed && currentQuestion === 0 &&
         (currentQ.type === 'video_response' || currentQ.type === 'video_reading') && (
          <DeviceCheck
            mode="video"
            onReady={() => setDeviceCheckPassed(true)}
            onSkip={() => setDeviceCheckPassed(true)}
          />
        )}

        {/* Step 3: Interview Questions */}
        {step === 'interview' && currentQ && (deviceCheckPassed || currentQuestion > 0 || (currentQ.type !== 'video_response' && currentQ.type !== 'video_reading')) && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Question {currentQuestion + 1} of {questions.length}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {currentQ.type === 'video_reading'
                    ? 'Please read the following script on camera clearly and confidently.'
                    : currentQ.type === 'text_response'
                    ? 'Please type your answer below.'
                    : 'Record a video response — take your time, up to 3 minutes.'}
                </p>
              </div>
              {/* Hard timer badge */}
              {currentQ.timerType === 'hard' && hardTimerRemaining !== null && (
                <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full font-mono text-sm font-semibold ${
                  hardTimerRemaining <= 10 ? 'bg-red-100 text-red-700 animate-pulse' : hardTimerRemaining <= 20 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {formatTimer(hardTimerRemaining)}
                </div>
              )}
              {/* Soft timer badge */}
              {currentQ.timerType === 'soft' && softTimerRemaining !== null && (
                <div className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                  softTimerRemaining <= 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-50 text-gray-500'
                }`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {softTimerRemaining > 0 ? `~${formatTimer(softTimerRemaining)} suggested` : 'Take your time'}
                </div>
              )}
            </div>

            {/* Question text */}
            <div className={`border rounded-xl p-4 ${currentQ.type === 'video_reading' ? 'bg-purple-50 border-purple-200' : 'bg-blue-50 border-blue-100'}`}>
              {currentQ.type === 'video_reading' && (
                <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-2">Read this on camera:</p>
              )}
              <p className={`font-medium text-sm leading-relaxed ${currentQ.type === 'video_reading' ? 'text-purple-900 text-base' : 'text-blue-900'}`}>
                {currentQ.text}
              </p>
            </div>

            {/* Video response or video reading */}
            {(currentQ.type === 'video_response' || currentQ.type === 'video_reading') && (
              <>
                {videoResponses[currentQuestion] && (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-700 flex items-center gap-2">
                    <span>&#10003;</span> Answer recorded — you can re-record below
                  </div>
                )}
                <VideoRecorder
                  key={currentQuestion}
                  candidateId={candidateId}
                  questionIndex={currentQuestion}
                  mode="video"
                  onComplete={handleVideoComplete}
                  onUploadProgress={(qi, pct) => setVideoUploadProgress(prev => ({ ...prev, [qi]: pct }))}
                />
              </>
            )}

            {/* Text response */}
            {currentQ.type === 'text_response' && (
              <div className="space-y-3">
                {hardTimerExpired && currentQ.timerType === 'hard' ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 text-center font-medium">
                    Time's up — moving to next question...
                  </div>
                ) : (
                  <>
                    <textarea
                      value={textResponses[currentQuestion] || ''}
                      onChange={(e) => setTextResponses(prev => ({ ...prev, [currentQuestion]: e.target.value }))}
                      rows={currentQ.category === 'communication' ? 8 : 5}
                      placeholder="Type your answer here..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleTextSubmit}
                      disabled={!textResponses[currentQuestion]?.trim()}
                      className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
                    >
                      {currentQuestion < questions.length - 1 ? 'Submit & Next Question' : 'Submit & Finish'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* No questions configured */}
        {step === 'interview' && questions.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center space-y-3">
            <p className="text-gray-500">No interview questions are configured for this role yet.</p>
            <button onClick={() => handleSubmit({}, {})}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-8 rounded-xl">
              Submit Application
            </button>
          </div>
        )}

        {/* Submitting */}
        {step === 'submitting' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center space-y-4">
            <div className="w-10 h-10 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-gray-600 font-medium">Submitting your application...</p>
            <p className="text-sm text-gray-400">This only takes a moment</p>
          </div>
        )}
      </div>
    </div>
  )
}

function EeoSelect({ label, value, options, onChange }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  if (online) return null
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm text-amber-900 flex items-center gap-2">
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636L5.636 18.364m0-12.728l12.728 12.728" /></svg>
      <span>You're offline. Don't worry — your answers are saved locally and will upload once you're back online.</span>
    </div>
  )
}
