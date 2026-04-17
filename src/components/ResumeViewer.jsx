import { useEffect, useState } from 'react'

// Robust resume preview. Firebase Storage serves files with
// Content-Disposition: attachment by default on some projects, which makes
// <iframe> show a download prompt instead of the PDF. We handle three cases:
//   1. PDF — use an <object>, which triggers the browser's PDF plugin and
//      respects the Content-Type regardless of disposition.
//   2. DOCX/DOC — browsers can't render these natively, so we embed via
//      Google Docs viewer (no auth required since the URL is signed).
//   3. Anything else / failure — show a "Download" CTA.
export default function ResumeViewer({ url, fileName }) {
  const [objectFailed, setObjectFailed] = useState(false)
  const lowerName = (fileName || url || '').toLowerCase()
  const isDocx = lowerName.endsWith('.docx') || lowerName.endsWith('.doc')
  const isPdf = !isDocx && (lowerName.includes('.pdf') || /\.pdf(\?|$)/.test(url))

  // Reset on url change
  useEffect(() => { setObjectFailed(false) }, [url])

  if (!url) return null

  if (isDocx) {
    const gdocsUrl = `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`
    return (
      <div>
        <iframe src={gdocsUrl} className="w-full h-96 border border-gray-200 rounded-lg bg-white" title="Resume" />
        <p className="text-xs text-gray-400 mt-1">If the preview doesn't load, <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">download the file</a>.</p>
      </div>
    )
  }

  if (isPdf && !objectFailed) {
    return (
      <div>
        <object
          data={`${url}#toolbar=1&navpanes=0`}
          type="application/pdf"
          className="w-full h-96 border border-gray-200 rounded-lg bg-gray-50"
          onError={() => setObjectFailed(true)}
        >
          <iframe src={url} className="w-full h-96 border border-gray-200 rounded-lg" title="Resume" onError={() => setObjectFailed(true)} />
        </object>
      </div>
    )
  }

  // Fallback — e.g. unsupported format, or PDF couldn't render in-browser.
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
      <svg className="w-10 h-10 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
      <p className="text-sm text-gray-600">Preview isn't available for this file type.</p>
      <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg">Download resume</a>
    </div>
  )
}
