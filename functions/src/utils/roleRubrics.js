import { getFirestore } from 'firebase-admin/firestore'

// roleRubrics docs are keyed by roleKey and carry:
//   label, industry, industryLabel, scoringWeights, hardDisqualifiers
// scoringWeights may be a flat map { criterion: weight }, an array of
// { criterion|label|name, weight|percent }, or nested { resume, interview }.
export async function getRoleRubric(roleKey) {
  if (!roleKey) return null
  try {
    const snap = await getFirestore().collection('roleRubrics').doc(roleKey).get()
    return snap.exists ? snap.data() : null
  } catch (err) {
    console.error(`[roleRubrics] Failed to load rubric for ${roleKey}:`, err.message)
    return null
  }
}

// Returns "- Criterion (weight: NN%)" lines, or null when the rubric has no
// usable weights so callers fall back to the hardcoded defaults.
export function formatScoringWeights(scoringWeights, variant) {
  if (!scoringWeights || typeof scoringWeights !== 'object') return null

  let weights = scoringWeights
  if (!Array.isArray(weights) && variant && typeof weights[variant] === 'object' && weights[variant] !== null) {
    weights = weights[variant]
  }

  const entries = Array.isArray(weights)
    ? weights.map(w => [w?.criterion || w?.label || w?.name, w?.weight ?? w?.percent])
    : Object.entries(weights).filter(([, v]) => typeof v !== 'object')

  const lines = entries
    .filter(([label, weight]) => label && weight != null)
    .map(([label, weight]) => `- ${label} (weight: ${formatPercent(weight)})`)

  return lines.length > 0 ? lines.join('\n') : null
}

function formatPercent(weight) {
  const n = Number(weight)
  if (!Number.isFinite(n)) return String(weight)
  return n <= 1 ? `${Math.round(n * 100)}%` : `${n}%`
}

export function formatHardDisqualifiers(hardDisqualifiers) {
  if (!Array.isArray(hardDisqualifiers)) return null
  const items = hardDisqualifiers.map(d => String(d).trim()).filter(Boolean)
  return items.length > 0 ? items.join('; ') : null
}
