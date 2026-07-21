import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { PLATFORM_NAME } from '../config/organization'
import {
  buildEmployerWorkQueue,
  derivedEmployerStage,
  employerDisplayName,
  employerStats,
  formatDate,
  priorityLabel,
  priorityTone,
  stageLabel,
  stageTone,
} from '../utils/employerCrm'

function contactStatus(contact) {
  if (contact.status === 'interested') return 'Interested'
  if (contact.status === 'engaged_video') return 'Clicked video'
  if (contact.status === 'clicked') return 'Clicked'
  return 'Sent'
}

export default function AdminEmployers() {
  const [employers, setEmployers] = useState([])
  const [contacts, setContacts] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const unsubEmployers = onSnapshot(
      query(collection(db, 'employers'), orderBy('lastSharedAt', 'desc')),
      snap => setEmployers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))),
      () => setEmployers([])
    )
    const unsubContacts = onSnapshot(
      query(collection(db, 'employerContacts'), orderBy('lastSharedAt', 'desc')),
      snap => setContacts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))),
      () => setContacts([])
    )
    const unsubCampaigns = onSnapshot(
      query(collection(db, 'campaigns'), orderBy('createdAt', 'desc')),
      snap => setCampaigns(snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))),
      () => setCampaigns([])
    )
    return () => {
      unsubEmployers()
      unsubContacts()
      unsubCampaigns()
    }
  }, [])

  const contactsByEmployer = useMemo(() => {
    const map = new Map()
    contacts.forEach(contact => {
      const list = map.get(contact.employerId) || []
      list.push(contact)
      map.set(contact.employerId, list)
    })
    return map
  }, [contacts])

  const visibleEmployers = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return employers
    return employers.filter(employer => {
      const employerContacts = contactsByEmployer.get(employer.id) || []
      const hay = [
        employer.name,
        employer.domain,
        employer.crmStage,
        employer.nextAction,
        employer.crmNotes,
        ...(employer.contactEmails || []),
        ...employerContacts.map(contact => contact.email),
      ].join(' ').toLowerCase()
      return hay.includes(needle)
    })
  }, [contactsByEmployer, employers, search])

  const employerQueue = useMemo(() => (
    buildEmployerWorkQueue(employers, contacts, campaigns)
  ), [campaigns, contacts, employers])
  const highPriorityQueueCount = employerQueue.filter(item => item.priority === 'high').length

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/brand-mark.png" alt="Insight Edge" className="w-7 h-7 object-contain" />
            <div>
              <p className="text-xs text-gray-500">{PLATFORM_NAME}</p>
              <h1 className="text-sm font-semibold text-gray-900">Employers</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/admin/dashboard')} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Dashboard</button>
            <button onClick={() => navigate('/admin/analytics')} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Analytics</button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 py-6 space-y-5">
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Employer CRM</h2>
              <p className="text-sm text-gray-500 mt-1">Tracks who received candidate campaigns, who clicked, who watched videos, and who signaled interest.</p>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employer, domain, or contact"
              className="w-full md:w-80 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Metric label="Employers" value={employers.length} />
          <Metric label="Contacts" value={contacts.length} />
          <Metric label="Campaigns" value={campaigns.length} />
          <Metric label="Interested signals" value={campaigns.reduce((sum, campaign) => sum + Number(campaign.actionCounts?.interested || 0) + Number(campaign.actionCounts?.schedule_interview || 0), 0)} />
        </section>

        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Employer action queue</h3>
              <p className="text-xs text-gray-500 mt-0.5">Warm accounts, overdue next actions, and follow-ups that should move outreach toward interviews or client conversations.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full">{employerQueue.length} open</span>
              {highPriorityQueueCount > 0 && (
                <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">{highPriorityQueueCount} high</span>
              )}
            </div>
          </div>
          {employerQueue.length === 0 ? (
            <p className="text-sm text-gray-400 px-5 py-6">No employer follow-up is due right now.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {employerQueue.slice(0, 10).map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(`/admin/employers/${item.employer.id}`)}
                  className="w-full px-5 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-left hover:bg-blue-50/50"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <PriorityBadge priority={item.priority} />
                      <StageBadge stage={item.stage} />
                      <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                    </div>
                    <p className="text-sm text-gray-800 mt-1">{employerDisplayName(item.employer)}</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.detail}</p>
                  </div>
                  <div className="md:text-right shrink-0">
                    <p className="text-xs text-gray-400">{item.meta}</p>
                    <span className="inline-flex mt-1 text-xs font-medium text-blue-700">Open account</span>
                  </div>
                </button>
              ))}
              {employerQueue.length > 10 && (
                <p className="px-5 py-3 text-xs text-gray-400 bg-gray-50">Showing the first 10 of {employerQueue.length} employer queue items.</p>
              )}
            </div>
          )}
        </section>

        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {visibleEmployers.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No employer campaign records yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {visibleEmployers.map(employer => {
                const stats = employerStats(employer, contacts, campaigns)
                const employerContacts = stats.contacts
                const employerCampaigns = stats.campaigns
                const stage = derivedEmployerStage(employer, stats)
                return (
                  <div key={employer.id} className="p-5">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-gray-900">{employerDisplayName(employer)}</h3>
                          <StageBadge stage={stage} />
                          <PriorityBadge priority={employer.crmPriority || 'medium'} />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{employer.domain || 'No domain'} - Last shared {formatDate(employer.lastSharedAt)}</p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <Badge>{employerContacts.length} contact{employerContacts.length === 1 ? '' : 's'}</Badge>
                          <Badge>{employerCampaigns.length} campaign{employerCampaigns.length === 1 ? '' : 's'}</Badge>
                          <Badge>{stats.clicks} click{stats.clicks === 1 ? '' : 's'}</Badge>
                          <Badge>{stats.videoClicks} video click{stats.videoClicks === 1 ? '' : 's'}</Badge>
                        </div>
                        {employer.nextAction && (
                          <p className="text-xs text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mt-3">
                            <span className="font-semibold">Next:</span> {employer.nextAction}
                            {employer.nextActionDue ? <span className="text-blue-600"> - {formatDate(employer.nextActionDue)}</span> : null}
                          </p>
                        )}
                      </div>
                      <div className="lg:text-right">
                        <p className="text-xs font-semibold text-gray-500 uppercase">Latest campaign</p>
                        <p className="text-sm text-gray-800 mt-1">{employerCampaigns[0]?.subject || 'No campaign subject'}</p>
                        <p className="text-xs text-gray-400 mt-1">{formatDate(employerCampaigns[0]?.createdAt)}</p>
                        <button
                          type="button"
                          onClick={() => navigate(`/admin/employers/${employer.id}`)}
                          className="text-xs font-medium text-blue-700 border border-blue-100 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg mt-3"
                        >
                          Open account
                        </button>
                      </div>
                    </div>

                    {employerContacts.length > 0 && (
                      <div className="mt-4 border border-gray-100 rounded-xl overflow-hidden">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                              <th className="text-left text-[11px] font-semibold text-gray-500 px-3 py-2">Contact</th>
                              <th className="text-left text-[11px] font-semibold text-gray-500 px-3 py-2">Status</th>
                              <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">Clicks</th>
                              <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">Videos</th>
                              <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">Last action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {employerContacts.slice(0, 8).map(contact => (
                              <tr key={contact.id} className="border-b border-gray-50 last:border-0">
                                <td className="px-3 py-2 text-xs text-gray-800">{contact.email}</td>
                                <td className="px-3 py-2 text-xs text-gray-600">{contactStatus(contact)}</td>
                                <td className="px-3 py-2 text-xs text-gray-700 text-right">{contact.clickCount || 0}</td>
                                <td className="px-3 py-2 text-xs text-gray-700 text-right">{contact.videoClickCount || 0}</td>
                                <td className="px-3 py-2 text-xs text-gray-400 text-right">{formatDate(contact.lastActionAt || contact.lastClickedAt || contact.lastSharedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  )
}

function StageBadge({ stage }) {
  return (
    <span className={`text-[11px] font-semibold border px-2 py-0.5 rounded-full ${stageTone(stage)}`}>
      {stageLabel(stage)}
    </span>
  )
}

function PriorityBadge({ priority }) {
  return (
    <span className={`text-[11px] font-semibold border px-2 py-0.5 rounded-full ${priorityTone(priority)}`}>
      {priorityLabel(priority)}
    </span>
  )
}

function Badge({ children }) {
  return (
    <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">{children}</span>
  )
}
