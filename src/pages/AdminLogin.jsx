import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { signInWithEmailAndPassword } from "firebase/auth"
import { auth } from "../firebase"
export default function AdminLogin() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const handleLogin = async (e) => {
    e.preventDefault(); setError(""); setLoading(true)
    try { await signInWithEmailAndPassword(auth, email, password); navigate("/admin/dashboard") }
    catch { setError("Invalid email or password") }
    finally { setLoading(false) }
  }
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <form onSubmit={handleLogin} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 w-full max-w-sm">
        <h1 className="text-xl font-semibold text-gray-900 text-center">Admin Login</h1>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" required />
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white font-medium py-2.5 rounded-xl text-sm">{loading ? "Signing in..." : "Sign in"}</button>
      </form>
    </div>
  )
}
