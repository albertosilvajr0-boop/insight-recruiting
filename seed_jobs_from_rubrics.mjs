// Creates one active job opening for every roleRubrics role that doesn't
// already have a job posting, so every interview battery has an opening.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node seed_jobs_from_rubrics.mjs
//
// Idempotent: role keys that already have ANY job (any status) are skipped.
// Openings are created under the generic Insight Recruiting name — edit the
// organization, location, pay, and description per client engagement in
// Admin → Jobs.
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
let admin
try {
  admin = require('firebase-admin')
} catch {
  admin = require('./functions/node_modules/firebase-admin')
}

admin.initializeApp()
const db = admin.firestore()
const { FieldValue } = admin.firestore

const GENERIC_CLIENT = 'Insight Recruiting'
const DEFAULT_LOCATION = 'Centennial, CO'

// Sensible starting pay/description per role — edit per engagement before
// or after activation; payUnit drives the Google for Jobs salary display.
const JOB_DEFAULTS = {
  'entry-sales-rep': {
    payRange: { min: 18, max: 25 }, payUnit: 'HOUR', employmentType: ['FULL_TIME'],
    description: 'Entry-level sales role with paid training and uncapped commission potential. You will engage homeowners, generate interest, and set appointments — persistence and coachability matter more than experience.',
  },
  'service-advisor-full': {
    payRange: { min: 18, max: 28 }, payUnit: 'HOUR', employmentType: ['FULL_TIME'],
    description: 'Front-line service advisor for a busy drive lane: greet customers, write up repair orders, communicate estimates and timelines, and keep customers informed from drop-off to delivery.',
  },
  'shuttle-driver': {
    payRange: { min: 15, max: 18 }, payUnit: 'HOUR', employmentType: ['FULL_TIME', 'PART_TIME'],
    description: 'Drive customers to and from the dealership in a company shuttle. Clean driving record, friendly demeanor, and rock-solid reliability required.',
  },
  'lot-attendant': {
    payRange: { min: 14, max: 17 }, payUnit: 'HOUR', employmentType: ['FULL_TIME', 'PART_TIME'],
    description: 'Keep the lot running: move and stage vehicles, keep inventory organized and clean, and support the sales and service teams with hands-on hustle.',
  },
  'restaurant-gm': {
    payRange: { min: 60000, max: 90000 }, payUnit: 'YEAR', employmentType: ['FULL_TIME'],
    description: 'Run the whole restaurant: P&L ownership, hiring and developing the team, food and labor cost control, and guest experience standards. Minimum 2 years of management experience.',
  },
  'kitchen-manager': {
    payRange: { min: 55000, max: 75000 }, payUnit: 'YEAR', employmentType: ['FULL_TIME'],
    description: 'Own kitchen systems and consistency: prep planning, food safety, training cooks, and keeping quality identical from the first portion to the four-hundredth.',
  },
  'lead-host': {
    payRange: { min: 16, max: 20 }, payUnit: 'HOUR', employmentType: ['FULL_TIME', 'PART_TIME'],
    description: 'Own the front door on busy nights: warm greetings, smart seating decisions under pressure, wait-time communication, and raising the game of the host team around you.',
  },
  'server': {
    payRange: { min: 12, max: 18 }, payUnit: 'HOUR', employmentType: ['FULL_TIME', 'PART_TIME'],
    description: 'Deliver warm, attentive table service in a high-energy restaurant. Multi-table judgment, genuine guest connection, and consistency through long shifts. Tips in addition to base pay.',
  },
  'fine-dining-server': {
    payRange: { min: 15, max: 25 }, payUnit: 'HOUR', employmentType: ['FULL_TIME', 'PART_TIME'],
    description: 'Fine-dining service at the highest level: wine pairings, classic cocktails, synchronized service, and polished recovery when things go sideways. Significant fine-dining experience expected. Tips in addition to base pay.',
  },
  'restaurant-manager': {
    payRange: { min: 55000, max: 75000 }, payUnit: 'YEAR', employmentType: ['FULL_TIME'],
    description: 'Run high-volume shifts from pre-shift huddle to close: coach the team, manage to the numbers, and own the guest experience. Minimum 2 years of restaurant management.',
  },
  'restaurant-manager-staffing': {
    payRange: { min: 55000, max: 75000 }, payUnit: 'YEAR', employmentType: ['FULL_TIME'],
    description: 'Restaurant manager with a hiring superpower: build and keep a fully staffed team, spot great hourly talent, and keep kitchen and front-of-house aligned on busy nights.',
  },
  'assistant-restaurant-manager': {
    payRange: { min: 45000, max: 60000 }, payUnit: 'YEAR', employmentType: ['FULL_TIME'],
    description: 'Second-in-command with a path to GM: run the building when the GM is out, own inventory and scheduling systems, and handle the Saturday-night surprises.',
  },
  'hibachi-chef': {
    payRange: { min: 25, max: 40 }, payUnit: 'HOUR', employmentType: ['FULL_TIME', 'PART_TIME', 'CONTRACTOR'],
    description: 'Mobile hibachi chef for private events: knife-and-spatula showmanship, crowd reading, flawless event logistics, and food safety on the road. Travel to event sites required.',
  },
  'shift-leader': {
    payRange: { min: 17, max: 21 }, payUnit: 'HOUR', employmentType: ['FULL_TIME', 'PART_TIME'],
    description: 'Lead shifts, not just work them: run the rush, coach teammates in the moment, and carry opening/closing responsibility with keys and cash.',
  },
}

async function main() {
  const [rubricSnap, jobSnap] = await Promise.all([
    db.collection('roleRubrics').get(),
    db.collection('jobs').get(),
  ])

  const existingRoleKeys = new Set(jobSnap.docs.map(d => d.data().roleKey).filter(Boolean))
  const created = []
  const skipped = []

  for (const doc of rubricSnap.docs) {
    const rubric = doc.data()
    const roleKey = rubric.roleKey || doc.id

    if (existingRoleKeys.has(roleKey)) {
      skipped.push(`${roleKey} (job already exists)`)
      continue
    }

    const defaults = JOB_DEFAULTS[roleKey] || {
      payRange: { min: 15, max: 25 }, payUnit: 'HOUR', employmentType: ['FULL_TIME', 'PART_TIME'],
      description: `${rubric.label} position. Apply online in minutes.`,
    }

    const ref = await db.collection('jobs').add({
      title: rubric.label,
      clientName: GENERIC_CLIENT,
      organizationName: GENERIC_CLIENT,
      location: DEFAULT_LOCATION,
      roleKey,
      industry: rubric.industryLabel || '',
      description: defaults.description,
      payRange: defaults.payRange,
      payUnit: defaults.payUnit,
      employmentType: defaults.employmentType,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    created.push(`${rubric.label} → /apply/${ref.id}`)
  }

  console.log(`Created ${created.length} openings:`)
  for (const line of created) console.log(`  + ${line}`)
  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`)
    for (const line of skipped) console.log(`  - ${line}`)
  }
  console.log('Done. New openings are live on /jobs and in the sitemap immediately.')
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
