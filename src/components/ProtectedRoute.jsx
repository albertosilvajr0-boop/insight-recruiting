import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'

export default function ProtectedRoute({ children }) {
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setStatus('unauthed')
        return
      }

      // Check email verification via Firebase Auth
      if (!user.emailVerified) {
        setStatus('unverified')
        return
      }

      // Check phone verification via Firestore
      try {
        const snap = await getDoc(doc(db, 'users', user.uid))
        if (snap.exists() && !snap.data().phoneVerified) {
          setStatus('unverified')
          return
        }
      } catch {
        // If Firestore read fails, allow through (don't block on network errors)
      }

      setStatus('authed')
    })
    return unsub
  }, [])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (status === 'unauthed') return <Navigate to="/admin/login" replace />
  if (status === 'unverified') return <Navigate to="/admin/verify" replace />
  return children
}
