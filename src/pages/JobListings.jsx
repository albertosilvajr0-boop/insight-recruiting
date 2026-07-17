import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore'
import { db } from '../firebase'
import {
  APP_URL,
  DEFAULT_CLIENT_NAME,
  
  getJobClientName,
} from '../config/organization'

// Google's guidelines forbid JobPosting markup on list pages — the full
// JobPosting JSON-LD lives on each /apply/:jobId page (JobPostingSchema).
// The list page only advertises the individual job URLs.
function injectJobListStructuredData(jobs) {
  const old = document.getElementById('job-structured-data')
  if (old) old.remove()

  if (jobs.length === 0) return

  const script = document.createElement('script')
  script.id = 'job-structured-data'
  script.type = 'application/ld+json'
  script.textContent = JSON.stringify({
    '@context': 'https://schema.org/',
    '@type': 'ItemList',
    itemListElement: jobs.map((job, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${APP_URL}/apply/${job.id}`,
    })),
  })
  document.head.appendChild(script)
}

export default function JobListings() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [slowLoading, setSlowLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    const slowTimer = setTimeout(() => {
      if (active) setSlowLoading(true)
    }, 8000)

    async function loadJobs() {
      setLoading(true)
      setLoadError(null)
      setSlowLoading(false)
      try {
        const q = query(
          collection(db, 'jobs'),
          where('status', '==', 'active'),
          orderBy('createdAt', 'desc')
        )
        const snap = await getDocs(q)
        const loadedJobs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        if (!active) return
        setJobs(loadedJobs)
        injectJobListStructuredData(loadedJobs)
        setLoadError(null)
      } catch (err) {
        if (!active) return
        console.error('Failed to load jobs:', err)
        setLoadError('We could not load open positions. Please refresh or try again shortly.')
      } finally {
        if (active) {
          clearTimeout(slowTimer)
          setSlowLoading(false)
          setLoading(false)
        }
      }
    }
    loadJobs()
    return () => {
      active = false
      clearTimeout(slowTimer)
    }
  }, [reloadKey])

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-white">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <div className="text-center mb-10">
          <img src="/brand-mark.png" alt="Insight Edge" className="w-16 h-16 mx-auto mb-4 object-contain" />
          <h1 className="text-3xl font-bold text-gray-900">{DEFAULT_CLIENT_NAME} Careers</h1>
          <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
            Apply in minutes with a short online interview from any device.
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            {slowLoading && (
              <>
                <p className="text-sm text-gray-500">Still loading open positions. This can happen when the database is slow to respond.</p>
                <button
                  onClick={() => setReloadKey(key => key + 1)}
                  className="text-sm font-medium text-blue-600 hover:underline"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        ) : loadError ? (
          <div className="text-center py-12 space-y-3">
            <p className="text-red-600">{loadError}</p>
            <button
              onClick={() => setReloadKey(key => key + 1)}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl"
            >
              Retry
            </button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400">No open positions right now. Check back soon!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map(job => (
              <Link
                key={job.id}
                to={`/apply/${job.id}`}
                className="group block bg-white rounded-2xl border border-gray-200 p-6 shadow-sm hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">{job.title}</h2>
                    <p className="text-sm text-gray-500 mt-0.5">{getJobClientName(job)}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {job.location && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          {job.location}
                        </span>
                      )}
                      {job.payRange?.min > 0 && job.payRange?.max > 0 && (
                        <span className="text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
                          ${job.payRange.min.toLocaleString()}–${job.payRange.max.toLocaleString()}{(job.payUnit === 'HOUR' || (!job.payUnit && job.payRange.max < 1000)) ? '/hr' : '/yr'}
                        </span>
                      )}
                      {job.industry && (
                        <span className="text-xs text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full">{job.industry}</span>
                      )}
                    </div>
                    {job.description && (
                      <p className="text-sm text-gray-500 mt-2.5 line-clamp-2">{job.description}</p>
                    )}
                  </div>
                  <span className="shrink-0 bg-blue-600 group-hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors">
                    Start Interview
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="text-center mt-10">
          <p className="text-sm text-gray-500">
            Already have an interview code?{' '}
            <Link to="/" className="text-blue-600 font-medium hover:underline">Start here</Link>
          </p>
        </div>
        <div className="flex justify-end mt-8">
          <Link to="/admin/login" className="text-xs text-gray-400 hover:text-gray-600">
            Admin
          </Link>
        </div>
      </div>
    </div>
  )
}
