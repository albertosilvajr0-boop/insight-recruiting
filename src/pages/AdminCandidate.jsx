import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { ref, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../firebase'
import { format } from 'date-fns'

const STAGE_LABELS = {
  applied: 'Applied', screening: 'Screening', interview_2: 'Review needed',
  scheduling: 'Scheduling', scheduled: 'Scheduled', rejected: 'Rejected', hired: 'Hired'
}
const STAGE_COLORS = {
  applied: 'bg-blue-100 text-blue-800', screening: 'bg-yellow-100 text-yellow-800',
  interview_2: 'bg-red-100 text-red-800', scheduling: 'bg-purple-100 text-purple-800',
  scheduled: 'bg-green-100 text-green-800', rejected: 'bg-gray-100 text-gray-600',
  hired: 'bg-emerald-100 text-emerald-800'
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
  const [rating, setRating] = useState(0)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'candidates', candidateId))
        if (!snap.exists()) { navigate('/admin/dashboard'); return }
        const data = { id: snap.id, ...snap.data() }
        setCandidate(data)
        setNotes(data.adminNotes || '')
        setRating(data.hiringManagerRating || 0)

        // Get resume download URL
        if (data.resumeUrl) {
          try {
            const url = await getDownloadURL(ref(storage, data.resumeUrl))
            setResumeDownloadUrl(url)
          } catch { /* resume may not exist */ }
        }

        // Get video URLs for each response
        if (data.videoResponses) {
          const urls = {}
          for (const [qIndex, path] of Object.entries(data.videoResponses)) {
            if (path && !path.startsWith('skipped')) {
              try {
                const url = await getDownloadURL(ref(storage, path))
                urls[qIndex] = url
              } catch { /* video may not exist */ }
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

  const updateStage = async (newStage) => {
    setActionLoading(true)
    try {
      await updateDoc(doc(db, 'candidates', candidateId), {
        stage: newStage,
        updatedAt: serverTimestamp()
      })
      setCandidate(c => ({ ...c, stage: newStage }))
    } catch (err) {
      alert('Failed to update stage: ' + err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const saveNotes = async () => {
    setSavingNotes(true)
    try {
      await updateDoc(doc(db, 'candidates', candidateId), {
        adminNotes: notes,
        updatedAt: serverTimestamp()
      })
    } catch (err) {
      alert('Failed to save notes: ' + err.message)
    } finally {
      setSavingNotes(false)
    }
  }

  const saveRating = async (r) => {
    setRating(r)
    await updateDoc(doc(db, 'candidates', candidateId), {
      hiringManagerRating: r,
      updatedAt: serverTimestamp()
    })
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!candidate) return null

  const scoreColor = (score) => {
    if (score == null) return 'text-gray-400'
    if (score >= 8) return 'text-green-600'
    if (score >= 5) return 'text-amber-600'
    return 'text-red-600'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/admin/dashboard')} className="text-sm text-gray-500 hover:text-gray-900">
              &larr; Back
            </button>
            <span className="text-sm font-medium text-gray-900">
              {candidate.firstName} {candidate.lastName}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STAGE_COLORS[candidate.stage] || 'bg-gray-100 text-gray-600'}`}>
              {STAGE_LABELS[candidate.stage] || candidate.stage}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {candidate.stage === 'interview_2' && (
              <>
                <button onClick={() => updateStage('scheduling')} disabled={actionLoading}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                  Advance to scheduling
                </button>
                <button onClick={() => updateStage('rejected')} disabled={actionLoading}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                  Reject
                </button>
              </>
            )}
            {candidate.stage === 'scheduled' && (
              <button onClick={() => updateStage('hired')} disabled={actionLoading}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
                Mark as hired
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Resume Score</p>
            <p className={`text-2xl font-semibold ${scoreColor(candidate.resumeScore)}`}>
              {candidate.resumeScore != null ? `${candidate.resumeScore}/10` : '—'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Interview Score</p>
            <p className={`text-2xl font-semibold ${scoreColor(candidate.interviewScore)}`}>
              {candidate.interviewScore != null ? `${candidate.interviewScore}/10` : '—'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Composite Score</p>
            <p className={`text-2xl font-semibold ${scoreColor(candidate.compositeScore)}`}>
              {candidate.compositeScore != null ? `${candidate.compositeScore.toFixed(1)}/10` : '—'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Applied</p>
            <p className="text-sm font-medium text-gray-900">
              {candidate.createdAt?.toDate ? format(candidate.createdAt.toDate(), 'MMM d, yyyy') : '—'}
            </p>
          </div>
        </div>

        {/* Contact + Job Info */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Contact Information</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Email:</span> <span className="text-gray-900 ml-1">{candidate.email}</span></div>
            <div><span className="text-gray-500">Phone:</span> <span className="text-gray-900 ml-1">{candidate.phone}</span></div>
            <div><span className="text-gray-500">Position:</span> <span className="text-gray-900 ml-1">{candidate.jobTitle}</span></div>
            <div><span className="text-gray-500">Dealership:</span> <span className="text-gray-900 ml-1">{candidate.dealership}</span></div>
          </div>
        </div>

        {/* Resume */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Resume</h2>
            {resumeDownloadUrl && (
              <a href={resumeDownloadUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline">
                Download resume
              </a>
            )}
          </div>
          {resumeDownloadUrl && (
            <iframe src={resumeDownloadUrl} className="w-full h-96 border border-gray-200 rounded-lg" title="Resume" />
          )}
        </div>

        {/* AI Analysis */}
        {(candidate.resumeAnalysis || candidate.interviewAnalysis) && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">AI Analysis</h2>
            {candidate.resumeAnalysis && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Resume Analysis</p>
                <p className="text-sm text-gray-700 leading-relaxed">{candidate.resumeAnalysis}</p>
              </div>
            )}
            {candidate.interviewAnalysis && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Interview Analysis</p>
                <p className="text-sm text-gray-700 leading-relaxed">{candidate.interviewAnalysis}</p>
              </div>
            )}
          </div>
        )}

        {/* Strengths & Concerns */}
        {((candidate.strengths?.length > 0) || (candidate.concerns?.length > 0)) && (
          <div className="grid grid-cols-2 gap-4">
            {candidate.strengths?.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-green-700 mb-3">Strengths</h3>
                <ul className="space-y-1.5">
                  {candidate.strengths.map((s, i) => (
                    <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-green-500 mt-0.5 shrink-0">+</span>{s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {candidate.concerns?.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <h3 className="text-sm font-semibold text-red-700 mb-3">Concerns</h3>
                <ul className="space-y-1.5">
                  {candidate.concerns.map((c, i) => (
                    <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-red-500 mt-0.5 shrink-0">-</span>{c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Video Responses */}
        {Object.keys(videoUrls).length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Video Responses</h2>
            {Object.entries(videoUrls).map(([qIndex, url]) => (
              <div key={qIndex}>
                <p className="text-xs font-medium text-gray-500 mb-2">Question {parseInt(qIndex) + 1}</p>
                <video controls src={url} className="w-full rounded-lg border border-gray-200" />
              </div>
            ))}
          </div>
        )}

        {/* Video Transcript */}
        {candidate.videoTranscript && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Interview Transcript</h2>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{candidate.videoTranscript}</p>
          </div>
        )}

        {/* Post-Interview Rating */}
        {(candidate.stage === 'scheduled' || candidate.stage === 'hired') && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Post-Interview Rating</h2>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(r => (
                <button key={r} onClick={() => saveRating(r)}
                  className={`w-10 h-10 rounded-lg text-lg transition-colors ${r <= rating ? 'bg-yellow-400 text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                  *
                </button>
              ))}
            </div>
            {rating > 0 && <p className="text-xs text-gray-500 mt-2">{rating}/5 stars</p>}
          </div>
        )}

        {/* Admin Notes */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Notes</h2>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Add notes about this candidate..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={saveNotes} disabled={savingNotes}
            className="mt-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {savingNotes ? 'Saving...' : 'Save notes'}
          </button>
        </div>
      </div>
    </div>
  )
}
