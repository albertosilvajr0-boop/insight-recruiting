import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { onAuthStateChanged, sendEmailVerification } from "firebase/auth"
import { doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { auth, db } from "../firebase"

export default function VerifyAccount() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [emailVerified, setEmailVerified] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState("")
  const navigate = useNavigate()

  // Load user
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        navigate("/admin/login", { replace: true })
        return
      }
      setUser(u)
      if (u.emailVerified) {
        navigate("/admin/dashboard", { replace: true })
        return
      }
      setLoading(false)
    })
    return unsub
  }, [navigate])

  // Poll for email verification status
  useEffect(() => {
    if (emailVerified) return
    const interval = setInterval(async () => {
      if (auth.currentUser) {
        await auth.currentUser.reload()
        if (auth.currentUser.emailVerified) {
          setEmailVerified(true)
          try {
            await updateDoc(doc(db, "users", auth.currentUser.uid), {
              emailVerified: true,
              updatedAt: serverTimestamp(),
            })
          } catch {
            // Non-critical — Firestore sync can happen later
          }
        }
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [emailVerified])

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleResendEmail = async () => {
    if (cooldown > 0) return
    setResending(true)
    setResent(false)
    setError("")
    try {
      const currentUser = auth.currentUser
      if (!currentUser) {
        setError("Session expired. Please sign in again.")
        return
      }
      await currentUser.reload()
      await sendEmailVerification(currentUser, {
        url: window.location.origin + "/admin/verify",
      })
      setResent(true)
      setCooldown(60)
    } catch (err) {
      if (err.code === "auth/too-many-requests") {
        setError("Too many requests. Please wait a few minutes before trying again.")
      } else {
        setError(`Failed to send verification email: ${err.code || err.message}`)
      }
    } finally {
      setResending(false)
    }
  }

  const handleContinue = () => {
    navigate("/admin/dashboard", { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-xl font-bold">SA</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Verify Your Email</h1>
          <p className="text-sm text-gray-500 mt-1">One quick step to access the admin portal.</p>
        </div>

        <div className="space-y-4">
          {/* Email Verification Card */}
          <div className={`bg-white rounded-2xl border shadow-sm p-6 ${emailVerified ? "border-green-300" : "border-gray-200"}`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${emailVerified ? "bg-green-100" : "bg-blue-100"}`}>
                {emailVerified ? (
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                )}
              </div>
              <div className="flex-1">
                {emailVerified ? (
                  <>
                    <h3 className="text-sm font-semibold text-green-700">Email Verified!</h3>
                    <p className="text-sm text-green-600 mt-1">Your email has been verified successfully.</p>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-semibold text-gray-900">Check your inbox</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      We sent a verification link to <span className="font-medium text-gray-700">{user?.email}</span>.
                    </p>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                      <p className="text-sm text-amber-700 font-medium">Don't see it? Check your Spam or Junk folder!</p>
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                      <button
                        onClick={handleResendEmail}
                        disabled={resending || cooldown > 0}
                        className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium px-4 py-2 rounded-xl transition-colors"
                      >
                        {resending ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
                      </button>
                      {resent && <span className="text-xs text-green-600 font-medium">Sent!</span>}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-gray-400">Waiting for verification…</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Continue button */}
          {emailVerified && (
            <button
              onClick={handleContinue}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-xl text-sm transition-colors"
            >
              Continue to Dashboard
            </button>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          &copy; {new Date().getFullYear()} Silva Consulting Group
        </p>
      </div>
    </div>
  )
}
