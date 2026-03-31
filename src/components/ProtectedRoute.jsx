import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'

const ROLE_HIERARCHY = { admin: 4, hiring_manager: 3, reviewer: 2, viewer: 1 }

export default function ProtectedRoute({ children, requiredRole }) {
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setStatus('unauthed')
        return
      }
      if (!user.emailVerified) {
        setStatus('unverified')
        return
      }

      // If a specific role is required, check it
      if (requiredRole) {
        try {
          const snap = await getDoc(doc(db, 'users', user.uid))
          const role = snap.exists() ? snap.data().role : 'viewer'
          const userLevel = ROLE_HIERARCHY[role] || 0
          const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0
          if (userLevel < requiredLevel) {
            setStatus('forbidden')
            return
          }
        } catch {
          // On Firestore error, deny access to role-gated pages
          setStatus('forbidden')
          return
        }
      }

      setStatus('authed')
    })
    return unsub
  }, [requiredRole])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'unauthed') return <Navigate to="/admin/login" replace />
  if (status === 'unverified') return <Navigate to="/admin/verify" replace />
  if (status === 'forbidden') return <Navigate to="/admin/dashboard" replace />
  return children
}
