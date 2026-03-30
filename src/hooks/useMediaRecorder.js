import { useState, useRef, useCallback } from 'react'

const MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4'
]

function getSupportedMimeType() {
  return MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || ''
}

export default function useMediaRecorder({ mode = 'video' }) {
  const [state, setState] = useState('idle') // idle | requesting | ready | recording | stopped | error
  const [error, setError] = useState(null)
  const [duration, setDuration] = useState(0)
  const [audioLevel, setAudioLevel] = useState(0)

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
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
    try {
      const constraints = mode === 'video'
        ? { video: { width: 1280, height: 720, facingMode: 'user' }, audio: true }
        : { audio: true }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      setState('ready')
      return stream
    } catch (err) {
      setError(err.name === 'NotAllowedError'
        ? 'Camera/microphone access was denied. Please allow access and try again.'
        : `Could not access media devices: ${err.message}`)
      setState('error')
      return null
    }
  }, [mode])

  const startRecording = useCallback(async () => {
    let stream = streamRef.current
    if (!stream) {
      stream = await requestPermissions()
      if (!stream) return
    }

    chunksRef.current = []
    const mimeType = getSupportedMimeType()
    const recorder = new MediaRecorder(stream, { mimeType })
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

    // Record without timeslice — collect all data at once for a clean blob
    recorder.start()
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

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType })
        setState('stopped')
        resolve(blob)
      }
      recorder.stop()
    })
  }, [])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
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
