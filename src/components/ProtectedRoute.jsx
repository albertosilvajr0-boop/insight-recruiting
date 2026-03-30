import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase'
export default function ProtectedRoute({ children }) {
  const [status, setStatus] = useState('loading')
  useEffect(() => { const unsub = onAuthStateChanged(auth, u => setStatus(u ? 'authed' : 'unauthed')); return unsub }, [])
  if (status === 'loading') return <div className="min-h-screen flex items-center justify-center"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  return status === 'authed' ? children : <Navigate to="/admin/login" replace />
}
