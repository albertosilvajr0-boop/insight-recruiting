import { useRef, useEffect, useState, useCallback } from 'react'
import { ref, uploadBytes } from 'firebase/storage'
import { storage } from '../firebase'
import useMediaRecorder from '../hooks/useMediaRecorder'

const MAX_DURATION = 180 // 3 minutes

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

export default function VideoRecorder({ candidateId, questionIndex, onComplete, mode = 'video' }) {
  const videoPreviewRef = useRef(null)
  const [recorded, setRecorded] = useState(false)
  const [blob, setBlob] = useState(null)
  const [blobUrl, setBlobUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [retakeCount, setRetakeCount] = useState(0)

  const {
    state, error, duration, audioLevel,
    stream, isSupported,
    requestPermissions, startRecording, stopRecording, releaseStream, reset
  } = useMediaRecorder({ mode })

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
    if (state === 'idle') await requestPermissions()
    await startRecording()
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

  const handleSubmit = async () => {
    if (!blob) return
    setUploading(true)
    setUploadError(null)
    try {
      const storagePath = `videos/${candidateId}_q${questionIndex}/recording.webm`
      const fileRef = ref(storage, storagePath)
      await uploadBytes(fileRef, blob)
      const dirPath = `videos/${candidateId}_q${questionIndex}`
      onComplete(dirPath, blob)
    } catch (err) {
      console.error('Video upload failed:', err)
      setUploadError('Upload failed. Please try again.')
      setUploading(false)
    }
  }

  if (!isSupported) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        Your browser doesn't support recording. Please use Chrome, Firefox, or Edge.
      </div>
    )
  }

  const showLivePreview = !recorded && mode === 'video'
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

      {/* Controls */}
      <div className="flex gap-3">
        {!recorded && state !== 'recording' && (
          <button
            onClick={handleStart}
            disabled={state === 'requesting'}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-3 px-6 rounded-xl transition-colors"
          >
            {state === 'requesting' ? 'Requesting access...' :
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
              {uploading ? 'Uploading...' : 'Use This Recording'}
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

      {/* Skip option */}
      {!recorded && state !== 'recording' && (
        <p className="text-xs text-center text-gray-400">
          Having trouble recording?{' '}
          <button
            className="underline text-gray-500"
            onClick={() => onComplete(`skipped_q${questionIndex}`, null)}
          >
            Skip this question
          </button>
        </p>
      )}
    </div>
  )
}
