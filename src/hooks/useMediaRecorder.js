import { useState, useRef, useCallback } from 'react'
import { createWhiteBackdropStream } from '../utils/whiteBackdrop'

// If getUserMedia hasn't settled by then the permission prompt was almost
// certainly suppressed (in-app browsers from email/text links do this) —
// surface an actionable error instead of spinning forever.
const PERMISSION_TIMEOUT_MS = 20_000

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => {
      const err = new Error('Timed out waiting for camera/microphone access')
      err.name = 'TimeoutError'
      reject(err)
    }, ms)),
  ])
}

// getUserMedia with a bounded wait; if the user answers the prompt after the
// timeout already fired, release the late-granted device instead of leaking it.
function getMediaWithTimeout(constraints, ms) {
  const pending = navigator.mediaDevices.getUserMedia(constraints)
  return withTimeout(pending, ms).catch(err => {
    if (err.name === 'TimeoutError') {
      pending.then(s => s.getTracks().forEach(t => t.stop())).catch(() => {})
    }
    throw err
  })
}

const MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4'
]

function getSupportedMimeType() {
  return MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || ''
}

// The white-background compositor loads a segmentation model — give it a
// bounded window and fall back to normal recording rather than ever hanging.
const EFFECT_TIMEOUT_MS = 8_000

