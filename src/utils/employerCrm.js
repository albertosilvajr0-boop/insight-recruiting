export const EMPLOYER_STAGE_OPTIONS = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'clicked', label: 'Clicked' },
  { value: 'watched_video', label: 'Watched video' },
  { value: 'interested', label: 'Interested' },
  { value: 'interview_requested', label: 'Interview requested' },
  { value: 'active_client', label: 'Active client' },
  { value: 'nurture', label: 'Nurture' },
  { value: 'do_not_contact', label: 'Do not contact' },
]

export const EMPLOYER_PRIORITY_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

export const EMPLOYER_OUTCOME_OPTIONS = [
  { value: 'manual_note', label: 'Manual note' },
  { value: 'follow_up_sent', label: 'Follow-up sent' },
  { value: 'left_voicemail', label: 'Left voicemail' },
  { value: 'reply_interested', label: 'Reply: interested' },
  { value: 'wants_more_candidates', label: 'Wants more candidates' },
  { value: 'interview_requested', label: 'Interview requested' },
  { value: 'not_a_fit', label: 'Not a fit' },
  { value: 'not_hiring', label: 'Not hiring right now' },
  { value: 'wrong_contact', label: 'Wrong contact' },
  { value: 'sent_to_hr', label: 'Sent to HR/manager' },
  { value: 'nurture_later', label: 'Follow up later' },
  { value: 'do_not_contact', label: 'Do not contact' },
]

export const CONTACT_CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'sms', label: 'Text' },
  { value: 'phone', label: 'Phone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'other', label: 'Other' },
]

export const CAMPAIGN_SEQUENCE_STEPS = [
  {
    id: 'initial_shortlist',
    label: 'Initial shortlist',
    timing: 'Day 0',
    goal: 'Introduce the candidate packet and make the review page easy to open.',
  },
  {
    id: 'day_2_check_in',
    label: 'Did anyone stand out?',
    timing: 'Day 2',
    goal: 'Ask whether any candidate is worth a conversation.',
  },
  {
    id: 'day_5_value_proof',
    label: 'Pipeline value proof',
    timing: 'Day 5',
    goal: 'Connect the shortlist to a repeatable hiring process for their whole pipeline.',
  },
  {
    id: 'day_10_refresh',
    label: 'Candidate refresh',
    timing: 'Day 10',
    goal: 'Offer more candidates and keep the account warm without pressure.',
  },
]

const STAGE_LABELS = Object.fromEntries(EMPLOYER_STAGE_OPTIONS.map(option => [option.value, option.label]))
const PRIORITY_LABELS = Object.fromEntries(EMPLOYER_PRIORITY_OPTIONS.map(option => [option.value, option.label]))
const OUTCOME_LABELS = Object.fromEntries(EMPLOYER_OUTCOME_OPTIONS.map(option => [option.value, option.label]))
const CHANNEL_LABELS = Object.fromEntries(CONTACT_CHANNEL_OPTIONS.map(option => [option.value, option.label]))
const REVIEW_ACTION_LABELS = {
  interested: 'Interested',
  not_a_fit: 'Not a fit',
  send_more_like_this: 'Send more like this',
  schedule_interview: 'Interview requested',
  view_video: 'Viewed video',
}

export function toDate(value) {
  if (!value) return null
  if (value.toDate) return value.toDate()
  if (value.seconds) return new Date(value.seconds * 1000)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value, fallback = 'No activity') {
  const date = toDate(value)
  return date
    ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : fallback
}

