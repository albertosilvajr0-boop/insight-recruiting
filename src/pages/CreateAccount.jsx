import { useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { createUserWithEmailAndPassword, updateProfile, sendEmailVerification } from "firebase/auth"
import { doc, setDoc, serverTimestamp } from "firebase/firestore"
import { auth, db } from "../firebase"

export default function CreateAccount() {
  const [formData, setFormData] = useState({
    displayName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  })
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const set = (key) => (e) => setFormData((p) => ({ ...p, [key]: e.target.value }))

  const formatPhone = (value) => {
    const digits = value.replace(/\D/g, "").slice(0, 10)
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  const handlePhoneChange = (e) => {
    setFormData((p) => ({ ...p, phone: formatPhone(e.target.value) }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")

    const { displayName, email, phone, password, confirmPassword } = formData

    if (!displayName.trim()) {
      setError("Full name is required.")
      return
    }

    if (phone.replace(/\D/g, "").length < 10) {
      setError("Please enter a valid 10-digit phone number.")
      return
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.")
      return
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setLoading(true)
    try {
      // Create Firebase Auth account
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)

      // Set display name on Auth profile
      await updateProfile(cred.user, { displayName: displayName.trim() })

      // Send email verification
      await sendEmailVerification(cred.user)

      // Store user profile in Firestore
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        email: email.trim(),
        displayName: displayName.trim(),
        phone: phone.replace(/\D/g, ""),
        role: "viewer",
        permissions: ["view_candidates", "view_dashboard"],
        emailVerified: false,
        phoneVerified: false,
        disabled: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      // Redirect to verification page
      navigate("/admin/verify")
    } catch (err) {
      if (err.code === "auth/email-already-in-use") {
        setError("An account with this email already exists.")
      } else if (err.code === "auth/invalid-email") {
        setError("Please enter a valid email address.")
      } else if (err.code === "auth/weak-password") {
        setError("Password is too weak. Use at least 6 characters.")
      } else {
        setError(err.message || "Failed to create account. Please try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-xl font-bold">SA</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Insight Recruiting</h1>
          <p className="text-sm text-gray-500 mt-1">San Antonio Dodge — Admin Portal</p>
        </div>

        {/* Signup Card */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Create account</h2>
            <p className="text-sm text-gray-500 mt-0.5">Sign up for admin portal access.</p>
          </div>

          <div className="space-y-4">
            {/* Full Name */}
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                id="displayName"
                type="text"
                value={formData.displayName}
                onChange={set("displayName")}
                placeholder="Jane Smith"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                required
                autoComplete="name"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                id="email"
                type="email"
                value={formData.email}
                onChange={set("email")}
                placeholder="you@example.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                required
                autoComplete="email"
              />
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">+1</span>
                <input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  placeholder="(555) 123-4567"
                  className="w-full border border-gray-300 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                  required
                  autoComplete="tel-national"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                id="password"
                type="password"
                value={formData.password}
                onChange={set("password")}
                placeholder="Min 6 characters"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={set("confirmPassword")}
                placeholder="Re-enter password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating account…
              </span>
            ) : (
              "Create account"
            )}
          </button>

          <p className="text-center text-sm text-gray-500">
            Already have an account?{" "}
            <Link to="/admin/login" className="text-blue-600 hover:text-blue-700 font-medium">Sign in</Link>
          </p>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          &copy; {new Date().getFullYear()} Silva Consulting Group
        </p>
      </div>
    </div>
  )
}
