// One-time: allow the web app to fetch file contents (resume/video blobs)
// from Cloud Storage for the "Download profile" ZIP. In-page playback works
// without this; fetch()/XHR from the browser does not.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node set_bucket_cors.mjs
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
let admin
try {
  admin = require('firebase-admin')
} catch {
  admin = require('./functions/node_modules/firebase-admin')
}

admin.initializeApp()

const PROJECT = 'insight-recruiting-d37dc'
const CANDIDATE_BUCKETS = [
  `${PROJECT}.firebasestorage.app`,
  `${PROJECT}.appspot.com`,
]

const CORS = [
  {
    origin: [
      'https://insightedgehq.com',
      'https://www.insightedgehq.com',
      `https://${PROJECT}.web.app`,
      `https://${PROJECT}.firebaseapp.com`,
      'http://localhost:5173',
    ],
    method: ['GET', 'HEAD'],
    maxAgeSeconds: 3600,
    responseHeader: ['Content-Type', 'Content-Disposition', 'Content-Length'],
  },
]

async function main() {
  for (const name of CANDIDATE_BUCKETS) {
    const bucket = admin.storage().bucket(name)
    const [exists] = await bucket.exists().catch(() => [false])
    if (!exists) {
      console.log(`- ${name}: not found, skipping`)
      continue
    }
    await bucket.setMetadata({ cors: CORS })
    console.log(`+ ${name}: CORS updated — allowed origins:`)
    for (const o of CORS[0].origin) console.log(`    ${o}`)
  }
  console.log('Done.')
}

main().catch(err => {
  console.error('Failed:', err)
  process.exit(1)
})
