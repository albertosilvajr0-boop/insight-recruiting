import { useState, useRef, useCallback } from 'react'
import { createProfessionalBackdropStream } from '../utils/professionalBackdrop'

const MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4'
]

function getSupportedMimeType() {
  return MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || ''
}

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
        // Request a modest resolution — keeps file size small enough for
        // mobile networks and avoids holding giant blobs in memory (which
        // can trigger tab discards on iOS Safari).
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
            audio: true
          })
        } catch {
          // Fallback: accept any camera config the device will give us.
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true })
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      }
      sourceStreamRef.current = stream

      if (mode === 'video' && videoEffect === 'professional') {
        try {
          const processed = await createProfessionalBackdropStream(stream)
          effectCleanupRef.current = processed.cleanup
          streamRef.current = processed.stream
        } catch (err) {
          console.warn('Professional backdrop unavailable:', err)
          setEffectWarning('Professional background is not available on this device. Recording normally.')
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
