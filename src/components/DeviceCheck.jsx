import { useEffect, useRef, useState } from 'react'

// Lightweight pre-flight: confirms camera + mic work, measures mic level
// and rough frame brightness, and surfaces actionable warnings before the
// candidate hits Record. Runs entirely client-side.
export default function DeviceCheck({ mode = 'video', onReady, onSkip }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const rafRef = useRef(null)
  const [status, setStatus] = useState('requesting') // requesting | ready | error
  const [error, setError] = useState(null)
  const [audioLevel, setAudioLevel] = useState(0)
  const [audioPeak, setAudioPeak] = useState(0)
  const [brightness, setBrightness] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const constraints = mode === 'video'
          ? { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: true }
          : { audio: true }
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current && mode === 'video') {
          videoRef.current.srcObject = stream
        }

        // Mic analysis
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        audioCtxRef.current = ctx
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        src.connect(analyser)
        const data = new Uint8Array(analyser.frequencyBinCount)

        const tick = () => {
          analyser.getByteFrequencyData(data)
          const avg = data.reduce((a, b) => a + b, 0) / data.length
          const level = Math.min(100, avg * 2)
          setAudioLevel(level)
          setAudioPeak(p => Math.max(p, level))

          // Frame brightness: sample the video center. Very rough but
          // enough to flag a completely dark or backlit setup.
          if (mode === 'video' && videoRef.current && videoRef.current.videoWidth > 0) {
            try {
              const canvas = document.createElement('canvas')
              canvas.width = 64
              canvas.height = 48
              const cctx = canvas.getContext('2d')
              cctx.drawImage(videoRef.current, 0, 0, 64, 48)
              const pixels = cctx.getImageData(0, 0, 64, 48).data
              let sum = 0
              for (let i = 0; i < pixels.length; i += 4) {
                sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
              }
              setBrightness(sum / (pixels.length / 4))
            } catch { /* CORS/canvas errors ignorable */ }
          }

          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setError(err.name === 'NotAllowedError'
          ? 'Camera and microphone access was denied. Check your browser permissions and try again.'
          : err.name === 'NotFoundError'
          ? 'No camera or microphone found. Make sure your device is connected.'
          : `Couldn't access your camera or microphone: ${err.message}`)
      }
    }
    start()
    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      audioCtxRef.current?.close().catch(() => {})
    }
  }, [mode])

  const handleContinue = () => {
    // Release our preview stream before handing off to the recorder so
    // it can request a fresh one with its own preferred constraints.
    streamRef.current?.getTracks().forEach(t => t.stop())
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    audioCtxRef.current?.close().catch(() => {})
    onReady?.()
  }

  const audioOk = audioPeak >= 15
  const brightnessOk = brightness === null ? null : (brightness >= 40 && brightness <= 230)
  const warnings = []
  if (status === 'ready' && !audioOk) warnings.push({ level: 'warn', text: 'We\'re not picking up much sound. Try speaking a little louder or check that the right mic is selected.' })
  if (status === 'ready' && brightnessOk === false && brightness < 40) warnings.push({ level: 'warn', text: 'Your camera looks dark. Move toward a window or turn on a light so we can see you clearly.' })
  if (status === 'ready' && brightnessOk === false && brightness > 230) warnings.push({ level: 'warn', text: 'Too bright — try not to face a window directly behind you.' })

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Let's make sure your camera and mic work</h3>
        <p className="text-xs text-gray-500 mt-0.5">Takes 5 seconds — just say "hello, hello" so we can check your audio.</p>
      </div>

      {status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}

      {mode === 'video' && status !== 'error' && (
        <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video">
          <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          {status === 'requesting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {brightnessOk === true && (
            <div className="absolute top-2 left-2 bg-green-500/90 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">Lighting OK</div>
          )}
          {brightnessOk === false && (
            <div className="absolute top-2 left-2 bg-amber-500/90 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">Check lighting</div>
          )}
        </div>
      )}

      {status === 'ready' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-gray-600">Microphone</p>
            <p className={`text-xs font-semibold ${audioOk ? 'text-green-600' : 'text-gray-400'}`}>
              {audioOk ? 'Picking up audio' : 'Waiting for sound…'}
            </p>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-75 ${audioLevel > 60 ? 'bg-red-500' : audioLevel > 30 ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${audioLevel}%` }}
            />
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1.5">
          {warnings.map((w, i) => (
            <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">{w.text}</div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        {onSkip && (
          <button onClick={onSkip} className="flex-1 text-xs text-gray-500 hover:text-gray-900 font-medium py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50">
            Skip check
          </button>
        )}
        <button
          onClick={handleContinue}
          disabled={status !== 'ready'}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-xl text-sm"
        >
          {status === 'ready' ? 'Looks good — continue' : 'Checking your setup…'}
        </button>
      </div>
    </div>
  )
}
