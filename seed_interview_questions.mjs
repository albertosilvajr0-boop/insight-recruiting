// Seeds the 15 interview question batteries and role rubrics into Firestore.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node seed_interview_questions.mjs
//
// Idempotent: deletes existing interviewQuestions docs for these 15 roleKeys
// before writing, and overwrites roleRubrics docs (doc id = roleKey). The
// built-in seeds outside these roleKeys (roleKeys "all", "bdc-agent",
// "sales-rep", orders 0-40) are untouched.
import { readFileSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
let admin
try {
  admin = require('firebase-admin')
} catch {
  // firebase-admin lives in the functions workspace
  admin = require('./functions/node_modules/firebase-admin')
}

const questions = JSON.parse(readFileSync(new URL('./interviewQuestions_seed.json', import.meta.url), 'utf8'))
const rubrics = JSON.parse(readFileSync(new URL('./roleRubrics_seed.json', import.meta.url), 'utf8'))

admin.initializeApp()
const db = admin.firestore()
const { FieldValue } = admin.firestore

const BATCH_LIMIT = 400

async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch()
    for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch)
    await batch.commit()
  }
}

async function main() {
  const roleKeys = rubrics.map(r => r.roleKey)
  console.log(`Seeding ${questions.length} questions and ${roleKeys.length} rubrics...`)

  // 1. Delete existing questions for these roleKeys
  const deletes = []
  for (const roleKey of roleKeys) {
    const snap = await db.collection('interviewQuestions').where('roleKey', '==', roleKey).get()
    for (const doc of snap.docs) deletes.push(batch => batch.delete(doc.ref))
  }
  await commitInChunks(deletes)
  console.log(`Deleted ${deletes.length} existing question docs.`)

  // 2. Write questions
  const writes = questions.map(q => batch => {
    const ref = db.collection('interviewQuestions').doc()
    batch.set(ref, { ...q, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  })
  await commitInChunks(writes)
  console.log(`Wrote ${questions.length} question docs.`)

  // 3. Write rubrics (doc id = roleKey, full overwrite)
  const rubricWrites = rubrics.map(r => batch => {
    const ref = db.collection('roleRubrics').doc(r.roleKey)
    batch.set(ref, { ...r, updatedAt: FieldValue.serverTimestamp() })
  })
  await commitInChunks(rubricWrites)
  console.log(`Wrote ${rubrics.length} roleRubrics docs.`)

  // Summary by industry for a quick eyeball check
  const byIndustry = {}
  for (const r of rubrics) {
    byIndustry[r.industryLabel] = byIndustry[r.industryLabel] || []
    byIndustry[r.industryLabel].push(`${r.roleKey} (${questions.filter(q => q.roleKey === r.roleKey).length}q)`)
  }
  for (const [industry, list] of Object.entries(byIndustry)) {
    console.log(`  ${industry}: ${list.join(', ')}`)
  }
  console.log('Done.')
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
