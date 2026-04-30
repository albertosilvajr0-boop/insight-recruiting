export const ONBOARDING_PLAN_VERSION = '2026-04-30.1'

export const ONBOARDING_TASKS = Object.freeze([
  {
    key: 'offer_accepted',
    category: 'Offer',
    label: 'Offer accepted and compensation confirmed',
    dueRule: { type: 'before_start', days: 7 },
  },
  {
    key: 'start_date_confirmed',
    category: 'Offer',
    label: 'Start date and reporting manager confirmed',
    dueRule: { type: 'before_start', days: 5 },
  },
  {
    key: 'paperwork_packet_sent',
    category: 'Pre-start',
    label: 'New-hire paperwork packet sent',
    dueRule: { type: 'before_start', days: 3 },
  },
  {
    key: 'w4_collected',
    category: 'Pre-start',
    label: 'Federal Form W-4 collected for payroll withholding',
    dueRule: { type: 'start_day' },
  },
  {
    key: 'i9_section1_ready',
    category: 'Employment eligibility',
    label: 'Form I-9 Section 1 ready by first day of work',
    dueRule: { type: 'start_day' },
  },
  {
    key: 'i9_section2_verified',
    category: 'Employment eligibility',
    label: 'Form I-9 Section 2 completed within 3 business days',
    dueRule: { type: 'business_days_after_start', days: 3 },
  },
  {
    key: 'payroll_setup',
    category: 'Operations',
    label: 'Payroll, direct deposit, and tax profile set up',
    dueRule: { type: 'start_day' },
  },
  {
    key: 'tools_access_ready',
    category: 'Operations',
    label: 'Tools, systems access, and workspace ready',
    dueRule: { type: 'before_start', days: 1 },
  },
  {
    key: 'handbook_acknowledged',
    category: 'First day',
    label: 'Handbook and policy acknowledgements complete',
    dueRule: { type: 'start_day' },
  },
  {
    key: 'first_day_agenda',
    category: 'First day',
    label: 'First-day agenda, trainer, and manager intro complete',
    dueRule: { type: 'start_day' },
  },
  {
    key: 'week_one_check_in',
    category: 'Ramp',
    label: 'Week-one manager check-in completed',
    dueRule: { type: 'days_after_start', days: 7 },
  },
])

export const PERFORMANCE_CHECKPOINTS = Object.freeze([
  { key: 'day30', label: '30-day performance checkpoint', dueRule: { type: 'days_after_start', days: 30 } },
  { key: 'day60', label: '60-day performance checkpoint', dueRule: { type: 'days_after_start', days: 60 } },
  { key: 'day90', label: '90-day performance checkpoint', dueRule: { type: 'days_after_start', days: 90 } },
])

export function createDefaultTaskState() {
  return Object.fromEntries(ONBOARDING_TASKS.map((task) => [
    task.key,
    { completed: false, completedAt: null, completedBy: null, notes: '' },
  ]))
}

export function createDefaultPerformanceCheckpoints() {
  return Object.fromEntries(PERFORMANCE_CHECKPOINTS.map((checkpoint) => [
    checkpoint.key,
    { completed: false, completedAt: null, completedBy: null, rating: null, notes: '' },
  ]))
}

export function buildInitialOnboardingDoc(candidate, actor = {}, timestampValue = null) {
  return {
    onboardingPlanVersion: ONBOARDING_PLAN_VERSION,
    candidateId: candidate.candidateId || candidate.id,
    candidateDocId: candidate.id || candidate.candidateId,
    candidateName: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim(),
    email: candidate.email || '',
    phone: candidate.phone || '',
    jobId: candidate.jobId || '',
    jobTitle: candidate.jobTitle || '',
    roleKey: candidate.roleKey || '',
    status: 'active',
    startDate: '',
    ownerUid: actor.uid || null,
    ownerEmail: actor.email || null,
    tasks: createDefaultTaskState(),
    performanceCheckpoints: createDefaultPerformanceCheckpoints(),
    createdAt: timestampValue,
    updatedAt: timestampValue,
    createdBy: actor.uid || null,
    createdByEmail: actor.email || null,
  }
}

export function taskProgress(tasks = {}) {
  const total = ONBOARDING_TASKS.length
  const completed = ONBOARDING_TASKS.filter((task) => tasks[task.key]?.completed === true).length
  return {
    total,
    completed,
    pct: total > 0 ? Math.round((completed / total) * 100) : 0,
  }
}

export function checkpointProgress(checkpoints = {}) {
  const total = PERFORMANCE_CHECKPOINTS.length
  const completed = PERFORMANCE_CHECKPOINTS.filter((checkpoint) => checkpoints[checkpoint.key]?.completed === true).length
  return {
    total,
    completed,
    pct: total > 0 ? Math.round((completed / total) * 100) : 0,
  }
}

export function dueDateForRule(startDate, dueRule) {
  if (!startDate || !dueRule) return null
  const start = parseDateOnly(startDate)
  if (!start) return null

  if (dueRule.type === 'before_start') return addCalendarDays(start, -dueRule.days)
  if (dueRule.type === 'start_day') return start
  if (dueRule.type === 'days_after_start') return addCalendarDays(start, dueRule.days)
  if (dueRule.type === 'business_days_after_start') return addBusinessDays(start, dueRule.days)
  return null
}

export function dueStatus(itemState, startDate, dueRule, today = new Date()) {
  if (itemState?.completed) return 'complete'
  const dueDate = dueDateForRule(startDate, dueRule)
  if (!dueDate) return 'unscheduled'

  const todayDate = stripTime(today)
  const deltaDays = differenceInCalendarDays(dueDate, todayDate)
  if (deltaDays < 0) return 'overdue'
  if (deltaDays <= 3) return 'due_soon'
  return 'upcoming'
}

export function overdueItemCount(record, today = new Date()) {
  const taskCount = ONBOARDING_TASKS.filter((task) => (
    dueStatus(record.tasks?.[task.key], record.startDate, task.dueRule, today) === 'overdue'
  )).length
  const checkpointCount = PERFORMANCE_CHECKPOINTS.filter((checkpoint) => (
    dueStatus(record.performanceCheckpoints?.[checkpoint.key], record.startDate, checkpoint.dueRule, today) === 'overdue'
  )).length
  return taskCount + checkpointCount
}

function parseDateOnly(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addCalendarDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addBusinessDays(date, days) {
  const next = new Date(date)
  let remaining = days
  while (remaining > 0) {
    next.setDate(next.getDate() + 1)
    const day = next.getDay()
    if (day !== 0 && day !== 6) remaining -= 1
  }
  return next
}

function differenceInCalendarDays(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((stripTime(a) - stripTime(b)) / msPerDay)
}
