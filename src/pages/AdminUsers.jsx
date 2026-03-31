import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { db, auth, functions } from "../firebase"

const ROLES = [
  { value: "admin", label: "Admin", description: "Full access — manage users, candidates, jobs, and settings" },
  { value: "hiring_manager", label: "Hiring Manager", description: "View candidates, add notes/ratings, manage jobs" },
  { value: "reviewer", label: "Reviewer", description: "View candidates and add notes — no job or user management" },
  { value: "viewer", label: "Viewer", description: "Read-only access to dashboard and candidates" },
]

const PERMISSIONS = [
  { key: "manage_users", label: "Manage Users" },
  { key: "manage_jobs", label: "Manage Jobs" },
  { key: "manage_candidates", label: "Manage Candidates" },
  { key: "add_notes", label: "Add Notes & Ratings" },
  { key: "view_candidates", label: "View Candidates" },
  { key: "view_dashboard", label: "View Dashboard" },
]

const ROLE_DEFAULTS = {
  admin: ["manage_users", "manage_jobs", "manage_candidates", "add_notes", "view_candidates", "view_dashboard"],
  hiring_manager: ["manage_jobs", "manage_candidates", "add_notes", "view_candidates", "view_dashboard"],
  reviewer: ["add_notes", "view_candidates", "view_dashboard"],
  viewer: ["view_candidates", "view_dashboard"],
}