export default function useMediaRecorder({ mode = 'video', videoEffect = 'none' }) {
  const [state, setState] = useState('idle') // idle | requesting | ready | recording | stopped | error
  const [error, setError] = useState(null)
  const [effectWarning, setEffectWarning] = useState(null)
  const [duration, setDuration] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)

  const mediaRecorderRef = useRef(null)
  const sourceStreamRef = useRef(null)
  const streamRef = useRef(null)
  const effectCleanupRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)

  const startAudioAnalysis = useCallback((stream) => {
    try {
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      analyserRef.current = analyser

      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        setAudioLevel(Math.min(100, avg * 2))
        animFrameRef.current = requestAnimationFrame(tick)
      }
      animFrameRef.current = requestAnimationFrame(tick)
    } catch (err) {
      console.warn('Audio analysis not available:', err)
    }
  }, [])

  const requestPermissions = useCallback(async () => {
    setState('requesting')
    setError(null)
    setEffectWarning(null)
    try {
      let stream
      if (mode === 'video') {
        // Ask for the microphone FIRST, then the camera — two separate,
        // sequential prompts. A combined camera+mic request makes Android
        // stack two dialogs; one gets lost and first-time candidates fail.
        const audioStream = await getMediaWithTimeout({ audio: true }, PERMISSION_TIMEOUT_MS)
        let videoStream
        try {
          // Modest resolution — keeps file size small enough for mobile
          // networks and avoids holding giant blobs in memory (which can
          // trigger tab discards on iOS Safari).
          try {
            videoStream = await getMediaWithTimeout({
              video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
            }, PERMISSION_TIMEOUT_MS)
          } catch (firstErr) {
            if (firstErr.name === 'TimeoutError') throw firstErr
            // Fallback: accept any camera config the device will give us.
            videoStream = await getMediaWithTimeout({ video: { facingMode: 'user' } }, PERMISSION_TIMEOUT_MS)
          }
        } catch (err) {
          // Don't hold the mic open if the camera was refused.
          audioStream.getTracks().forEach(t => t.stop())
          throw err
        }
        stream = new MediaStream([...videoStream.getVideoTracks(), ...audioStream.getAudioTracks()])
      } else {
        stream = await getMediaWithTimeout({ audio: true }, PERMISSION_TIMEOUT_MS)
      }
      sourceStreamRef.current = stream

      if (mode === 'video' && videoEffect === 'white') {
        // Bounded: if the compositor is slow or broken on this device we
        // record with the real background instead of hanging the candidate.
        const pending = createWhiteBackdropStream(stream)
        try {
          const processed = await withTimeout(pending, EFFECT_TIMEOUT_MS)
          effectCleanupRef.current = processed.cleanup
          streamRef.current = processed.stream
        } catch (err) {
          console.warn('White background unavailable:', err)
          // If it finishes late, tear it down so it doesn't leak a render loop.
          pending.then(p => p.cleanup()).catch(() => {})
          setEffectWarning('White background is not available on this device. Recording with your real background.')
          streamRef.current = stream
        }
      } else {
        streamRef.current = stream
      }

      setState('ready')
      return streamRef.current
    } catch (err) {
      setError(err.name === 'NotAllowedError'
        ? 'Camera/microphone access was denied. Please allow access and try again.'
        : err.name === 'NotFoundError'
        ? 'No camera or microphone found. Please check your device.'
        : err.name === 'NotReadableError'
        ? 'Your camera appears to be in use by another app. Close other camera apps and try again.'
        : err.name === 'TimeoutError'
        ? 'We never got an answer from your camera. If no permission prompt appeared and you opened this link from an email or text app, use its menu to choose "Open in browser" (Chrome or Safari) and continue there.'
        : `Could not access media devices: ${err.message}`)
      setState('error')
      return null
    }
  }, [mode, videoEffect])

  const startRecording = useCallback(async () => {
    let stream = streamRef.current
    if (!stream) {
      stream = await requestPermissions()
      if (!stream) return
    }

    chunksRef.current = []
    const mimeType = getSupportedMimeType()
    // Constrain bitrate so a 3-minute recording stays under ~15 MB — uploads
    // reliably on mobile networks and keeps memory pressure low on iOS Safari.
    const recorderOptions = { mimeType, videoBitsPerSecond: 600_000, audioBitsPerSecond: 64_000 }
    let recorder
    try {
      recorder = new MediaRecorder(stream, recorderOptions)
    } catch {
      // Some browsers reject explicit bitrates — retry with just the mimeType.
      recorder = new MediaRecorder(stream, { mimeType })
    }
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data)
      }
    }

    recorder.onerror = (e) => {
      setError(`Recording error: ${e.error?.message || 'Unknown error'}`)
      setState('error')
    }

    // Use a 1-second timeslice so data is flushed periodically. Without this,
    // iOS Safari can miss the final `dataavailable` event and we end up with
    // a 0-byte blob — or, worse, the page gets discarded under memory pressure.
    recorder.start(1000)
    setState('recording')
    setDuration(0)
    startAudioAnalysis(stream)

    timerRef.current = setInterval(() => {
      setDuration(d => d + 1)
    }, 1000)
  }, [requestPermissions, startAudioAnalysis])

  const stopRecording = useCallback(() => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve(null)
        return
      }

      clearInterval(timerRef.current)
      cancelAnimationFrame(animFrameRef.current)
      setAudioLevel(0)

      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' })
        setState('stopped')
        resolve(blob)
      }

      recorder.onstop = finish
      // Safety net: if onstop never fires (observed on some mobile browsers),
      // resolve anyway after a short grace period so the UI doesn't hang.
      setTimeout(finish, 2000)

      try {
        // Flush the final chunk before stopping — prevents empty blobs on iOS Safari.
        if (typeof recorder.requestData === 'function') recorder.requestData()
      } catch {
        /* not all browsers implement requestData; ignore */
      }
      try {
        recorder.stop()
      } catch {
        finish()
      }
    })
  }, [])

  const releaseStream = useCallback(() => {
    effectCleanupRef.current?.()
    effectCleanupRef.current = null
    if (streamRef.current && streamRef.current !== sourceStreamRef.current) {
      streamRef.current.getVideoTracks().forEach(t => t.stop())
    }
    sourceStreamRef.current?.getTracks().forEach(t => t.stop())
    sourceStreamRef.current = null
    streamRef.current = null
    setState('idle')
    setDuration(0)
  }, [])

  const reset = useCallback(() => {
    chunksRef.current = []
    setDuration(0)
    setState(streamRef.current ? 'ready' : 'idle')
  }, [])

  return {
    state,
    error,
    effectWarning,
    duration,
    audioLevel,
    stream: streamRef.current,
    requestPermissions,
    startRecording,
    stopRecording,
    releaseStream,
    reset,
    isSupported: typeof MediaRecorder !== 'undefined'
  }
}
