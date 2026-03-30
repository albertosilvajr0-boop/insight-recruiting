import { useState, useRef, useCallback } from 'react'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'

export default function useUploadChunks(candidateId) {
  const [uploadedChunks, setUploadedChunks] = useState(0)
  const [uploadError, setUploadError] = useState(null)
  const [finalUrl, setFinalUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const queueRef = useRef([])
  const processingRef = useRef(false)

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
        setUploadError(`Chunk ${index} upload failed: ${err.message}`)
      }
    }

    processingRef.current = false
  }, [candidateId])

  const uploadChunk = useCallback((blob, index) => {
    queueRef.current.push({ blob, index })
    processQueue()
  }, [processQueue])

  const finalizeUpload = useCallback(async (totalChunks) => {
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

      // Store manifest so Cloud Function knows how many chunks to stitch
      const manifestRef = ref(storage, `videos/${candidateId}/manifest.json`)
      const manifest = JSON.stringify({ totalChunks, candidateId, createdAt: Date.now() })
      await uploadBytes(manifestRef, new Blob([manifest], { type: 'application/json' }))

      // Return the path — Cloud Function will stitch and produce final URL
      const url = `videos/${candidateId}`
      setFinalUrl(url)
      return url
    } catch (err) {
      setUploadError(`Finalize failed: ${err.message}`)
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
