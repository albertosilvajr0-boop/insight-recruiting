import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { onAuthStateChanged, sendEmailVerification } from "firebase/auth"
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { auth, db, functions } from "../firebase"

export default function VerifyAccount() {
  const [user, setUser] = useState(null)
  const [userDoc, setUserDoc] = useState(null)
  const [loading, setLoading] = useState(true)

  // Email verification
  const [emailVerified, setEmailVerified] = useState(false)
  const [emailResending, setEmailResending] = useState(false)
  const [emailResent, setEmailResent] = useState(false)

  // Phone verification
  const [phoneCode, setPhoneCode] = useState("")
  const [phoneSending, setPhoneSending] = useState(false)
  const [phoneSent, setPhoneSent] = useState(false)
  const [phoneVerifying, setPhoneVerifying] = useState(false)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [phoneError, setPhoneError] = useState("")
  const [cooldown, setCooldown] = useState(0)

  const [error, setError] = useState("")
  const navigate = useNavigate()

  // Load user and their Firestore doc
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        navigate("/admin/login", { replace: true })
        return
      }
      setUser(u)
      setEmailVerified(u.emailVerified)

      const snap = await getDoc(doc(db, "users", u.uid))
      if (snap.exists()) {
        const data = snap.data()
        setUserDoc(data)
        setPhoneVerified(data.phoneVerified || false)
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
          await updateDoc(doc(db, "users", auth.currentUser.uid), {
            emailVerified: true,
            updatedAt: serverTimestamp(),
          })
        }
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [emailVerified])

  // Cooldown timer for resend
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleResendEmail = async () => {
    if (cooldown > 0) return
    setEmailResending(true)
    setEmailResent(false)
    setError("")
    try {
      const currentUser = auth.currentUser
      if (!currentUser) {
        setError("Session expired. Please sign in again.")
        return
      }
      // Reload to get fresh token before sending
      await currentUser.reload()
      await sendEmailVerification(currentUser, {
        url: window.location.origin + "/admin/verify",
      })
      setEmailResent(true)
      setCooldown(60)
    } catch (err) {
      if (err.code === "auth/too-many-requests") {
        setError("Too many requests. Please wait a few minutes before trying again.")
      } else {
        setError(`Failed to send verification email: ${err.code || err.message}`)
      }
    } finally {
      setEmailResending(false)
    }
  }

  const handleSendSmsCode = useCallback(async () => {
    if (!userDoc?.phone || cooldown > 0) return
    setPhoneSending(true)
    setPhoneError("")
    setPhoneSent(false)
    try {
      const sendCode = httpsCallable(functions, "sendPhoneVerification")
      await sendCode({ uid: user.uid })
      setPhoneSent(true)
      setCooldown(60)
    } catch (err) {
      setPhoneError(err.message || "Failed to send verification code.")
    } finally {
      setPhoneSending(false)
    }
  }, [userDoc, user, cooldown])

  const handleVerifyPhone = async () => {
    if (!phoneCode || phoneCode.length !== 6) {
      setPhoneError("Please enter the 6-digit code.")
      return
    }
    setPhoneVerifying(true)
    setPhoneError("")
    try {
      const verifyCode = httpsCallable(functions, "verifyPhoneCode")
      const result = await verifyCode({ uid: user.uid, code: phoneCode })
      if (result.data.verified) {
        setPhoneVerified(true)
        await updateDoc(doc(db, "users", user.uid), {
          phoneVerified: true,
          updatedAt: serverTimestamp(),
        })
      } else {
        setPhoneError("Invalid code. Please try again.")
      }
    } catch (err) {
      setPhoneError(err.message || "Verification failed. Please try again.")
    } finally {
      setPhoneVerifying(false)
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

  const allVerified = emailVerified && phoneVerified

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-xl font-bold">SA</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Verify Your Account</h1>
          <p className="text-sm text-gray-500 mt-1">Complete both steps to access the admin portal.</p>
        </div>

        <div className="space-y-4">
          {/* Step 1: Email Verification */}
          <div className={`bg-white rounded-2xl border shadow-sm p-6 ${emailVerified ? "border-green-300" : "border-gray-200"}`}>
            <div className="flex items-start gap-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${emailVerified ? "bg-green-100" : "bg-blue-100"}`}>
                {emailVerified ? (
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <span className="text-sm font-bold text-blue-600">1</span>
                )}
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-900">Email Verification</h3>
                {emailVerified ? (
                  <p className="text-sm text-green-600 mt-1">Email verified successfully.</p>
                ) : (
                  <>
                    <p className="text-sm text-gray-500 mt-1">
                      We sent a verification link to <span className="font-medium text-gray-700">{user?.email}</span>. Click the link to verify.
                    </p>
                    <p className="text-sm text-amber-600 font-medium mt-2">
                      Don't see it? Check your Spam or Junk folder!
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        onClick={handleResendEmail}
                        disabled={emailResending || cooldown > 0}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-400"
                      >
                        {emailResending ? "Sending…" : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
                      </button>
                      {emailResent && <span className="text-xs text-green-600">Sent!</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs text-gray-400">Waiting for verification…</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Step 2: Phone Verification */}
          <div className={`bg-white rounded-2xl border shadow-sm p-6 ${phoneVerified ? "border-green-300" : "border-gray-200"}`}>
            <div className="flex items-start gap-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${phoneVerified ? "bg-green-100" : "bg-blue-100"}`}>
                {phoneVerified ? (
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <span className="text-sm font-bold text-blue-600">2</span>
                )}
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-900">Phone Verification</h3>
                {phoneVerified ? (
                  <p className="text-sm text-green-600 mt-1">Phone number verified successfully.</p>
                ) : (
                  <>
                    <p className="text-sm text-gray-500 mt-1">
                      We'll send a 6-digit code to{" "}
                      <span className="font-medium text-gray-700">
                        +1 {userDoc?.phone ? `(${userDoc.phone.slice(0, 3)}) ${userDoc.phone.slice(3, 6)}-${userDoc.phone.slice(6)}` : "your phone"}
                      </span>.
                    </p>

                    {!phoneSent ? (
                      <button
                        onClick={handleSendSmsCode}
                        disabled={phoneSending || cooldown > 0}
                        className="mt-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
                      >
                        {phoneSending ? (
                          <span className="flex items-center gap-2">
                            <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Sending…
                          </span>
                        ) : cooldown > 0 ? (
                          `Resend in ${cooldown}s`
                        ) : (
                          "Send verification code"
                        )}
                      </button>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Enter 6-digit code</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={phoneCode}
                              onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                              placeholder="000000"
                              className="w-32 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-center tracking-widest font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                              autoFocus
                            />
                            <button
                              onClick={handleVerifyPhone}
                              disabled={phoneVerifying || phoneCode.length !== 6}
                              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
                            >
                              {phoneVerifying ? "Verifying…" : "Verify"}
                            </button>
                          </div>
                        </div>
                        <button
                          onClick={handleSendSmsCode}
                          disabled={phoneSending || cooldown > 0}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-400"
                        >
                          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                        </button>
                      </div>
                    )}

                    {phoneError && (
                      <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
                        <p className="text-sm text-red-700">{phoneError}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Global error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Continue button */}
          <button
            onClick={handleContinue}
            disabled={!allVerified}
            className={`w-full font-medium py-3 rounded-xl text-sm transition-colors ${
              allVerified
                ? "bg-green-600 hover:bg-green-700 text-white"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            {allVerified ? "Continue to Dashboard" : "Complete both verifications to continue"}
          </button>

          {/* Skip for now (if they want to come back later) */}
          {!allVerified && (
            <p className="text-center text-xs text-gray-400">
              You can also verify later, but access will be limited until both steps are complete.
            </p>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          &copy; {new Date().getFullYear()} Silva Consulting Group
        </p>
      </div>
    </div>
  )
}
