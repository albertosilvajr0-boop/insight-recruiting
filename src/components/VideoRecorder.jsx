import { useRef, useEffect, useState, useCallback } from 'react'
import { ref, uploadBytesResumable } from 'firebase/storage'
import { storage } from '../firebase'
import useMediaRecorder from '../hooks/useMediaRecorder'

const MAX_DURATION = 180 // 3 minutes
const BACKDROP_PREF_KEY = 'insight_professional_backdrop_v1'

function formatTime(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function WaveformBar({ level, index, total }) {
  const height = Math.max(4, (level / 100) * 48 * Math.sin((index / total) * Math.PI + Date.now() / 300))
  return (
    <div
      className="bg-blue-500 rounded-full transition-all duration-75"
      style={{ width: 3, height: `${height}px`, minHeight: 4 }}
    />
  )
}

export default function VideoRecorder({ candidateId, questionIndex, onComplete, onUploadProgress, mode = 'video' }) {
  const videoPreviewRef = useRef(null)
  const [professionalBackdrop, setProfessionalBackdrop] = useState(() => {
    try { return localStorage.getItem(BACKDROP_PREF_KEY) === 'enabled' } catch { return false }
  })
  const [recorded, setRecorded] = useState(false)
  const [blob, setBlob] = useState(null)
  const [blobUrl, setBlobUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState(null)
  const [retakeCount, setRetakeCount] = useState(0)

  const {
    state, error, effectWarning, duration, audioLevel,
    stream, isSupported,
    requestPermissions, startRecording, stopRecording, releaseStream, reset
  } = useMediaRecorder({ mode, videoEffect: professionalBackdrop ? 'professional' : 'none' })

  // Attach stream to video preview — re-runs on stream change AND retake
  const attachStream = useCallback(() => {
    if (videoPreviewRef.current && stream && mode === 'video' && !recorded) {
      videoPreviewRef.current.srcObject = stream
    }
  }, [stream, mode, recorded])

  useEffect(() => {
    attachStream()
  }, [attachStream, retakeCount])

  // Also attach when the ref element appears (after switching from blob to live)
  const setVideoRef = useCallback((el) => {
    videoPreviewRef.current = el
    if (el && stream && mode === 'video') {
      el.srcObject = stream
    }
  }, [stream, mode])

  // Auto-stop at max duration
  useEffect(() => {
    if (state === 'recording' && duration >= MAX_DURATION) {
      handleStop()
    }
  }, [duration, state])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      releaseStream()
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [])

  const handleStart = async () => {
    setUploadError(null)
    if (state === 'idle') {
      const readyStream = await requestPermissions()
      if (!readyStream) return
    }
    await startRecording()
  }

  const handleBackdropToggle = () => {
    const enabled = !professionalBackdrop
    setProfessionalBackdrop(enabled)
    try { localStorage.setItem(BACKDROP_PREF_KEY, enabled ? 'enabled' : 'disabled') } catch { /* ignore */ }
    if (state === 'ready') {
      releaseStream()
      reset()
    }
  }

  const handleStop = async () => {
    const recordedBlob = await stopRecording()
    if (recordedBlob && recordedBlob.size > 0) {
      // Revoke old blob URL if exists
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      const url = URL.createObjectURL(recordedBlob)
      setBlob(recordedBlob)
      setBlobUrl(url)
      setRecorded(true)
    } else {
      setUploadError('Recording was empty. Please try again.')
    }
  }

  const handleRetake = async () => {
    // Clean up old blob
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    setBlob(null)
    setBlobUrl(null)
    setRecorded(false)
    setUploadError(null)
    setRetakeCount(c => c + 1)

    // Release old stream and get a fresh one
    releaseStream()
    reset()
    // Start fresh — request permissions again for a clean stream
    await requestPermissions()
  }

  const uploadBlobOnce = (storagePath, contentType) => {
    return new Promise((resolve, reject) => {
      const fileRef = ref(storage, storagePath)
      const uploadTask = uploadBytesResumable(fileRef, blob, contentType ? { contentType } : undefined)
      uploadTask.on('state_changed',
        (snapshot) => {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          setUploadProgress(pct)
          // Report upstream so parent can render an aggregate progress bar
          // that isn't wiped when the recorder unmounts between questions.
          try { onUploadProgress?.(questionIndex, pct, snapshot.bytesTransferred, snapshot.totalBytes) } catch { /* ignore */ }
        },
        (err) => reject(err),
        () => {
          try { onUploadProgress?.(questionIndex, 100, blob?.size || 0, blob?.size || 0) } catch { /* ignore */ }
          resolve()
        }
      )
    })
  }

  const handleSubmit = async () => {
    if (!blob) return
    setUploading(true)
    setUploadProgress(0)
    setUploadError(null)

    // Pick a file extension that matches what the browser actually recorded.
    // Safari records video/mp4; Chrome/Firefox record video/webm. Using the
    // correct extension avoids a mismatch between filename and Content-Type.
    const rawContentType = blob.type || 'video/webm'
    const contentType = rawContentType.includes('mp4') ? 'video/mp4' : 'video/webm'
    const ext = contentType.includes('mp4') ? 'mp4' : 'webm'
    const dirPath = `videos/${candidateId}_q${questionIndex}`
    const storagePath = `${dirPath}/recording.${ext}`

    // Retry several times on transient failures — mobile networks drop
    // connections constantly, and a single hiccup shouldn't force a retake.
    // We also wait for the network to come back if the device is offline,
    // which is the #1 cause of "upload failed" on parking-lot wifi.
    const MAX_ATTEMPTS = 5
    let lastErr = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // If the browser reports offline, wait for 'online' (up to 30s)
        // before trying — saves a guaranteed-fail attempt against the backoff.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          setUploadError('You appear to be offline — waiting for your connection to come back…')
          await new Promise(resolve => {
            const onOnline = () => { window.removeEventListener('online', onOnline); resolve() }
            window.addEventListener('online', onOnline)
            setTimeout(() => { window.removeEventListener('online', onOnline); resolve() }, 30_000)
          })
          setUploadError(null)
        }
        setUploadProgress(0)
        await uploadBlobOnce(storagePath, contentType)
        onComplete(dirPath, blob)
        return
      } catch (err) {
        lastErr = err
        console.error(`Video upload attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err)
        if (attempt < MAX_ATTEMPTS) {
          // Exponential backoff: 1s, 2s, 4s, 8s
          const delay = Math.min(8000, 1000 * Math.pow(2, attempt - 1))
          setUploadError(`Connection hiccup — retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${MAX_ATTEMPTS})`)
          await new Promise(r => setTimeout(r, delay))
          setUploadError(null)
        }
      }
    }

    // All retries exhausted — surface a specific message so the candidate
    // (and Alberto) knows what actually went wrong.
    const reason = lastErr?.code
      ? `${lastErr.code}${lastErr.message ? ' — ' + lastErr.message : ''}`
      : lastErr?.message || 'unknown error'
    setUploadError(
      `Upload failed after ${MAX_ATTEMPTS} attempts (${reason}). ` +
      `Check your internet connection and tap "Use This Recording" again — ` +
      `your recording is still saved here, you don't need to re-record.`
    )
    setUploading(false)
  }

  if (!isSupported) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        Your browser doesn't support recording. Please use Chrome, Firefox, or Edge.
      </div>
    )
  }

  const showRecordedPreview = recorded && blobUrl && mode === 'video'

  return (
    <div className="space-y-4">
      {/* Preview area */}
      {mode === 'video' && (
        <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video">
          {showRecordedPreview ? (
            <video
              key="playback"
              src={blobUrl}
              controls
              className="w-full h-full object-cover"
            />
          ) : (
            <video
              key={`live-${retakeCount}`}
              ref={setVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          )}

          {/* Recording indicator */}
          {state === 'recording' && (
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-white text-xs font-medium">{formatTime(duration)}</span>
              <span className="text-gray-400 text-xs">/ {formatTime(MAX_DURATION)}</span>
            </div>
          )}
        </div>
      )}

      {mode === 'video' && !recorded && state !== 'recording' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-800">Professional background</p>
            <p className="text-xs text-gray-500 mt-0.5">Adds a clean office-style backdrop to your saved video.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={professionalBackdrop}
            aria-label="Professional background"
            onClick={handleBackdropToggle}
            disabled={state === 'requesting'}
            className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${professionalBackdrop ? 'bg-blue-600' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${professionalBackdrop ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      )}

      {/* Voice-only waveform */}
      {mode === 'voice' && state === 'recording' && (
        <div className="bg-gray-900 rounded-xl p-6 flex flex-col items-center gap-4">
          <div className="flex items-end gap-0.5 h-14">
            {Array.from({ length: 32 }).map((_, i) => (
              <WaveformBar key={i} level={audioLevel} index={i} total={32} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-white text-sm">{formatTime(duration)} / {formatTime(MAX_DURATION)}</span>
          </div>
        </div>
      )}

      {/* Voice-only playback */}
      {mode === 'voice' && recorded && blobUrl && (
        <div className="bg-gray-100 rounded-xl p-4">
          <audio src={blobUrl} controls className="w-full" />
        </div>
      )}

      {/* Error */}
      {(error || uploadError) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error || uploadError}
        </div>
      )}
      {effectWarning && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          {effectWarning}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-3">
        {!recorded && state !== 'recording' && (
          <button
            onClick={handleStart}
            disabled={state === 'requesting'}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-6 rounded-xl transition-colors"
          >
            {state === 'requesting' ? (professionalBackdrop ? 'Preparing background...' : 'Requesting access...') :
             state === 'ready' ? `Start ${mode === 'video' ? 'Video' : 'Voice'} Recording` :
             `Allow ${mode === 'video' ? 'Camera' : 'Microphone'} & Record`}
          </button>
        )}

        {state === 'recording' && (
          <button
            onClick={handleStop}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <div className="w-3 h-3 bg-white rounded-sm" />
            Stop Recording
          </button>
        )}

        {recorded && (
          <>
            <button
              onClick={handleRetake}
              disabled={uploading}
              className="flex-1 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium py-3 px-6 rounded-xl transition-colors"
            >
              Retake
            </button>
            <button
              onClick={handleSubmit}
              disabled={uploading}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium py-3 px-6 rounded-xl transition-colors"
            >
              {uploading ? `Uploading… ${uploadProgress}%` : 'Use This Recording'}
            </button>
          </>
        )}
      </div>

      {/* Upload size info */}
      {recorded && blob && !uploading && (
        <p className="text-xs text-gray-400 text-center">
          Recording: {formatTime(duration)} ({(blob.size / 1024 / 1024).toFixed(1)} MB)
        </p>
      )}

    </div>
  )
}
