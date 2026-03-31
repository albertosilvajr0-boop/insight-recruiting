import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, addDoc, collection, query, where, orderBy, getDocs, serverTimestamp } from 'firebase/firestore'
import { ref, uploadBytesResumable } from 'firebase/storage'
import { v4 as uuidv4 } from 'uuid'
import { db, storage } from '../firebase'
import VideoRecorder from '../components/VideoRecorder'

const STEPS = ['info', 'resume', 'interview', 'submitting']

export default function Apply() {
  const { jobId } = useParams()
  const navigate = useNavigate()

  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState('info')
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [questions, setQuestions] = useState([])

  const [candidateId] = useState(() => uuidv4())
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [formErrors, setFormErrors] = useState({})
  const [resumeFile, setResumeFile] = useState(null)
  const [resumeUrl, setResumeUrl] = useState(null)
  const [resumeUploading, setResumeUploading] = useState(false)
  const [resumeProgress, setResumeProgress] = useState(0)
  const [videoResponses, setVideoResponses] = useState({})
  const [textResponses, setTextResponses] = useState({})

  useEffect(() => {
    async function loadJob() {
      try {
        const snap = await getDoc(doc(db, 'jobs', jobId))
        if (!snap.exists()) { navigate('/'); return }
        const jobData = { id: snap.id, ...snap.data() }
        setJob(jobData)

        // Load questions from Firestore for this role + universal
        try {
          const qSnap = await getDocs(
            query(collection(db, 'interviewQuestions'), orderBy('order', 'asc'))
          )
          const allQuestions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }))
          const roleQuestions = allQuestions.filter(
            q => q.active !== false && (q.roleKey === 'all' || q.roleKey === jobData.roleKey)
          )
          setQuestions(roleQuestions)
        } catch (err) {
          console.warn('Failed to load questions from Firestore, using empty set:', err)
          setQuestions([])
        }
      } catch {
        navigate('/')
      } finally {
        setLoading(false)
      }
    }
    loadJob()
  }, [jobId, navigate])

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
    if (file.size > 10 * 1024 * 1024) { alert('File too large. Maximum 10MB.'); return }
    setResumeFile(file)
    setResumeUrl(null)
    setResumeUploading(true)
    setResumeProgress(0)
    try {
      const resumeRef = ref(storage, `resumes/${candidateId}/${file.name}`)
      const uploadTask = uploadBytesResumable(resumeRef, file)
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
      setResumeUrl(null)
    } finally {
      setResumeUploading(false)
    }
  }

  const handleResumeNext = () => {
    if (resumeUploading) { alert('Resume is still uploading. Please wait.'); return }
    if (!resumeUrl) { alert('Please upload your resume to continue.'); return }
    setStep('interview')
  }

  const currentQ = questions[currentQuestion]

  const handleVideoComplete = (path, _blob) => {
    const updated = { ...videoResponses, [currentQuestion]: path }
    setVideoResponses(updated)
    advanceQuestion(updated, textResponses)
  }

  const handleTextSubmit = () => {
    if (!textResponses[currentQuestion]?.trim()) return
    advanceQuestion(videoResponses, textResponses)
  }

  const advanceQuestion = (vids, texts) => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(q => q + 1)
    } else {
      handleSubmit(vids, texts)
    }
  }

  const handleSubmit = async (finalVideoResponses, finalTextResponses) => {
    setStep('submitting')
    try {
      // Build question map for storage
      const questionMap = {}
      questions.forEach((q, i) => {
        questionMap[i] = { questionId: q.id, text: q.text, type: q.type, category: q.category }
      })

      await addDoc(collection(db, 'candidates'), {
        candidateId,
        ...form,
        jobId: job.id,
        jobTitle: job.title,
        roleKey: job.roleKey,
        dealership: 'San Antonio Dodge',
        stage: 'applied',
        resumeUrl,
        videoResponses: finalVideoResponses || videoResponses,
        textResponses: finalTextResponses || textResponses,
        questions: questionMap,
        compositeScore: null,
        resumeScore: null,
        interviewScore: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      navigate('/thank-you')
    } catch (err) {
      alert('Submission failed. Please try again.')
      setStep('interview')
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const stepIndex = STEPS.indexOf(step)
  const progress = ((stepIndex) / (STEPS.length - 1)) * 100

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">SA</span>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">San Antonio Dodge</p>
            <p className="text-xs text-gray-500">Application — {job?.title}</p>
          </div>
        </div>
      </div>

      {/* Progress */}
      {step !== 'submitting' && (
        <div className="bg-white border-b border-gray-100">
          <div className="max-w-2xl mx-auto px-4 py-3">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span className={step === 'info' ? 'text-blue-600 font-medium' : ''}>Your info</span>
              <span className={step === 'resume' ? 'text-blue-600 font-medium' : ''}>Resume</span>
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
              <p className="text-sm text-gray-500 mt-1">PDF or Word doc, max 10MB</p>
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
                  <p className="text-sm font-medium text-green-700">{resumeFile?.name}</p>
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
            <div className="flex gap-3">
              <button onClick={() => setStep('info')} className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-3 rounded-xl transition-colors">Back</button>
              <button onClick={handleResumeNext} disabled={resumeUploading || !resumeUrl} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors">
                {resumeUploading ? 'Uploading...' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Interview Questions */}
        {step === 'interview' && currentQ && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
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

            {/* Question text */}
            <div className={`border rounded-xl p-4 ${currentQ.type === 'video_reading' ? 'bg-purple-50 border-purple-200' : 'bg-blue-50 border-blue-100'}`}>
              {currentQ.type === 'video_reading' && (
                <p className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-2">Read this on camera:</p>
              )}
              <p className={`font-medium text-sm leading-relaxed ${currentQ.type === 'video_reading' ? 'text-purple-900 text-base' : 'text-blue-900'}`}>
                "{currentQ.text}"
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
                />
                <p className="text-xs text-center text-gray-400">
                  Having trouble recording?{' '}
                  <button className="underline text-gray-500" onClick={() => handleVideoComplete(`skipped_q${currentQuestion}`, null)}>Skip this question</button>
                </p>
              </>
            )}

            {/* Text response */}
            {currentQ.type === 'text_response' && (
              <div className="space-y-3">
                <textarea
                  value={textResponses[currentQuestion] || ''}
                  onChange={(e) => setTextResponses(prev => ({ ...prev, [currentQuestion]: e.target.value }))}
                  rows={5}
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