export default function AdminUsers() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const navigate = useNavigate()

  // Form state
  const [formData, setFormData] = useState({
    displayName: "",
    email: "",
    password: "",
    role: "reviewer",
    permissions: [...ROLE_DEFAULTS.reviewer],
    disabled: false,
  })

  useEffect(() => {
    const q = query(collection(db, "users"), orderBy("createdAt", "desc"))
    const unsub = onSnapshot(q, (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [])

  const resetForm = () => {
    setFormData({
      displayName: "",
      email: "",
      password: "",
      role: "reviewer",
      permissions: [...ROLE_DEFAULTS.reviewer],
      disabled: false,
    })
    setEditingUser(null)
    setError("")
  }

  const openCreate = () => {
    resetForm()
    setShowModal(true)
  }

  const openEdit = (user) => {
    setEditingUser(user)
    setFormData({
      displayName: user.displayName || "",
      email: user.email || "",
      password: "",
      role: user.role || "viewer",
      permissions: user.permissions || [...ROLE_DEFAULTS[user.role || "viewer"]],
      disabled: user.disabled || false,
    })
    setError("")
    setShowModal(true)
  }

  const handleRoleChange = (role) => {
    setFormData((prev) => ({
      ...prev,
      role,
      permissions: [...ROLE_DEFAULTS[role]],
    }))
  }

  const togglePermission = (key) => {
    setFormData((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter((p) => p !== key)
        : [...prev.permissions, key],
    }))
  }

  const handleSave = async () => {
    setError("")
    setSaving(true)

    try {
      if (editingUser) {
        // Update existing user in Firestore
        const userRef = doc(db, "users", editingUser.id)
        const updates = {
          displayName: formData.displayName.trim(),
          role: formData.role,
          permissions: formData.permissions,
          disabled: formData.disabled,
          updatedAt: serverTimestamp(),
        }
        await updateDoc(userRef, updates)

        // If password or email changed, call cloud function
        if (formData.password || formData.email !== editingUser.email) {
          const updateUser = httpsCallable(functions, "updateUser")
          await updateUser({
            uid: editingUser.uid,
            email: formData.email !== editingUser.email ? formData.email.trim() : undefined,
            password: formData.password || undefined,
            displayName: formData.displayName.trim(),
            disabled: formData.disabled,
          })
        }
      } else {
        // Create new user via Cloud Function (requires Admin SDK)
        if (!formData.email.trim() || !formData.password) {
          setError("Email and password are required for new users.")
          setSaving(false)
          return
        }
        const createUser = httpsCallable(functions, "createUser")
        await createUser({
          email: formData.email.trim(),
          password: formData.password,
          displayName: formData.displayName.trim(),
          role: formData.role,
          permissions: formData.permissions,
        })
      }

      setShowModal(false)
      resetForm()
    } catch (err) {
      console.error("Save user error:", err)
      setError(err.message || "Failed to save user. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (user) => {
    if (user.uid === auth.currentUser?.uid) {
      setError("You cannot delete your own account.")
      setDeleteConfirm(null)
      return
    }
    setSaving(true)
    try {
      const deleteUser = httpsCallable(functions, "deleteUser")
      await deleteUser({ uid: user.uid })
      await deleteDoc(doc(db, "users", user.id))
      setDeleteConfirm(null)
    } catch (err) {
      console.error("Delete user error:", err)
      setError(err.message || "Failed to delete user.")
    } finally {
      setSaving(false)
    }
  }

  const getRoleBadge = (role) => {
    const styles = {
      admin: "bg-purple-100 text-purple-800",
      hiring_manager: "bg-blue-100 text-blue-800",
      reviewer: "bg-amber-100 text-amber-800",
      viewer: "bg-gray-100 text-gray-700",
    }
    const labels = { admin: "Admin", hiring_manager: "Hiring Manager", reviewer: "Reviewer", viewer: "Viewer" }
    return (
      <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${styles[role] || styles.viewer}`}>
        {labels[role] || role}
      </span>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/admin/dashboard")} className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xs font-bold">SA</span>
            </div>
            <span className="font-semibold text-gray-900 text-sm">Manage Users</span>
          </div>
          <button
            onClick={openCreate}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add user
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-screen-xl mx-auto px-4 py-6">
        {error && !showModal && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={() => setError("")} className="text-xs text-red-500 underline mt-1">Dismiss</button>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Total users</p>
            <p className="text-2xl font-semibold">{users.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Admins</p>
            <p className="text-2xl font-semibold text-purple-600">{users.filter((u) => u.role === "admin").length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Hiring Managers</p>
            <p className="text-2xl font-semibold text-blue-600">{users.filter((u) => u.role === "hiring_manager").length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Disabled</p>
            <p className="text-2xl font-semibold text-red-500">{users.filter((u) => u.disabled).length}</p>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-semibold text-gray-600 px-4 py-3">User</th>
                <th className="text-left text-xs font-semibold text-gray-600 px-4 py-3">Role</th>
                <th className="text-left text-xs font-semibold text-gray-600 px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-gray-600 px-4 py-3">Created</th>
                <th className="text-right text-xs font-semibold text-gray-600 px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12">
                    <p className="text-sm text-gray-500">No users yet. Click "Add user" to create one.</p>
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{user.displayName || "—"}</p>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">{getRoleBadge(user.role)}</td>
                    <td className="px-4 py-3">
                      {user.disabled ? (
                        <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-red-100 text-red-700">Disabled</span>
                      ) : (
                        <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-green-100 text-green-700">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-500">
                        {user.createdAt?.toDate ? user.createdAt.toDate().toLocaleDateString() : "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(user)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Edit
                        </button>
                        {user.uid !== auth.currentUser?.uid && (
                          <button
                            onClick={() => setDeleteConfirm(user)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingUser ? "Edit User" : "Create New User"}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {editingUser ? "Update this user's details and permissions." : "Add a new admin portal user."}
              </p>
            </div>

            <div className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => setFormData((p) => ({ ...p, displayName: e.target.value }))}
                  placeholder="Jane Smith"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                  placeholder="jane@example.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  required
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password {editingUser && <span className="text-gray-400 font-normal">(leave blank to keep current)</span>}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                  placeholder={editingUser ? "••••••••" : "Min 6 characters"}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  {...(!editingUser && { required: true, minLength: 6 })}
                />
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                <div className="space-y-2">
                  {ROLES.map((r) => (
                    <label
                      key={r.value}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        formData.role === r.value ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={r.value}
                        checked={formData.role === r.value}
                        onChange={() => handleRoleChange(r.value)}
                        className="mt-0.5 accent-blue-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{r.label}</p>
                        <p className="text-xs text-gray-500">{r.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Granular Permissions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Permissions <span className="text-gray-400 font-normal">(customize)</span>
                </label>
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-2">
                  {PERMISSIONS.map((perm) => (
                    <label key={perm.key} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.permissions.includes(perm.key)}
                        onChange={() => togglePermission(perm.key)}
                        className="accent-blue-600 w-4 h-4"
                      />
                      <span className="text-sm text-gray-700">{perm.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Disable toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
                <div>
                  <p className="text-sm font-medium text-gray-900">Disable account</p>
                  <p className="text-xs text-gray-500">Prevent this user from signing in.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData((p) => ({ ...p, disabled: !p.disabled }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.disabled ? "bg-red-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      formData.disabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {error && showModal && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowModal(false); resetForm() }}
                className="text-sm text-gray-600 font-medium px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Saving…
                  </span>
                ) : editingUser ? (
                  "Save changes"
                ) : (
                  "Create user"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900">Delete user?</h3>
            <p className="text-sm text-gray-500 mt-1">
              This will permanently delete <span className="font-medium text-gray-700">{deleteConfirm.displayName || deleteConfirm.email}</span> and remove their access. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="text-sm text-gray-600 font-medium px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                disabled={saving}
                className="bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
              >
                {saving ? "Deleting…" : "Delete user"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
