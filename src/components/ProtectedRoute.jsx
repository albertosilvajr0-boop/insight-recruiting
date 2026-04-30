import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { canAccessRoute } from '../security/roles'

export default function ProtectedRoute({ children, requiredRole, requiredPermission }) {
  const [status, setStatus] = useState('loading')

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
