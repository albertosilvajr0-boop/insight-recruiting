import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { PLATFORM_NAME } from '../config/organization'
import {
  CAMPAIGN_SEQUENCE_STEPS,
  CONTACT_CHANNEL_OPTIONS,
  buildOutreachDraft,
  campaignCandidateSummaries,
  channelLabel,
  contactDisplayName,
  contactSubtitle,
  employerDisplayName,
  formatDate,
  outcomeLabel,
  sequenceStepLabel,
  toDate,
} from '../utils/employerCrm'

function candidateName(candidate) {
  return candidate?.name || `${candidate?.firstName || ''} ${candidate?.lastName || ''}`.trim() || 'Candidate'
}

function scoreLabel(value) {
  const score = Number(value)
  return Number.isFinite(score) ? `${score.toFixed(1)}/10` : 'Pending'
}

function activityDate(activity) {
  return toDate(activity.createdAt) || toDate(activity.at) || toDate(activity.createdAtIso) || toDate(activity.completedAtIso)
}

function activityTitle(activity) {
  if (activity.sequenceStep) return `Sequence: ${sequenceStepLabel(activity.sequenceStep)}`
  if (activity.outcome) return outcomeLabel(activity.outcome)
  if (activity.action) return outcomeLabel(activity.action)
  return 'Activity'
}

