import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { APP_URL } from '../config/organization.js'
import { recordEmployerClick } from '../employers/employerCrm.js'

// Tracks engagement on shared-candidate emails. Hosting rewrites
// /t/{shareId}/{recipientIndex}/{target} here; target is 'open' (tracking
// pixel) or a link key like 'v3' (video card → 302 to the real URL).
// Recipient identity comes from the index into the share doc's recipients
// array, so raw emails never appear in URLs.

// Transparent 1x1 GIF for open tracking
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export async function trackShareClick(req, res) {
  const segments = req.path.split('/').filter(Boolean)
  if (segments[0] === 't') segments.shift()
  const [shareId, recipientIndex, target] = segments
  const isPixel = target === 'open'
  let redirectTo = APP_URL

  try {
    if (shareId && target) {
      const db = getFirestore()
      const snap = await db.collection('shares').doc(shareId).get()
      if (snap.exists) {
        const share = snap.data()
        const link = share.links?.[target]
        if (link?.url) redirectTo = link.url
        const recipient = Array.isArray(share.recipients)
          ? share.recipients[Number(recipientIndex)] || null
          : null
        await snap.ref.collection('clicks').add({
          target,
          label: isPixel ? null : link?.label || null,
          recipient,
          userAgent: String(req.get('user-agent') || '').slice(0, 400),
          at: FieldValue.serverTimestamp(),
        })
        if (!isPixel) {
          const normalizedTarget = String(target || '').toLowerCase()
          const isVideo = normalizedTarget.startsWith('v') || /^c\d+v/.test(normalizedTarget) || String(link?.label || '').toLowerCase().includes(' q')
          await recordEmployerClick(db, { shareId, recipient, target, link, isVideo })
        }
      }
    }
  } catch (err) {
    // Tracking must never break the recipient's experience
    console.error('[trackShare] Failed to record event:', err)
  }

  if (isPixel) {
    res.set('Content-Type', 'image/gif')
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return res.send(PIXEL)
  }
  res.set('Cache-Control', 'no-store')
  return res.redirect(302, redirectTo)
}
