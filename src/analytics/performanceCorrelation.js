export const MIN_CORRELATION_SAMPLE_SIZE = 3

export const PERFORMANCE_SIGNALS = Object.freeze([
  {
    key: 'manual',
    label: 'Manual selection score',
    value: (candidate) => numberOrNull(candidate.manualScore?.avg),
    format: (value) => value.toFixed(1),
  },
  {
    key: 'composite',
    label: 'AI composite score',
    value: (candidate) => numberOrNull(candidate.compositeScore),
    format: (value) => value.toFixed(1),
  },
  {
    key: 'resume',
    label: 'AI resume score',
    value: (candidate) => numberOrNull(candidate.resumeScore),
    format: (value) => value.toFixed(1),
  },
  {
    key: 'interview',
    label: 'AI interview score',
    value: (candidate) => numberOrNull(candidate.interviewScore),
    format: (value) => value.toFixed(1),
  },
])

export function checkpointOutcome(checkpoints = {}) {
  const completed = Object.entries(checkpoints)
    .map(([key, checkpoint]) => ({
      key,
      rating: numberOrNull(checkpoint?.rating),
      completed: checkpoint?.completed === true,
    }))
    .filter((checkpoint) => checkpoint.completed && checkpoint.rating !== null)

  if (completed.length === 0) {
    return {
      ratingCount: 0,
      averageRating: null,
      latestRating: null,
      completedKeys: [],
    }
  }

  return {
    ratingCount: completed.length,
    averageRating: average(completed.map((checkpoint) => checkpoint.rating)),
    latestRating: completed[completed.length - 1].rating,
    completedKeys: completed.map((checkpoint) => checkpoint.key),
  }
}

export function buildPerformanceRecords(candidates = [], onboardings = []) {
  const candidateByKey = new Map()
  candidates.forEach((candidate) => {
    if (candidate.id) candidateByKey.set(candidate.id, candidate)
    if (candidate.candidateId) candidateByKey.set(candidate.candidateId, candidate)
  })

  return onboardings
    .map((onboarding) => {
      const candidate = candidateByKey.get(onboarding.candidateDocId)
        || candidateByKey.get(onboarding.candidateId)
        || candidateByKey.get(onboarding.id)
      const outcome = checkpointOutcome(onboarding.performanceCheckpoints)
      if (!candidate || outcome.ratingCount === 0) return null
      return {
        candidate,
        onboarding,
        outcome,
        role: candidate.jobTitle || onboarding.jobTitle || 'Unknown',
        roleKey: candidate.roleKey || onboarding.roleKey || 'unknown',
        selectionProcessVersion: candidate.selectionProcessVersion || onboarding.selectionProcessVersion || 'Unknown',
      }
    })
    .filter(Boolean)
}

export function buildSignalCorrelationRows(records = [], minSampleSize = MIN_CORRELATION_SAMPLE_SIZE) {
  return PERFORMANCE_SIGNALS.map((signal) => {
    const pairs = records
      .map((record) => ({
        score: signal.value(record.candidate),
        outcome: record.outcome.averageRating,
      }))
      .filter((pair) => pair.score !== null && pair.outcome !== null)

    const coefficient = pairs.length >= minSampleSize
      ? pearsonCorrelation(pairs.map((pair) => pair.score), pairs.map((pair) => pair.outcome))
      : null

    return {
      key: signal.key,
      label: signal.label,
      sampleSize: pairs.length,
      coefficient,
      strength: correlationStrength(coefficient, pairs.length, minSampleSize),
      averageSignal: pairs.length ? average(pairs.map((pair) => pair.score)) : null,
      averageOutcome: pairs.length ? average(pairs.map((pair) => pair.outcome)) : null,
      formatSignal: signal.format,
    }
  })
}

export function buildOutcomeSegmentRows(records = [], segmentKey = 'role') {
  const groups = new Map()

  records.forEach((record) => {
    const key = segmentKey === 'selectionProcessVersion' ? record.selectionProcessVersion : record.role
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  })

  return Array.from(groups.entries())
    .map(([label, groupRecords]) => {
      const outcomes = groupRecords.map((record) => record.outcome.averageRating)
      const manualScores = groupRecords
        .map((record) => numberOrNull(record.candidate.manualScore?.avg))
        .filter((value) => value !== null)
      const compositeScores = groupRecords
        .map((record) => numberOrNull(record.candidate.compositeScore))
        .filter((value) => value !== null)
      return {
        label,
        sampleSize: groupRecords.length,
        averageOutcome: average(outcomes),
        topPerformerCount: outcomes.filter((value) => value >= 4).length,
        averageManualScore: manualScores.length ? average(manualScores) : null,
        averageCompositeScore: compositeScores.length ? average(compositeScores) : null,
      }
    })
    .sort((a, b) => b.averageOutcome - a.averageOutcome || b.sampleSize - a.sampleSize)
}

export function pearsonCorrelation(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) return null
  const xAvg = average(xs)
  const yAvg = average(ys)
  let numerator = 0
  let xDenominator = 0
  let yDenominator = 0

  xs.forEach((x, index) => {
    const xDiff = x - xAvg
    const yDiff = ys[index] - yAvg
    numerator += xDiff * yDiff
    xDenominator += xDiff ** 2
    yDenominator += yDiff ** 2
  })

  const denominator = Math.sqrt(xDenominator * yDenominator)
  if (denominator === 0) return null
  return numerator / denominator
}

function correlationStrength(coefficient, sampleSize, minSampleSize) {
  if (sampleSize < minSampleSize) return 'insufficient'
  if (coefficient === null) return 'flat'
  const abs = Math.abs(coefficient)
  if (abs >= 0.7) return coefficient > 0 ? 'strong_positive' : 'strong_negative'
  if (abs >= 0.4) return coefficient > 0 ? 'moderate_positive' : 'moderate_negative'
  if (abs >= 0.2) return coefficient > 0 ? 'weak_positive' : 'weak_negative'
  return 'flat'
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
