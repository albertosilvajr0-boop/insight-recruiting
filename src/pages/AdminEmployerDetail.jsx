import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { PLATFORM_NAME } from '../config/organization'
import {
  EMPLOYER_OUTCOME_OPTIONS,
  EMPLOYER_PRIORITY_OPTIONS,
  EMPLOYER_STAGE_OPTIONS,
  dateTimeLocalValue,
  derivedEmployerStage,
  employerDisplayName,
  employerStats,
  formatDate,
  localInputToIso,
  outcomeLabel,
  priorityLabel,
  priorityTone,
  stageLabel,
  stageTone,
  toDate,
} from '../utils/employerCrm'

function emptyForm() {
  return {
    crmStage: 'prospect',
    crmPriority: 'medium',
    crmOwnerName: '',
    nextAction: '',
    nextActionDue: '',
    crmNotes: '',
  }
}

function emptyOutcomeForm() {
  return {
    outcome: 'manual_note',
    contactId: '',
    campaignId: '',
    note: '',
    nextAction: '',
    nextActionDue: '',
  }
}

function contactStatus(contact) {
  if (contact.status === 'interested') return 'Interested'
  if (contact.status === 'engaged_video' || contact.status === 'watched_video') return 'Watched video'
  if (contact.status === 'clicked') return 'Clicked'
  if (contact.status === 'do_not_contact') return 'Do not contact'
  return 'Sent'
}

function activityDate(activity) {
  return toDate(activity.createdAt) || toDate(activity.at) || toDate(activity.createdAtIso)
}

function activityTitle(activity) {
  if (activity.outcome) return outcomeLabel(activity.outcome)
  if (activity.action) return outcomeLabel(activity.action)
  return 'Activity'
}

