import selfieSegmentationScriptUrl from '@mediapipe/selfie_segmentation/selfie_segmentation.js?url'
import binarypbUrl from '@mediapipe/selfie_segmentation/selfie_segmentation.binarypb?url'
import modelUrl from '@mediapipe/selfie_segmentation/selfie_segmentation.tflite?url'
import landscapeModelUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_landscape.tflite?url'
import simdDataUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.data?url'
import simdJsUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.js?url'
import simdWasmUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_simd_wasm_bin.wasm?url'
import wasmJsUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_wasm_bin.js?url'
import wasmWasmUrl from '@mediapipe/selfie_segmentation/selfie_segmentation_solution_wasm_bin.wasm?url'

const MEDIAPIPE_ASSETS = {
  'selfie_segmentation.binarypb': binarypbUrl,
  'selfie_segmentation.tflite': modelUrl,
  'selfie_segmentation_landscape.tflite': landscapeModelUrl,
  'selfie_segmentation_solution_simd_wasm_bin.data': simdDataUrl,
  'selfie_segmentation_solution_simd_wasm_bin.js': simdJsUrl,
  'selfie_segmentation_solution_simd_wasm_bin.wasm': simdWasmUrl,
  'selfie_segmentation_solution_wasm_bin.js': wasmJsUrl,
  'selfie_segmentation_solution_wasm_bin.wasm': wasmWasmUrl,
}

let selfieSegmentationLoader = null

function loadSelfieSegmentation() {
  if (window.SelfieSegmentation) return Promise.resolve(window.SelfieSegmentation)
  if (selfieSegmentationLoader) return selfieSegmentationLoader

  selfieSegmentationLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = selfieSegmentationScriptUrl
    script.async = true
    script.onload = () => {
      if (window.SelfieSegmentation) resolve(window.SelfieSegmentation)
      else {
        selfieSegmentationLoader = null
        reject(new Error('Professional background engine did not load.'))
      }
    }
    script.onerror = () => {
      selfieSegmentationLoader = null
      reject(new Error('Professional background engine could not be loaded.'))
    }
    document.head.appendChild(script)
  })

  return selfieSegmentationLoader
}

function waitForVideo(video) {
  return new Promise((resolve, reject) => {
    const finish = () => resolve()
    const fail = () => reject(new Error('Camera preview could not start.'))

    if (video.readyState >= 2 && video.videoWidth > 0) {
      finish()
      return
    }

    video.onloadedmetadata = finish
    video.onerror = fail
    setTimeout(() => {
      if (video.videoWidth > 0) finish()
      else fail()
    }, 3000)
  })
}

function drawProfessionalBackdrop(ctx, width, height) {
  const wall = ctx.createLinearGradient(0, 0, width, height)
  wall.addColorStop(0, '#f5f7fb')
  wall.addColorStop(0.55, '#e3eaf2')
  wall.addColorStop(1, '#cfd9e5')
  ctx.fillStyle = wall
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.58)'
  ctx.fillRect(width * 0.08, height * 0.12, width * 0.3, height * 0.58)
  ctx.fillRect(width * 0.62, height * 0.1, width * 0.28, height * 0.6)

  ctx.strokeStyle = 'rgba(93, 111, 132, 0.2)'
  ctx.lineWidth = Math.max(1, width * 0.003)
  for (const x of [0.18, 0.28, 0.72, 0.82]) {
    ctx.beginPath()
    ctx.moveTo(width * x, height * 0.12)
    ctx.lineTo(width * x, height * 0.7)
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(49, 62, 78, 0.08)'
  ctx.fillRect(0, height * 0.72, width, height * 0.28)

  const desk = ctx.createLinearGradient(0, height * 0.78, 0, height)
  desk.addColorStop(0, 'rgba(75, 86, 103, 0.18)')
  desk.addColorStop(1, 'rgba(43, 52, 65, 0.28)')
  ctx.fillStyle = desk
  ctx.fillRect(0, height * 0.8, width, height * 0.2)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.38)'
  ctx.fillRect(width * 0.1, height * 0.18, width * 0.18, height * 0.015)
  ctx.fillRect(width * 0.66, height * 0.18, width * 0.16, height * 0.015)
}

function drawSegmentedFrame(ctx, results, width, height) {
  ctx.save()
  ctx.clearRect(0, 0, width, height)

  ctx.filter = 'blur(1px)'
  ctx.drawImage(results.segmentationMask, 0, 0, width, height)
  ctx.filter = 'none'

  ctx.globalCompositeOperation = 'source-in'
  ctx.drawImage(results.image, 0, 0, width, height)
  ctx.globalCompositeOperation = 'destination-over'
  drawProfessionalBackdrop(ctx, width, height)
  ctx.restore()
}

export async function createProfessionalBackdropStream(sourceStream) {
  if (!HTMLCanvasElement.prototype.captureStream) {
    throw new Error('Canvas capture is not supported on this device.')
  }

  const sourceVideoTrack = sourceStream.getVideoTracks()[0]
  if (!sourceVideoTrack) {
    throw new Error('No camera track was found.')
  }

  const settings = sourceVideoTrack.getSettings?.() || {}
  const video = document.createElement('video')
  video.srcObject = new MediaStream([sourceVideoTrack])
  video.muted = true
  video.playsInline = true
  await video.play()
  await waitForVideo(video)

  const width = video.videoWidth || settings.width || 640
  const height = video.videoHeight || settings.height || 480
  const frameRate = Math.min(24, settings.frameRate || 24)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) {
    throw new Error('Could not prepare the video background.')
  }

  const SelfieSegmentation = await loadSelfieSegmentation()
  const segmenter = new SelfieSegmentation({
    locateFile: (file) => MEDIAPIPE_ASSETS[file] || file,
  })
  segmenter.setOptions({ modelSelection: 1, selfieMode: false })

  let running = true
  let frameId = null
  segmenter.onResults((results) => {
    if (!running) return
    drawSegmentedFrame(ctx, results, width, height)
  })
  await segmenter.initialize()
  await segmenter.send({ image: video })

  const render = async () => {
    if (!running) return
    try {
      await segmenter.send({ image: video })
    } catch (err) {
      console.warn('Professional backdrop frame failed:', err)
      ctx.drawImage(video, 0, 0, width, height)
    }
    if (running) frameId = requestAnimationFrame(render)
  }
  frameId = requestAnimationFrame(render)

  const outputStream = canvas.captureStream(frameRate)
  sourceStream.getAudioTracks().forEach(track => outputStream.addTrack(track))

  return {
    stream: outputStream,
    cleanup: () => {
      running = false
      if (frameId) cancelAnimationFrame(frameId)
      video.pause()
      video.srcObject = null
      outputStream.getVideoTracks().forEach(track => track.stop())
      segmenter.close().catch(() => {})
    },
  }
}
