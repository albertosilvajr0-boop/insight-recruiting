import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

// Admin-only: bundles a candidate's resume, video responses, and a text
// summary into a single .zip and downloads it to disk.
//
// The zip is produced by a Cloud Function (see functions/src/admin/downloadProfile.js)
// to avoid browser CORS issues fetching Storage files directly, and to keep
// the multi-megabyte video traffic off the admin's laptop.

export async function downloadCandidateProfile(candidate, onProgress) {
  if (!candidate?.id) throw new Error('No candidate id')
  const report = (msg) => { if (typeof onProgress === 'function') onProgress(msg) }

  report('Packaging on server…')
  const call = httpsCallable(functions, 'generateCandidateProfileZip', { timeout: 540_000 })
  const { data } = await call({ candidateId: candidate.id })

  if (!data?.url) throw new Error('Server did not return a download URL')

  report('Downloading…')
  // Navigate via a hidden anchor. Browser honors Content-Disposition: attachment
  // set by the function, so the zip saves to disk with the proper filename
  // and no CORS/fetch is involved.
  const a = document.createElement('a')
  a.href = data.url
  a.rel = 'noopener'
  a.target = '_blank'
  if (data.filename) a.download = data.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  report('Done')
  return { filename: data.filename, issues: data.issues || [], sizeBytes: data.sizeBytes }
}
