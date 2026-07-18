import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '../firebase'
import { canAccessRoute } from '../security/roles'

const ADMIN_PRESENCE_INTERVAL_MS = 45_000

export default function ProtectedRoute({ children, requiredRole, requiredPermission }) {
  const [status, setStatus] = useState('loading')
  const location = useLocation()

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setStatus('unauthed')
        return
      }

      try {
        const snap = await getDoc(doc(db, 'users', user.uid))
        const profile = snap.exists() ? snap.data() : null
        if (!canAccessRoute(profile, { requiredRole, requiredPermission })) {
          setStatus('forbidden')
          return
        }
      } catch {
        setStatus('forbidden')
        return
      }

      setStatus('authed')
    })
    return unsub
  }, [requiredRole, requiredPermission])

  useEffect(() => {
    if (status !== 'authed') return undefined

    let stopped = false
    const touchAdminPresence = httpsCallable(functions, 'touchAdminPresence')
    const sendHeartbeat = () => {
      if (stopped) return
      touchAdminPresence({ path: location.pathname }).catch(() => {
        // Presence is best-effort; it should never block admin navigation.
      })
    }

    sendHeartbeat()
    const interval = window.setInterval(sendHeartbeat, ADMIN_PRESENCE_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') sendHeartbeat()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', sendHeartbeat)
    return () => {
      stopped = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', sendHeartbeat)
    }
  }, [status, location.pathname])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'unauthed') return <Navigate to="/admin/login" replace />
  if (status === 'forbidden') return <Navigate to="/admin/dashboard" replace />
  return children
}
