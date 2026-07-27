export const MAX_RESUME_BYTES = 10 * 1024 * 1024

const RESUME_CONTENT_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

function resumeExtension(fileName) {
  return String(fileName || '').toLowerCase().split('.').pop()
}

export function inferResumeContentType(fileName) {
  return RESUME_CONTENT_TYPES[resumeExtension(fileName)] || 'application/octet-stream'
}

export function resumeFileError(file) {
  if (!file || file.size === 0) return 'Choose a résumé file that is not empty.'
  if (file.size > MAX_RESUME_BYTES) return 'Résumé too large. Maximum size is 10 MB.'
  if (!RESUME_CONTENT_TYPES[resumeExtension(file.name)]) {
    return 'Use a PDF, DOC, or DOCX résumé.'
  }
  return null
}

export function buildCandidateResumePath(candidateId, fileName, timestamp = Date.now()) {
  const extension = resumeExtension(fileName)
  const prefix = `resumes/${candidateId}/`
  const suffix = `-${timestamp}.${extension}`
  const maxBaseLength = Math.max(1, 260 - prefix.length - suffix.length)
  const baseName = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxBaseLength) || 'resume'

  return `${prefix}${baseName}${suffix}`
}
