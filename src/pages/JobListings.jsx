import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore'
import { db } from '../firebase'

const APP_URL = 'https://insight-recruiting-d37dc.web.app'

function injectJobStructuredData(jobs) {
  // Remove old structured data
  const old = document.getElementById('job-structured-data')
  if (old) old.remove()

  if (jobs.length === 0) return

  const jsonLd = jobs.map(job => ({
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description || `${job.title} position at San Antonio Dodge`,
    datePosted: job.createdAt?.toDate?.()?.toISOString?.()?.split('T')[0] || new Date().toISOString().split('T')[0],
    hiringOrganization: {
      '@type': 'Organization',
      name: 'San Antonio Dodge',
      sameAs: APP_URL,
      logo: `${APP_URL}/logo.png`
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '18011 Blanco Rd',
        addressLocality: 'San Antonio',
        addressRegion: 'TX',
        postalCode: '78258',
        addressCountry: 'US'
      }
    },
    baseSalary: job.payRange ? {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        minValue: job.payRange.min,
        maxValue: job.payRange.max,
        unitText: 'YEAR'
      }
    } : undefined,
    employmentType: 'FULL_TIME',
    directApply: true,
    applicationContact: {
      '@type': 'ContactPoint',
      url: `${APP_URL}/apply/${job.id}`
    }
  }))

  const script = document.createElement('script')
  script.id = 'job-structured-data'
  script.type = 'application/ld+json'
  script.textContent = JSON.stringify(jsonLd)
  document.head.appendChild(script)
}

export default function JobListings() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadJobs() {
      try {
        const q = query(
          collection(db, 'jobs'),
          where('status', '==', 'active'),
          orderBy('createdAt', 'desc')
        )
        const snap = await getDocs(q)
        const loadedJobs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setJobs(loadedJobs)
        injectJobStructuredData(loadedJobs)
      } catch (err) {
        console.error('Failed to load jobs:', err)
      } finally {
        setLoading(false)
      }
    }
    loadJobs()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-16">
        <div className="text-center mb-10">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-xl font-bold">SA</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Join San Antonio Dodge</h1>
          <p className="text-gray-500 mt-2">Explore open positions and start your interview today</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
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
                className="block bg-white rounded-2xl border border-gray-200 p-6 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{job.title}</h2>
                    <p className="text-sm text-gray-500 mt-0.5">San Antonio Dodge</p>
                    {job.description && (
                      <p className="text-sm text-gray-500 mt-2 line-clamp-2">{job.description}</p>
                    )}
                  </div>
                  <span className="shrink-0 bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-xl">
                    Start Interview
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="flex justify-end mt-12">
          <Link to="/admin/login" className="text-xs text-gray-400 hover:text-gray-600">
            Admin
          </Link>
        </div>
      </div>
    </div>
  )
}
