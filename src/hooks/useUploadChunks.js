import { useState, useRef, useCallback } from 'react'
import { ref, uploadBytes } from 'firebase/storage'
import { storage } from '../firebase'

const WEBM_METADATA = { contentType: 'video/webm' }

export default function useUploadChunks(candidateId) {
  const [uploadedChunks, setUploadedChunks] = useState(0)
  const [failedChunks, setFailedChunks] = useState(0)
  const [uploadError, setUploadError] = useState(null)
  const [finalUrl, setFinalUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const allChunksRef = useRef([]) // Store all blob chunks locally as backup

  const uploadChunk = useCallback(async (blob, index) => {
    // Always save the chunk locally as backup
    allChunksRef.current.push(blob)

    try {
      const chunkPath = `videos/${candidateId}/chunk_${String(index).padStart(4, '0')}.webm`
      const chunkRef = ref(storage, chunkPath)
      await uploadBytes(chunkRef, blob, WEBM_METADATA)
      setUploadedChunks(c => c + 1)
    } catch (err) {
      console.error(`[upload] Chunk ${index} failed:`, err.message)
      setFailedChunks(f => f + 1)
    }
  }, [candidateId])

  const finalizeUpload = useCallback(async (totalChunks, fullBlob) => {
    setUploading(true)
    try {
      // Always upload the complete recording blob — most reliable approach
      const recordingBlob = fullBlob || (allChunksRef.current.length > 0
        ? new Blob(allChunksRef.current, { type: 'video/webm' })
        : null)

      if (recordingBlob) {
        const fullRef = ref(storage, `videos/${candidateId}/recording.webm`)
        await uploadBytes(fullRef, recordingBlob, WEBM_METADATA)
        console.log(`[upload] Full recording uploaded: ${(recordingBlob.size / 1024).toFixed(0)} KB`)
      }

      const url = `videos/${candidateId}`
      setFinalUrl(url)
      return url
    } catch (err) {
      console.error('[upload] Finalize failed:', err)
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
    failedChunks,
    uploadError,
    finalUrl,
    uploading
  }
}