export default function AdminCampaignDetail() {
  const { campaignId } = useParams()
  const navigate = useNavigate()
  const [campaign, setCampaign] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [employers, setEmployers] = useState([])
  const [contacts, setContacts] = useState([])
  const [activities, setActivities] = useState([])
  const [selectedEmployerId, setSelectedEmployerId] = useState('')
  const [selectedContactId, setSelectedContactId] = useState('')
  const [medium, setMedium] = useState('email')
  const [copiedKey, setCopiedKey] = useState('')
  const [savingStep, setSavingStep] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    const unsubCampaign = onSnapshot(
      doc(db, 'campaigns', campaignId),
      snap => {
        if (!snap.exists()) {
          setCampaign(null)
          setNotFound(true)
          return
        }
        setNotFound(false)
        setCampaign({ id: snap.id, ...snap.data() })
      },
      () => setNotFound(true)
    )
    const unsubEmployers = onSnapshot(
      query(collection(db, 'employers'), orderBy('updatedAt', 'desc')),
      snap => setEmployers(snap.docs.map(item => ({ id: item.id, ...item.data() }))),
      () => setEmployers([])
    )
    const unsubContacts = onSnapshot(
      query(collection(db, 'employerContacts'), orderBy('updatedAt', 'desc')),
      snap => setContacts(snap.docs.map(item => ({ id: item.id, ...item.data() }))),
      () => setContacts([])
    )
    const unsubActivities = onSnapshot(
      query(collection(db, 'employerActivities'), orderBy('createdAt', 'desc')),
      snap => setActivities(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(activity => activity.campaignId === campaignId)),
      () => setActivities([])
    )
    return () => {
      unsubCampaign()
      unsubEmployers()
      unsubContacts()
      unsubActivities()
    }
  }, [campaignId])

  const campaignEmployers = useMemo(() => (
    employers.filter(employer => (campaign?.employerIds || []).includes(employer.id))
  ), [campaign, employers])

  const selectedEmployer = useMemo(() => (
    campaignEmployers.find(employer => employer.id === selectedEmployerId) || campaignEmployers[0] || null
  ), [campaignEmployers, selectedEmployerId])

  const campaignContacts = useMemo(() => (
    contacts.filter(contact => (campaign?.contactEmails || []).includes(contact.email) || (selectedEmployer?.id && contact.employerId === selectedEmployer.id))
  ), [campaign, contacts, selectedEmployer])

  const selectedContact = useMemo(() => (
    campaignContacts.find(contact => contact.id === selectedContactId) || campaignContacts[0] || null
  ), [campaignContacts, selectedContactId])

  const candidates = useMemo(() => campaignCandidateSummaries(campaign), [campaign])

  const timeline = useMemo(() => {
    const campaignActions = [
      ...(campaign?.actions || []).map((action, index) => ({
        ...action,
        id: `${campaign.id}:action:${action.at || index}`,
      })),
      ...(campaign?.crmActions || []).map((action, index) => ({
        ...action,
        id: `${campaign.id}:crm:${action.createdAtIso || index}`,
      })),
      ...(campaign?.sequenceHistory || []).map((action, index) => ({
        ...action,
        id: `${campaign.id}:sequence:${action.completedAtIso || index}`,
      })),
    ]
    return [...activities, ...campaignActions]
      .sort((a, b) => (activityDate(b)?.getTime() || 0) - (activityDate(a)?.getTime() || 0))
      .slice(0, 40)
  }, [activities, campaign])

  useEffect(() => {
    if (!selectedEmployerId && campaignEmployers[0]?.id) setSelectedEmployerId(campaignEmployers[0].id)
  }, [campaignEmployers, selectedEmployerId])

  useEffect(() => {
    if (!selectedContactId && campaignContacts[0]?.id) setSelectedContactId(campaignContacts[0].id)
  }, [campaignContacts, selectedContactId])

  useEffect(() => {
    if (selectedContact?.preferredChannel) setMedium(selectedContact.preferredChannel)
  }, [selectedContact])

  const sequenceDraft = (stepId) => buildOutreachDraft({
    stepId,
    medium,
    employer: selectedEmployer,
    contact: selectedContact,
    campaign,
    reviewUrl: campaign?.reviewUrl,
  })

  const copyDraft = async (stepId) => {
    const key = `${stepId}:${medium}`
    try {
      await navigator.clipboard.writeText(sequenceDraft(stepId))
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey(current => current === key ? '' : current), 1600)
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Could not copy draft.' })
    }
  }

  const markStepComplete = async (stepId) => {
    if (!campaign || savingStep) return
    setSavingStep(stepId)
    setNotice(null)
    try {
      const recordCampaignSequenceStep = httpsCallable(functions, 'recordCampaignSequenceStep')
      await recordCampaignSequenceStep({
        campaignId,
        employerId: selectedEmployer?.id || undefined,
        step: stepId,
        medium,
        contactId: selectedContact?.id || undefined,
        contactEmail: selectedContact?.email || undefined,
        note: `Marked ${sequenceStepLabel(stepId)} complete from campaign workspace.`,
      })
      setNotice({ type: 'success', message: `${sequenceStepLabel(stepId)} marked complete.` })
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Could not update sequence step.' })
    } finally {
      setSavingStep(null)
    }
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center max-w-md">
          <h1 className="text-lg font-semibold text-gray-900">Campaign not found</h1>
          <p className="text-sm text-gray-500 mt-2">This campaign may have been removed or is not available to your account.</p>
          <button onClick={() => navigate('/admin/employers')} className="text-sm font-medium text-blue-700 border border-blue-100 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg mt-5">
            Back to employers
          </button>
        </div>
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/brand-mark.png" alt="Insight Edge" className="w-7 h-7 object-contain shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-gray-500">{PLATFORM_NAME}</p>
              <h1 className="text-sm font-semibold text-gray-900 truncate">Campaign workspace</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/admin/employers')} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Employers</button>
            <button onClick={() => navigate('/admin/analytics')} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Analytics</button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 py-6 space-y-5">
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">{campaign.subject || 'Candidate campaign'}</h2>
              <p className="text-sm text-gray-500 mt-1">
                {formatDate(campaign.createdAt)} - {campaignEmployers.map(employerDisplayName).join(', ') || campaign.employerNames?.join(', ') || 'Employer campaign'}
              </p>
              {campaign.reviewUrl && (
                <a href={campaign.reviewUrl} target="_blank" rel="noreferrer" className="inline-flex text-xs font-medium text-blue-700 border border-blue-100 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg mt-3">
                  Open review page
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 lg:w-[620px]">
              <Metric label="Recipients" value={campaign.sentCount || campaign.contactEmails?.length || 0} />
              <Metric label="Candidates" value={campaign.candidateIds?.length || candidates.length} />
              <Metric label="Clicks" value={campaign.clickCount || 0} />
              <Metric label="Videos" value={Number(campaign.videoClickCount || 0) + Number(campaign.actionCounts?.view_video || 0)} />
              <Metric label="Interested" value={Number(campaign.actionCounts?.interested || 0) + Number(campaign.actionCounts?.schedule_interview || 0)} />
            </div>
          </div>
        </section>

        {notice && (
          <div className={`text-sm rounded-xl px-4 py-3 border ${
            notice.type === 'success'
              ? 'bg-green-50 border-green-100 text-green-800'
              : 'bg-red-50 border-red-100 text-red-800'
          }`}>
            {notice.message}
          </div>
        )}

        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Sequence playbook</h3>
              <p className="text-xs text-gray-500 mt-0.5">Copy the next touch, send manually, then mark it complete so the campaign history stays clean.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 lg:w-[640px]">
              <select value={selectedEmployer?.id || ''} onChange={(e) => setSelectedEmployerId(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {campaignEmployers.map(employer => <option key={employer.id} value={employer.id}>{employerDisplayName(employer)}</option>)}
              </select>
              <select value={selectedContact?.id || ''} onChange={(e) => setSelectedContactId(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {campaignContacts.length === 0 ? <option value="">No contacts</option> : campaignContacts.map(contact => <option key={contact.id} value={contact.id}>{contactDisplayName(contact)}</option>)}
              </select>
              <select value={medium} onChange={(e) => setMedium(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {CONTACT_CHANNEL_OPTIONS.filter(option => ['email', 'linkedin', 'sms', 'whatsapp'].includes(option.value)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {CAMPAIGN_SEQUENCE_STEPS.map(step => {
              const complete = campaign.sequenceSteps?.[step.id]
              const key = `${step.id}:${medium}`
              const isSaving = savingStep === step.id
              return (
                <div key={step.id} className="px-5 py-4">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">{step.timing}</span>
                        <p className="text-sm font-semibold text-gray-900">{step.label}</p>
                        {complete && <span className="text-[11px] font-semibold text-green-700 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">Complete</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{step.goal}</p>
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-xl p-3 mt-3 max-h-40 overflow-y-auto font-sans">{sequenceDraft(step.id)}</pre>
                    </div>
                    <div className="shrink-0 flex lg:flex-col gap-2">
                      <button type="button" onClick={() => copyDraft(step.id)} className="text-xs font-medium text-blue-700 border border-blue-100 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg">
                        {copiedKey === key ? 'Copied' : `Copy ${channelLabel(medium)}`}
                      </button>
                      <button type="button" onClick={() => markStepComplete(step.id)} disabled={isSaving} className="text-xs font-medium text-gray-700 border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-60 px-3 py-2 rounded-lg">
                        {isSaving ? 'Saving...' : 'Mark complete'}
                      </button>
                    </div>
                  </div>
                  {complete?.completedAtIso && <p className="text-[11px] text-gray-400 mt-2">Last completed {formatDate(complete.completedAtIso)} by {complete.actorEmail || 'admin'} via {channelLabel(complete.medium)}</p>}
                </div>
              )
            })}
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden xl:col-span-2">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Recipients and contacts</h3>
              <span className="text-xs text-gray-400">{campaignContacts.length}</span>
            </div>
            {campaignContacts.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-6">No contacts found for this campaign yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {campaignContacts.map(contact => (
                  <button key={contact.id} type="button" onClick={() => contact.employerId && navigate(`/admin/employers/${contact.employerId}`)} className="w-full px-5 py-4 text-left hover:bg-gray-50 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{contactDisplayName(contact)}</p>
                      {contactSubtitle(contact) && <p className="text-xs text-gray-500 mt-0.5">{contactSubtitle(contact)}</p>}
                      {Array.isArray(contact.tags) && contact.tags.length > 0 && <p className="text-[11px] text-gray-400 mt-1">{contact.tags.join(', ')}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium text-gray-700">{channelLabel(contact.preferredChannel || 'email')}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{contact.videoClickCount || 0} video clicks</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Timeline</h3>
              <span className="text-xs text-gray-400">{timeline.length}</span>
            </div>
            {timeline.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-6">No campaign activity logged yet.</p>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
                {timeline.map((activity, index) => (
                  <div key={activity.id || index} className="px-5 py-3">
                    <p className="text-xs font-semibold text-gray-900">{activityTitle(activity)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(activityDate(activity))}{activity.actorEmail ? ` - ${activity.actorEmail}` : ''}</p>
                    {activity.note && <p className="text-xs text-gray-600 mt-1">{activity.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Candidates in campaign</h3>
            <span className="text-xs text-gray-400">{candidates.length}</span>
          </div>
          {candidates.length === 0 ? (
            <p className="text-sm text-gray-400 px-5 py-6">No candidate snapshots are attached to this campaign.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {candidates.map(candidate => (
                <button key={candidate.candidateId || candidate.name} type="button" onClick={() => candidate.candidateId && navigate(`/admin/candidates/${candidate.candidateId}`)} className="w-full px-5 py-4 text-left hover:bg-gray-50 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{candidateName(candidate)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{candidate.jobTitle || 'Open role'} - {candidate.videoCount || 0} video link{candidate.videoCount === 1 ? '' : 's'}</p>
                    {candidate.strengths?.length > 0 && <p className="text-xs text-green-700 mt-1">{candidate.strengths.slice(0, 2).join(' - ')}</p>}
                  </div>
                  <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-1 rounded-full">{scoreLabel(candidate.aiScore)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="border border-gray-100 bg-gray-50 rounded-xl p-3">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className="text-lg font-semibold text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}
