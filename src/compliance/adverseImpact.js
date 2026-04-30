export const DEFAULT_MIN_GROUP_SIZE = 5

export const SELECTION_MILESTONES = Object.freeze({
  reviewed: ['scored', 'to_schedule', 'scheduled', 'hired'],
  invited: ['to_schedule', 'scheduled', 'hired'],
  scheduled: ['scheduled', 'hired'],
  hired: ['hired'],
})

const EMPTY_RESULT = Object.freeze({
  rows: [],
  maxSelectionRate: 0,
  totalApplicants: 0,
  totalSelected: 0,
})

export function reachedSelectionMilestone(candidate, milestone = 'invited') {
  if (!candidate) return false
  const stage = normalizeStage(candidate.stage)
  const acceptedStages = SELECTION_MILESTONES[milestone] || SELECTION_MILESTONES.invited
  return acceptedStages.includes(stage)
}

export function buildSelectionRateRows(records, groupKey, options = {}) {
  const minGroupSize = options.minGroupSize || DEFAULT_MIN_GROUP_SIZE
  const milestone = options.milestone || 'invited'
  const groups = new Map()

  records.forEach((record) => {
    const candidate = record.candidate || record
    const survey = record.compliance?.eeoSurvey || record.eeoSurvey
    if (!survey?.optedIn) return

    const group = survey[groupKey]
    if (!isReportableGroup(group)) return

    if (!groups.has(group)) {
      groups.set(group, { group, applicants: 0, selected: 0 })
    }

    const row = groups.get(group)
    row.applicants += 1
    if (reachedSelectionMilestone(candidate, milestone)) row.selected += 1
  })

  if (groups.size === 0) return { ...EMPTY_RESULT }

  const rows = Array.from(groups.values()).map((row) => ({
    ...row,
    selectionRate: row.applicants > 0 ? row.selected / row.applicants : 0,
  }))

  const qualifiedRates = rows
    .filter((row) => row.applicants >= minGroupSize)
    .map((row) => row.selectionRate)
  const maxSelectionRate = qualifiedRates.length > 0 ? Math.max(...qualifiedRates) : 0

  const enrichedRows = rows.map((row) => {
    const rateRatio = maxSelectionRate > 0 ? row.selectionRate / maxSelectionRate : null
    return {
      ...row,
      rateRatio,
      status: row.applicants < minGroupSize
        ? 'low_n'
        : rateRatio !== null && rateRatio < 0.8
          ? 'attention'
          : 'ok',
    }
  })

  return {
    rows: enrichedRows.sort((a, b) => b.applicants - a.applicants || a.group.localeCompare(b.group)),
    maxSelectionRate,
    totalApplicants: rows.reduce((sum, row) => sum + row.applicants, 0),
    totalSelected: rows.reduce((sum, row) => sum + row.selected, 0),
  }
}

function normalizeStage(stage) {
  if (stage === 'screening' || stage === 'interview_2') return 'applied'
  if (stage === 'scheduling') return 'to_schedule'
  return stage
}

function isReportableGroup(group) {
  return typeof group === 'string'
    && group.length > 0
    && group !== 'Prefer not to say'
    && group !== 'Self-describe'
}
