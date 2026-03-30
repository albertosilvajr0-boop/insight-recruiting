import { useState, useRef, useCallback } from 'react'
import { ref, uploadBytes } from 'firebase/storage'
import { storage } from '../firebase'

export default function useUploadChunks(candidateId) {
  const [uploadedChunks, setUploadedChunks] = useState(0)
  const [uploadError, setUploadError] = useState(null)
  const [finalUrl, setFinalUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const queueRef = useRef([])
  const processingRef = useRef(false)
  const failedRef = useRef(0)

  const processQueue = useCallback(async () => {
    if (processingRef.current || queueRef.current.length === 0) return
    processingRef.current = true

    while (queueRef.current.length > 0) {
      const { blob, index } = queueRef.current.shift()
      try {
        const chunkRef = ref(storage, `videos/${candidateId}/chunk_${String(index).padStart(4, '0')}.webm`)
        await uploadBytes(chunkRef, blob)
        setUploadedChunks(c => c + 1)
      } catch (err) {
        console.error(`Chunk ${index} upload failed:`, err)
        failedRef.current += 1
        // Don't set error state during recording — it's distracting
        // We'll handle it at finalize time
      }
    }

    processingRef.current = false
  }, [candidateId])

  const uploadChunk = useCallback((blob, index) => {
    queueRef.current.push({ blob, index })
    processQueue()
  }, [processQueue])

  const finalizeUpload = useCallback(async (totalChunks, fullBlob) => {
    setUploading(true)
    try {
      // Wait for queue to drain
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (!processingRef.current && queueRef.current.length === 0) {
            clearInterval(check)
            resolve()
          }
        }, 200)
      })

      // If chunk uploads failed or no chunks, upload the full blob as fallback
      if (fullBlob && (failedRef.current > 0 || totalChunks === 0)) {
        console.log('[upload] Chunk uploads had issues, uploading full recording as fallback')
        const fullRef = ref(storage, `videos/${candidateId}/full_recording.webm`)
        await uploadBytes(fullRef, fullBlob)
        setUploadedChunks(1)
      }

      // Store manifest
      const manifestRef = ref(storage, `videos/${candidateId}/manifest.json`)
      const manifest = JSON.stringify({
        totalChunks: failedRef.current > 0 ? 0 : totalChunks,
        hasFullRecording: failedRef.current > 0 || totalChunks === 0,
        candidateId,
        createdAt: Date.now()
      })
      await uploadBytes(manifestRef, new Blob([manifest], { type: 'application/json' }))

      const url = `videos/${candidateId}`
      setFinalUrl(url)
      return url
    } catch (err) {
      setUploadError(`Upload failed: ${err.message}`)
      throw err
    } finally {
      setUploading(false)
    }
  }, [candidateId])

  return {
    uploadChunk,
    finalizeUpload,
    uploadedChunks,
    uploadError,
    finalUrl,
    uploading
  }
}
