// One-time: convert manual candidate scoring from the old 1-5 scale to 1-10
// by doubling every stored score (a 4/5 becomes an 8/10 — same meaning, new
// scale). Idempotent: docs are stamped scoreScale=10 and skipped on re-runs.
//
// Covers:
//   candidates: manualResumeScores, manualAnswerScores, manualScore{avg,sum,max}
//   campaigns:  candidateSummaries[].aiScore and evidence[].score (so old
//               employer review links keep showing correct numbers)
//
// Usage (from the repo root, next to service-account.json):
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node migrate_scores_to_10.mjs
// PowerShell:
//   $env:GOOGLE_APPLICATION_CREDENTIALS="./service-account.json"; node migrate_scores_to_10.mjs
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
let admin
try {
  admin = require('firebase-admin')
} catch {
  admin = require('./functions/node_modules/firebase-admin')
}

admin.initializeApp()

const doubleScore = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(n * 2, 10) : v
}

const doubleMap = (map) => {
  if (!map || typeof map !== 'object') return map
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, doubleScore(v)]))
}

async function main() {
  const db = admin.firestore()

  // ── Candidates ──────────────────────────────────────────────────────────
  const candidates = await db.collection('candidates').get()
  let migrated = 0
  let skipped = 0
  for (const doc of candidates.docs) {
    const c = doc.data()
    if (c.scoreScale === 10) { skipped++; continue }
    const hasScores = c.manualScore || c.manualAnswerScores || c.manualResumeScores
    const update = { scoreScale: 10 }
    if (c.manualAnswerScores) update.manualAnswerScores = doubleMap(c.manualAnswerScores)
    if (c.manualResumeScores) update.manualResumeScores = doubleMap(c.manualResumeScores)
    if (c.manualScore && typeof c.manualScore === 'object') {
      const count = Number(c.manualScore.count) || 0
      update.manualScore = {
        ...c.manualScore,
        avg: doubleScore(c.manualScore.avg),
        sum: Number.isFinite(Number(c.manualScore.sum)) ? Number(c.manualScore.sum) * 2 : c.manualScore.sum,
        max: count * 10,
      }
    }
    await doc.ref.update(update)
    migrated++
    if (hasScores) {
      console.log(`  candidate ${c.firstName || ''} ${c.lastName || ''}: ` +
        (update.manualScore ? `avg ${c.manualScore?.avg} -> ${update.manualScore.avg}` : 'per-question scores doubled'))
    }
  }
  console.log(`Candidates: ${migrated} migrated, ${skipped} already on the 10 scale.`)

  // ── Campaign snapshots (employer review pages) ──────────────────────────
  const campaigns = await db.collection('campaigns').get()
  let cMigrated = 0
  let cSkipped = 0
  for (const doc of campaigns.docs) {
    const data = doc.data()
    if (data.scoreScale === 10) { cSkipped++; continue }
    const summaries = Array.isArray(data.candidateSummaries) ? data.candidateSummaries.map(s => ({
      ...s,
      aiScore: s.aiScore == null ? s.aiScore : doubleScore(s.aiScore),
      evidence: Array.isArray(s.evidence) ? s.evidence.map(e => ({
        ...e,
        score: e.score == null ? e.score : doubleScore(e.score),
      })) : s.evidence,
    })) : data.candidateSummaries
    await doc.ref.update({ candidateSummaries: summaries, scoreScale: 10 })
    cMigrated++
  }
  console.log(`Campaigns: ${cMigrated} migrated, ${cSkipped} already on the 10 scale.`)
  console.log('\nDone. All scores now read out of 10.')
}

main().then(() => process.exit(0)).catch(err => {
  console.error('\nMigration failed:', err.message)
  process.exit(1)
})