export function dateTimeLocalValue(value) {
  const date = toDate(value)
  if (!date) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export function localInputToIso(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function stageLabel(stage) {
  return STAGE_LABELS[stage] || STAGE_LABELS.prospect
}

export function priorityLabel(priority) {
  return PRIORITY_LABELS[priority] || PRIORITY_LABELS.medium
}

export function outcomeLabel(outcome) {
  return OUTCOME_LABELS[outcome] || REVIEW_ACTION_LABELS[outcome] || outcome || 'Activity'
}

export function channelLabel(channel) {
  return CHANNEL_LABELS[channel] || CHANNEL_LABELS.other
}

export function stageTone(stage) {
  if (stage === 'active_client') return 'bg-green-50 text-green-800 border-green-100'
  if (stage === 'interested' || stage === 'interview_requested') return 'bg-blue-50 text-blue-800 border-blue-100'
  if (stage === 'watched_video' || stage === 'clicked') return 'bg-purple-50 text-purple-800 border-purple-100'
  if (stage === 'nurture') return 'bg-amber-50 text-amber-800 border-amber-100'
  if (stage === 'do_not_contact') return 'bg-red-50 text-red-800 border-red-100'
  return 'bg-gray-100 text-gray-700 border-gray-200'
}

export function priorityTone(priority) {
  if (priority === 'high') return 'bg-red-50 text-red-700 border-red-100'
  if (priority === 'low') return 'bg-gray-50 text-gray-600 border-gray-100'
  return 'bg-amber-50 text-amber-700 border-amber-100'
}

export function daysSince(value) {
  const date = toDate(value)
  if (!date) return null
  return Math.floor((Date.now() - date.getTime()) / 86400000)
}

export function employerStats(employer, contacts = [], campaigns = []) {
  const employerContacts = contacts.filter(contact => contact.employerId === employer.id)
  const employerCampaigns = campaigns.filter(campaign => (campaign.employerIds || []).includes(employer.id))
  const clicks = employerContacts.reduce((sum, contact) => sum + Number(contact.clickCount || 0), 0)
  const contactVideoClicks = employerContacts.reduce((sum, contact) => sum + Number(contact.videoClickCount || 0), 0)
  const reviewVideoClicks = employerCampaigns.reduce((sum, campaign) => sum + Number(campaign.actionCounts?.view_video || 0), 0)
  const videoClicks = contactVideoClicks + reviewVideoClicks
  const interested = employerCampaigns.reduce((sum, campaign) => (
    sum
    + Number(campaign.actionCounts?.interested || 0)
    + Number(campaign.actionCounts?.schedule_interview || 0)
    + Number(campaign.manualOutcomeCounts?.reply_interested || 0)
    + Number(campaign.manualOutcomeCounts?.wants_more_candidates || 0)
    + Number(campaign.manualOutcomeCounts?.interview_requested || 0)
  ), 0)
  return {
    contacts: employerContacts,
    campaigns: employerCampaigns,
    clicks,
    videoClicks,
    interested,
  }
}

export function derivedEmployerStage(employer, stats = employerStats(employer)) {
  if (employer.crmStage) return employer.crmStage
  if (stats.interested > 0) return 'interested'
  if (stats.videoClicks > 0) return 'watched_video'
  if (stats.clicks > 0) return 'clicked'
  if (employer.lastSharedAt) return 'contacted'
  return 'prospect'
}

export function employerDisplayName(employer) {
  return employer?.name || employer?.domain || 'Employer'
}

export function contactDisplayName(contact) {
  return contact?.name || contact?.contactName || contact?.email || 'Contact'
}

export function contactSubtitle(contact) {
  const parts = [contact?.title, contact?.email && contact?.name ? contact.email : null, contact?.phone]
    .filter(Boolean)
  return parts.join(' - ')
}

export function formatTags(tags) {
  return Array.isArray(tags) ? tags.filter(Boolean).join(', ') : String(tags || '')
}

export function isNextActionDue(value) {
  const due = toDate(value)
  if (!due) return false
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  return due.getTime() <= endOfToday.getTime()
}

export function buildEmployerWorkQueue(employers, contacts, campaigns) {
  const items = []
  const add = (item) => {
    if (items.some(existing => existing.employer.id === item.employer.id)) return
    items.push(item)
  }

  employers.forEach((employer) => {
    const stats = employerStats(employer, contacts, campaigns)
    const stage = derivedEmployerStage(employer, stats)
    if (stage === 'do_not_contact' || stage === 'active_client') return

    const name = employerDisplayName(employer)
    const sharedDays = daysSince(employer.lastSharedAt)
    const dueDate = toDate(employer.nextActionDue)
    const due = isNextActionDue(employer.nextActionDue)

    if (employer.nextAction && due) {
      const overdue = dueDate && dueDate.getTime() < Date.now()
      add({
        id: `${employer.id}:next-action`,
        employer,
        stage,
        priority: overdue ? 'high' : employer.crmPriority || 'medium',
        title: overdue ? 'Next action overdue' : 'Next action due',
        detail: employer.nextAction,
        meta: dueDate ? `Due ${formatDate(dueDate)}` : 'Due today',
        rank: overdue ? 5 : 10,
      })
      return
    }

    if (stage === 'interview_requested' || stage === 'interested') {
      add({
        id: `${employer.id}:interest`,
        employer,
        stage,
        priority: 'high',
        title: stage === 'interview_requested' ? 'Interview request needs coordination' : 'Interested employer needs follow-up',
        detail: employer.lastOutcomeNote || `${name} has a positive employer signal. Move this toward an interview or client conversation.`,
        meta: formatDate(employer.lastOutcomeAt || employer.lastCrmActivityAt || employer.lastSharedAt),
        rank: 15,
      })
      return
    }

    if (stage === 'watched_video') {
      add({
        id: `${employer.id}:video`,
        employer,
        stage,
        priority: 'high',
        title: 'Video view needs follow-up',
        detail: `${name} watched candidate video evidence. Ask who stood out and whether they want an interview.`,
        meta: `${stats.videoClicks} video click${stats.videoClicks === 1 ? '' : 's'}`,
        rank: 20,
      })
      return
    }

    if (stage === 'clicked') {
      add({
        id: `${employer.id}:click`,
        employer,
        stage,
        priority: 'medium',
        title: 'Shortlist click needs follow-up',
        detail: `${name} clicked the shortlist. Ask if anyone is worth a conversation.`,
        meta: `${stats.clicks} click${stats.clicks === 1 ? '' : 's'}`,
        rank: 30,
      })
      return
    }

    if (stage === 'contacted' && sharedDays != null && sharedDays >= 2) {
      add({
        id: `${employer.id}:no-response`,
        employer,
        stage,
        priority: sharedDays >= 5 ? 'high' : 'medium',
        title: 'No response follow-up',
        detail: `${name} received candidates ${sharedDays} day${sharedDays === 1 ? '' : 's'} ago. Send a short check-in or try another contact.`,
        meta: formatDate(employer.lastSharedAt),
        rank: sharedDays >= 5 ? 35 : 45,
      })
    }
  })

  return items.sort((a, b) => a.rank - b.rank || employerDisplayName(a.employer).localeCompare(employerDisplayName(b.employer)))
}

function compactList(items, fallback = 'candidate') {
  const clean = items.filter(Boolean)
  if (!clean.length) return fallback
  if (clean.length === 1) return clean[0]
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`
}

export function candidateName(candidate) {
  return candidate?.name || `${candidate?.firstName || ''} ${candidate?.lastName || ''}`.trim() || 'Candidate'
}

export function campaignCandidateSummaries(campaign) {
  return Array.isArray(campaign?.candidateSummaries) ? campaign.candidateSummaries : []
}

export function campaignRolePhrase(campaign) {
  const candidates = campaignCandidateSummaries(campaign)
  const roles = [...new Set(candidates.map(candidate => candidate.jobTitle).filter(Boolean))]
  if (roles.length === 1) return roles[0]
  return candidates.length === 1 ? 'your open role' : 'your open roles'
}

export function sequenceStepLabel(stepId) {
  return CAMPAIGN_SEQUENCE_STEPS.find(step => step.id === stepId)?.label || stepId
}

export function buildOutreachDraft({ stepId, medium, employer, contact, campaign, reviewUrl }) {
  const company = employerDisplayName(employer)
  const contactName = contact?.name ? contact.name.split(/\s+/)[0] : ''
  const greeting = contactName ? `Hi ${contactName},` : 'Hi,'
  const candidates = campaignCandidateSummaries(campaign)
  const names = compactList(candidates.map(candidateName), `${candidates.length || 1} candidate${candidates.length === 1 ? '' : 's'}`)
  const role = campaignRolePhrase(campaign)
  const link = reviewUrl || campaign?.reviewUrl || ''
  const videoCount = Number(campaign?.videoCount || 0)
  const videoPhrase = videoCount ? ` with ${videoCount} video response${videoCount === 1 ? '' : 's'}` : ''
  const render = (lines) => lines
    .filter(line => line !== null && line !== undefined)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const emailDrafts = {
    initial_shortlist: [
      greeting,
      '',
      `I pulled together ${names} for ${role}${videoPhrase}. The review page has the candidate responses, AI score, scoring notes, strengths, risk flags, and video links in one place.`,
      link ? `Review page: ${link}` : null,
      '',
      'If anyone stands out, reply here and I can coordinate next steps or send more candidates like this.',
      '',
      'Alberto',
    ],
    day_2_check_in: [
      greeting,
      '',
      `Quick check-in on the ${role} shortlist I sent for ${company}. Did anyone stand out enough to interview, or should I send a different profile type?`,
      link ? `Review page again: ${link}` : null,
      '',
      'Either way is helpful. I can adjust the screen around what you actually need.',
      '',
      'Alberto',
    ],
    day_5_value_proof: [
      greeting,
      '',
      'Wanted to put a sharper point on why I sent this format: every candidate is captured in the same structured flow, so hiring managers can compare original answers, video evidence, AI scoring, and evaluator notes without digging through scattered resumes or voicemails.',
      '',
      `If that would help beyond this shortlist, I can run the same video interview and scoring layer across the rest of your ${role} pipeline.`,
      link ? `Here is the current packet: ${link}` : null,
      '',
      'Alberto',
    ],
    day_10_refresh: [
      greeting,
      '',
      `Should I keep ${company} in mind for candidates like ${names}, or pause for now?`,
      '',
      'I can either send a refreshed shortlist when I have stronger fits, help coordinate an interview from this group, or leave you alone until hiring picks back up.',
      link ? `Current packet: ${link}` : null,
      '',
      'Alberto',
    ],
  }

  const shortDrafts = {
    initial_shortlist: `${greeting} I have ${names} for ${role}${videoPhrase}. The review page has responses, AI score, notes, and video links: ${link}`,
    day_2_check_in: `${greeting} did anyone stand out from the ${role} shortlist I sent for ${company}? I can coordinate an interview or send a different profile type. ${link}`,
    day_5_value_proof: `${greeting} this format lets your team compare candidate answers, video evidence, AI scores, and notes in one place. Want me to apply it to more of your ${role} pipeline? ${link}`,
    day_10_refresh: `${greeting} should I keep ${company} in mind for more candidates like ${names}, coordinate an interview from this group, or pause for now? ${link}`,
  }

  if (medium === 'sms' || medium === 'whatsapp') {
    return (shortDrafts[stepId] || shortDrafts.day_2_check_in).replace(/\s+/g, ' ').trim()
  }

  if (medium === 'linkedin') {
    return render(emailDrafts[stepId] || emailDrafts.day_2_check_in)
      .replace(/\n\nAlberto$/, '')
      .replace(/\nAlberto$/, '')
      .trim()
  }

  return render(emailDrafts[stepId] || emailDrafts.day_2_check_in)
}
