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
        reject(new Error('White background engine did not load.'))
      }
    }
    script.onerror = () => {
      selfieSegmentationLoader = null
      reject(new Error('White background engine could not be loaded.'))
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

function drawWhiteBackdrop(ctx, width, height) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
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
  drawWhiteBackdrop(ctx, width, height)
  ctx.restore()
}

export async function createWhiteBackdropStream(sourceStream) {
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
      console.warn('White background frame failed:', err)
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