function candidateName(candidate) {
  return candidate.name || `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || 'Candidate'
}

function uniqueCandidateSummaries(campaigns) {
  const map = new Map()
  campaigns.forEach(campaign => {
    ;(campaign.candidateSummaries || []).forEach(candidate => {
      const id = candidate.candidateId || candidate.name
      if (!id || map.has(id)) return
      map.set(id, candidate)
    })
  })
  return Array.from(map.values()).sort((a, b) => candidateName(a).localeCompare(candidateName(b)))
}

export default function AdminEmployerDetail() {
  const { employerId } = useParams()
  const navigate = useNavigate()
  const [employer, setEmployer] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [contacts, setContacts] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [activities, setActivities] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [outcomeForm, setOutcomeForm] = useState(emptyOutcomeForm)
  const [saving, setSaving] = useState(false)
  const [logging, setLogging] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    const unsubEmployer = onSnapshot(
      doc(db, 'employers', employerId),
      snap => {
        if (!snap.exists()) {
          setEmployer(null)
          setNotFound(true)
          return
        }
        setNotFound(false)
        setEmployer({ id: snap.id, ...snap.data() })
      },
      () => setNotFound(true)
    )
    const unsubContacts = onSnapshot(
      query(collection(db, 'employerContacts'), orderBy('lastSharedAt', 'desc')),
      snap => setContacts(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(contact => contact.employerId === employerId)),
      () => setContacts([])
    )
    const unsubCampaigns = onSnapshot(
      query(collection(db, 'campaigns'), orderBy('createdAt', 'desc')),
      snap => setCampaigns(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(campaign => (campaign.employerIds || []).includes(employerId))),
      () => setCampaigns([])
    )
    const unsubActivities = onSnapshot(
      query(collection(db, 'employerActivities'), orderBy('createdAt', 'desc')),
      snap => setActivities(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(activity => activity.employerId === employerId)),
      () => setActivities([])
    )
    return () => {
      unsubEmployer()
      unsubContacts()
      unsubCampaigns()
      unsubActivities()
    }
  }, [employerId])

  const stats = useMemo(() => (
    employer ? employerStats(employer, contacts, campaigns) : { contacts: [], campaigns: [], clicks: 0, videoClicks: 0, interested: 0 }
  ), [campaigns, contacts, employer])

  const stage = useMemo(() => (
    employer ? derivedEmployerStage(employer, stats) : 'prospect'
  ), [employer, stats])

  const candidateSummaries = useMemo(() => uniqueCandidateSummaries(campaigns), [campaigns])

  const timeline = useMemo(() => {
    const campaignActions = campaigns.flatMap(campaign => [
      ...(campaign.actions || []).map((action, index) => ({
        ...action,
        id: `${campaign.id}:${action.action || 'action'}:${action.at || index}`,
        campaignId: campaign.id,
        subject: campaign.subject,
      })),
      ...(campaign.crmActions || []).map((action, index) => ({
        ...action,
        id: `${campaign.id}:${action.outcome || 'crm'}:${action.createdAtIso || index}`,
        campaignId: campaign.id,
        subject: campaign.subject,
      })),
    ])
    return [...activities, ...campaignActions]
      .sort((a, b) => (activityDate(b)?.getTime() || 0) - (activityDate(a)?.getTime() || 0))
      .slice(0, 30)
  }, [activities, campaigns])

  useEffect(() => {
    if (!employer) return
    setForm({
      crmStage: employer.crmStage || stage,
      crmPriority: employer.crmPriority || 'medium',
      crmOwnerName: employer.crmOwnerName || '',
      nextAction: employer.nextAction || '',
      nextActionDue: dateTimeLocalValue(employer.nextActionDue),
      crmNotes: employer.crmNotes || '',
    })
  }, [employer, stage])

  const updateForm = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setNotice(null)
  }

  const updateOutcomeForm = (field, value) => {
    setOutcomeForm(prev => ({ ...prev, [field]: value }))
    setNotice(null)
  }

  const saveAccount = async () => {
    if (!employer || saving) return
    setSaving(true)
    setNotice(null)
    try {
      const updateEmployerCrm = httpsCallable(functions, 'updateEmployerCrm')
      await updateEmployerCrm({
        employerId,
        crmStage: form.crmStage,
        crmPriority: form.crmPriority,
        crmOwnerName: form.crmOwnerName,
        nextAction: form.nextAction,
        nextActionDue: localInputToIso(form.nextActionDue),
        crmNotes: form.crmNotes,
      })
      setNotice({ type: 'success', message: 'Employer account updated.' })
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Could not save employer account.' })
    } finally {
      setSaving(false)
    }
  }

  const logOutcome = async () => {
    if (!employer || logging) return
    setLogging(true)
    setNotice(null)
    try {
      const selectedContact = contacts.find(contact => contact.id === outcomeForm.contactId)
      const payload = {
        employerId,
        outcome: outcomeForm.outcome,
        note: outcomeForm.note,
      }
      if (outcomeForm.contactId) payload.contactId = outcomeForm.contactId
      if (selectedContact?.email) payload.contactEmail = selectedContact.email
      if (outcomeForm.campaignId) payload.campaignId = outcomeForm.campaignId
      if (outcomeForm.nextAction.trim() || outcomeForm.nextActionDue) {
        payload.nextAction = outcomeForm.nextAction
        payload.nextActionDue = localInputToIso(outcomeForm.nextActionDue)
      }
      const logEmployerOutcome = httpsCallable(functions, 'logEmployerOutcome')
      await logEmployerOutcome(payload)
      setOutcomeForm(emptyOutcomeForm())
      setNotice({ type: 'success', message: 'Employer outcome logged.' })
    } catch (err) {
      setNotice({ type: 'error', message: err?.message || 'Could not log employer outcome.' })
    } finally {
      setLogging(false)
    }
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center max-w-md">
          <h1 className="text-lg font-semibold text-gray-900">Employer not found</h1>
          <p className="text-sm text-gray-500 mt-2">This employer account may have been removed or is not available to your account.</p>
          <button onClick={() => navigate('/admin/employers')} className="text-sm font-medium text-blue-700 border border-blue-100 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg mt-5">
            Back to employers
          </button>
        </div>
      </div>
    )
  }

  if (!employer) {
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
              <h1 className="text-sm font-semibold text-gray-900 truncate">Employer account</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/admin/employers')} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Employers</button>
            <button onClick={() => navigate('/admin/dashboard')} className="text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">Dashboard</button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 py-6 space-y-5">
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold text-gray-900">{employerDisplayName(employer)}</h2>
                <StageBadge stage={stage} />
                <PriorityBadge priority={employer.crmPriority || 'medium'} />
              </div>
              <p className="text-sm text-gray-500 mt-1">{employer.domain || 'No domain'} - Last shared {formatDate(employer.lastSharedAt)}</p>
              {employer.nextAction && (
                <p className="text-sm text-blue-900 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mt-4">
                  <span className="font-semibold">Next action:</span> {employer.nextAction}
                  {employer.nextActionDue ? <span className="text-blue-700"> - {formatDate(employer.nextActionDue)}</span> : null}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:w-[520px]">
              <Metric label="Contacts" value={contacts.length} />
              <Metric label="Campaigns" value={campaigns.length} />
              <Metric label="Clicks" value={stats.clicks} />
              <Metric label="Video clicks" value={stats.videoClicks} />
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

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900">Account controls</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Stage</span>
                <select value={form.crmStage} onChange={(e) => updateForm('crmStage', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {EMPLOYER_STAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Priority</span>
                <select value={form.crmPriority} onChange={(e) => updateForm('crmPriority', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {EMPLOYER_PRIORITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="block text-xs font-medium text-gray-600 mb-1">Owner</span>
                <input value={form.crmOwnerName} onChange={(e) => updateForm('crmOwnerName', e.target.value)} placeholder="Admin owner" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Next action</span>
                <input value={form.nextAction} onChange={(e) => updateForm('nextAction', e.target.value)} placeholder="Call, follow up, send more candidates..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Due</span>
                <input type="datetime-local" value={form.nextActionDue} onChange={(e) => updateForm('nextActionDue', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block md:col-span-2">
                <span className="block text-xs font-medium text-gray-600 mb-1">Account notes</span>
                <textarea value={form.crmNotes} onChange={(e) => updateForm('crmNotes', e.target.value)} rows={5} maxLength={1800} placeholder="Relationship notes, hiring needs, preferences, objections, or next angle." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            </div>
            <div className="flex justify-end mt-4">
              <button type="button" onClick={saveAccount} disabled={saving} className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-4 py-2 rounded-lg">
                {saving ? 'Saving...' : 'Save account'}
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-900">Log reply or outcome</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Outcome</span>
                <select value={outcomeForm.outcome} onChange={(e) => updateOutcomeForm('outcome', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {EMPLOYER_OUTCOME_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Contact</span>
                <select value={outcomeForm.contactId} onChange={(e) => updateOutcomeForm('contactId', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">No specific contact</option>
                  {contacts.map(contact => <option key={contact.id} value={contact.id}>{contact.email}</option>)}
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="block text-xs font-medium text-gray-600 mb-1">Campaign</span>
                <select value={outcomeForm.campaignId} onChange={(e) => updateOutcomeForm('campaignId', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">No specific campaign</option>
                  {campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.subject || campaign.id}</option>)}
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="block text-xs font-medium text-gray-600 mb-1">Note</span>
                <textarea value={outcomeForm.note} onChange={(e) => updateOutcomeForm('note', e.target.value)} rows={4} maxLength={1200} placeholder="Paste reply, call notes, objection, interest level, or what they asked for." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Follow-up action</span>
                <input value={outcomeForm.nextAction} onChange={(e) => updateOutcomeForm('nextAction', e.target.value)} placeholder="Optional next step" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Follow-up due</span>
                <input type="datetime-local" value={outcomeForm.nextActionDue} onChange={(e) => updateOutcomeForm('nextActionDue', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            </div>
            <div className="flex justify-end mt-4">
              <button type="button" onClick={logOutcome} disabled={logging} className="text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-60 px-4 py-2 rounded-lg">
                {logging ? 'Logging...' : 'Log outcome'}
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden xl:col-span-2">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Contacts</h3>
              <span className="text-xs text-gray-400">{contacts.length}</span>
            </div>
            {contacts.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-6">No contacts recorded for this employer yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left text-[11px] font-semibold text-gray-500 px-4 py-2">Contact</th>
                      <th className="text-left text-[11px] font-semibold text-gray-500 px-3 py-2">Status</th>
                      <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">Clicks</th>
                      <th className="text-right text-[11px] font-semibold text-gray-500 px-3 py-2">Videos</th>
                      <th className="text-right text-[11px] font-semibold text-gray-500 px-4 py-2">Last action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map(contact => (
                      <tr key={contact.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-3 text-xs text-gray-800">{contact.email}</td>
                        <td className="px-3 py-3 text-xs text-gray-600">{contactStatus(contact)}</td>
                        <td className="px-3 py-3 text-xs text-gray-700 text-right">{contact.clickCount || 0}</td>
                        <td className="px-3 py-3 text-xs text-gray-700 text-right">{contact.videoClickCount || 0}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 text-right">{formatDate(contact.lastOutcomeAt || contact.lastActionAt || contact.lastClickedAt || contact.lastSharedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Timeline</h3>
              <span className="text-xs text-gray-400">{timeline.length}</span>
            </div>
            {timeline.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-6">No employer activity logged yet.</p>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
                {timeline.map((activity, index) => (
                  <div key={activity.id || index} className="px-5 py-3">
                    <p className="text-xs font-semibold text-gray-900">{activityTitle(activity)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(activityDate(activity))}{activity.actorEmail ? ` - ${activity.actorEmail}` : ''}</p>
                    {activity.note && <p className="text-xs text-gray-600 mt-1">{activity.note}</p>}
                    {activity.subject && <p className="text-[11px] text-blue-700 mt-1">{activity.subject}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Candidates sent</h3>
              <span className="text-xs text-gray-400">{candidateSummaries.length}</span>
            </div>
            {candidateSummaries.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-6">No candidates have been attached to this employer yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {candidateSummaries.map(candidate => (
                  <button
                    key={candidate.candidateId || candidate.name}
                    type="button"
                    onClick={() => candidate.candidateId && navigate(`/admin/candidates/${candidate.candidateId}`)}
                    className="w-full px-5 py-4 text-left hover:bg-gray-50 flex items-start justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{candidateName(candidate)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{candidate.jobTitle || 'Open role'} - {candidate.videoCount || 0} video link{candidate.videoCount === 1 ? '' : 's'}</p>
                    </div>
                    <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-1 rounded-full">
                      {Number.isFinite(Number(candidate.aiScore)) ? `${Number(candidate.aiScore).toFixed(1)}/5` : 'Pending'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Campaigns</h3>
              <span className="text-xs text-gray-400">{campaigns.length}</span>
            </div>
            {campaigns.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-6">No campaigns recorded for this employer yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {campaigns.map(campaign => (
                  <div key={campaign.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{campaign.subject || 'Candidate campaign'}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{formatDate(campaign.createdAt)} - {campaign.candidateIds?.length || 0} candidate{campaign.candidateIds?.length === 1 ? '' : 's'}</p>
                      </div>
                      <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded-full">{campaign.status || 'sent'}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Badge>{campaign.sentCount || 0} sent</Badge>
                      <Badge>{campaign.clickCount || 0} clicks</Badge>
                      <Badge>{campaign.videoClickCount || 0} videos</Badge>
                      <Badge>{Number(campaign.actionCounts?.interested || 0) + Number(campaign.actionCounts?.schedule_interview || 0)} interested</Badge>
                    </div>
                    {campaign.reviewUrl && (
                      <a href={campaign.reviewUrl} target="_blank" rel="noreferrer" className="inline-flex text-xs font-medium text-blue-700 mt-3">
                        Open review page
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
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
