import { describe, expect, it } from 'vitest'
import {
  MAX_RESUME_BYTES,
  buildCandidateResumePath,
  inferResumeContentType,
  resumeFileError,
} from './resumeUpload'

describe('résumé upload helpers', () => {
  it('accepts supported files and rejects unsupported or oversized files', () => {
    expect(resumeFileError({ name: 'resume.PDF', size: 100 })).toBeNull()
    expect(resumeFileError({ name: 'resume.txt', size: 100 })).toBe('Use a PDF, DOC, or DOCX résumé.')
    expect(resumeFileError({ name: 'resume.pdf', size: MAX_RESUME_BYTES + 1 })).toBe('Résumé too large. Maximum size is 10 MB.')
  })

  it('infers the storage content type from the extension', () => {
    expect(inferResumeContentType('resume.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(inferResumeContentType('resume.pdf')).toBe('application/pdf')
  })

  it('builds a unique, candidate-scoped path within the callable length limit', () => {
    const path = buildCandidateResumePath('candidate-123', 'María Silva Résumé (final).PDF', 1720000000000)

    expect(path).toBe('resumes/candidate-123/Maria-Silva-Resume-final-1720000000000.pdf')
    expect(path.length).toBeLessThanOrEqual(260)
    expect(buildCandidateResumePath('candidate-123', `${'a'.repeat(400)}.pdf`, 1720000000000).length).toBeLessThanOrEqual(260)
  })
})
