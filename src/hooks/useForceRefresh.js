import { useEffect } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

/**
 * Subscribes every client to `system/refresh`. When an admin bumps the
 * `refreshAt` timestamp on that document (via the "Refresh all users" button
 * in the admin panel), every currently-open tab reloads, picking up the
 * latest Firebase Hosting deploy.
 *
 * First snapshot sets an in-memory baseline — it never triggers a reload on
 * initial mount, only on subsequent updates. This means newly-opened tabs
 * won't spuriously reload, and only clients that were already on the page
 * when the admin clicks the button are affected.
 */
export default function useForceRefresh() {
  useEffect(() => {
    let baseline = null
    let initialized = false

    const unsub = onSnapshot(
      doc(db, 'system', 'refresh'),
      (snap) => {
        const ms = snap.exists() ? snap.data()?.refreshAt?.toMillis?.() ?? null : null

        if (!initialized) {
          baseline = ms
          initialized = true
          return
        }

        if (ms != null && (baseline == null || ms > baseline)) {
          baseline = ms
          // Give the snapshot event loop a tick to settle, then reload.
          // Firebase Hosting serves index.html with cache-control: no-cache,
          // so a normal reload is enough to pick up the new hashed bundles
          // emitted by Vite on the latest deploy.
          setTimeout(() => window.location.reload(), 50)
        }
      },
      (err) => {
        console.warn('[useForceRefresh] snapshot error:', err)
      }
    )

    return unsub
  }, [])
}
