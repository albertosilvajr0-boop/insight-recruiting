import { useRef, useEffect, useState } from 'react'
import useMediaRecorder from '../hooks/useMediaRecorder'
import useUploadChunks from '../hooks/useUploadChunks'

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

  const { uploadChunk, finalizeUpload, uploadedChunks, uploading, uploadError } = useUploadChunks(
    `${candidateId}_q${questionIndex}`
  )

  const {
    state, error, duration, audioLevel,
    stream, isSupported,
    requestPermissions, startRecording, stopRecording, releaseStream, reset
  } = useMediaRecorder({
    mode,
    onChunk: (chunk, index) => uploadChunk(chunk, index)
  })

  // Attach stream to video preview
  useEffect(() => {
    if (videoPreviewRef.current && stream && mode === 'video') {
      videoPreviewRef.current.srcObject = stream
    }
  }, [stream, mode])

  // Auto-stop at max duration
  useEffect(() => {
    if (state === 'recording' && duration >= MAX_DURATION) {
      handleStop()
    }
  }, [duration, state])

  // Cleanup on unmount
  useEffect(() => () => releaseStream(), [])

  const handleStart = async () => {
    if (state === 'idle') await requestPermissions()
    await startRecording()
  }

  const handleStop = async () => {
    const recordedBlob = await stopRecording()
    setBlob(recordedBlob)
    setRecorded(true)
  }

  const handleRetake = () => {
    setBlob(null)
    setRecorded(false)
    reset()
  }

  const handleSubmit = async () => {
    try {
      const chunkCount = uploadedChunks
      const path = await finalizeUpload(chunkCount, blob)
      onComplete(path, blob)
    } catch (err) {
      console.error('Submit failed:', err)
      alert('Failed to save recording. Please try again.')
    }
  }

  if (!isSupported) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        Your browser doesn't support recording. Please use Chrome, Firefox, or Edge.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Preview area */}
      {mode === 'video' && (
        <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video">
          {state === 'stopped' && blob ? (
            <video
              src={URL.createObjectURL(blob)}
              controls
              className="w-full h-full object-cover"
            />
          ) : (
            <video
              ref={videoPreviewRef}
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
              className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-3 px-6 rounded-xl transition-colors"
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

      {/* Upload progress */}
      {state === 'recording' && uploadedChunks > 0 && (
        <p className="text-xs text-gray-500 text-center">
          {uploadedChunks} second{uploadedChunks !== 1 ? 's' : ''} saved
        </p>
      )}
    </div>
  )
}
