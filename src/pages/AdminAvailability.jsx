import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp, writeBatch } from "firebase/firestore"
import { db } from "../firebase"
import { format, addDays, parseISO } from "date-fns"

const DEFAULT_DURATION = 45 // minutes

const TIME_OPTIONS = []
for (let h = 8; h <= 17; h++) {
  for (let m = 0; m < 60; m += 15) {
    if (h === 17 && m > 0) break
    const hh = String(h).padStart(2, "0")
    const mm = String(m).padStart(2, "0")
    TIME_OPTIONS.push(`${hh}:${mm}`)
  }
}

function addMinutes(time, mins) {
  const [h, m] = time.split(":").map(Number)
  const total = h * 60 + m + mins
  const nh = Math.floor(total / 60)
  const nm = total % 60
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`
}

function formatTime(t) {
  const [h, m] = t.split(":").map(Number)
  const ampm = h >= 12 ? "PM" : "AM"
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayH}:${String(m).padStart(2, "0")} ${ampm}`
}

export default function AdminAvailability() {
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  // Form for adding slots
  const [formMode, setFormMode] = useState(null) // null | 'single' | 'bulk'
  const [singleDate, setSingleDate] = useState(format(addDays(new Date(), 1), "yyyy-MM-dd"))
  const [singleStart, setSingleStart] = useState("09:00")
  const [duration, setDuration] = useState(DEFAULT_DURATION)

  // Bulk form
  const [bulkStartDate, setBulkStartDate] = useState(format(addDays(new Date(), 1), "yyyy-MM-dd"))
  const [bulkDays, setBulkDays] = useState(5)
  const [bulkStartTime, setBulkStartTime] = useState("09:00")
  const [bulkEndTime, setBulkEndTime] = useState("16:00")
  const [bulkSkipWeekends, setBulkSkipWeekends] = useState(true)

  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    const q = query(collection(db, "availability"), orderBy("date", "asc"))
    const unsub = onSnapshot(q, (snap) => {
      setSlots(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [])

  const addSingleSlot = async () => {
    setSaving(true)
    try {
      await addDoc(collection(db, "availability"), {
        date: singleDate,
        startTime: singleStart,
        endTime: addMinutes(singleStart, duration),
        duration,
        booked: false,
        candidateId: null,
        googleEventId: null,
        createdAt: serverTimestamp(),
      })
      setFormMode(null)
    } catch (err) {
      alert("Failed to create slot: " + err.message)
    } finally {
      setSaving(false)
    }
  }

  const addBulkSlots = async () => {
    setSaving(true)
    try {
      const batch = writeBatch(db)
      const startDate = parseISO(bulkStartDate)
      let slotsCreated = 0

      for (let d = 0; d < bulkDays; d++) {
        const date = addDays(startDate, d)
        const dayOfWeek = date.getDay()

        // Skip weekends if checked
        if (bulkSkipWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) continue

        const dateStr = format(date, "yyyy-MM-dd")
        let currentTime = bulkStartTime

        while (currentTime < bulkEndTime) {
          const endTime = addMinutes(currentTime, duration)
          if (endTime > bulkEndTime) break

          const ref = doc(collection(db, "availability"))
          batch.set(ref, {
            date: dateStr,
            startTime: currentTime,
            endTime,
            duration,
            booked: false,
            candidateId: null,
            googleEventId: null,
            createdAt: serverTimestamp(),
          })
          slotsCreated++
          currentTime = endTime
        }
      }

      if (slotsCreated === 0) {
        alert("No slots to create with these settings.")
        setSaving(false)
        return
      }

      await batch.commit()
      setFormMode(null)
    } catch (err) {
      alert("Failed to create slots: " + err.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteSlot = async () => {
    if (!deleteConfirm) return
    await deleteDoc(doc(db, "availability", deleteConfirm.id))
    setDeleteConfirm(null)
  }

  const deleteAllUnbooked = async () => {
    const unbookedSlots = slots.filter((s) => !s.booked)
    if (unbookedSlots.length === 0) return
    if (!window.confirm(`Delete all ${unbookedSlots.length} unbooked slots?`)) return

    const batch = writeBatch(db)
    unbookedSlots.forEach((s) => batch.delete(doc(db, "availability", s.id)))
    await batch.commit()
  }

  // Group slots by date
  const slotsByDate = slots.reduce((acc, slot) => {
    if (!acc[slot.date]) acc[slot.date] = []
    acc[slot.date].push(slot)
    return acc
  }, {})

  const today = format(new Date(), "yyyy-MM-dd")

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/admin/dashboard")} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <img src="/brand-mark.png" alt="Insight Edge" className="w-7 h-7 object-contain" />
            <span className="font-semibold text-gray-900 text-sm">Interview Availability</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setFormMode("single")} className="text-sm border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-50">+ Single slot</button>
            <button onClick={() => setFormMode("bulk")} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium">+ Bulk slots</button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Total slots</p>
            <p className="text-2xl font-semibold">{slots.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Available</p>
            <p className="text-2xl font-semibold text-green-600">{slots.filter((s) => !s.booked && s.date >= today).length}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">Booked</p>
            <p className="text-2xl font-semibold text-blue-600">{slots.filter((s) => s.booked).length}</p>
          </div>
        </div>

        {/* Add Single Slot Form */}
        {formMode === "single" && (
          <div className="bg-white rounded-2xl border-2 border-blue-300 p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Add a single slot</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input type="date" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} min={today}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start time</label>
                <select value={singleStart} onChange={(e) => setSingleStart(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{formatTime(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration (min)</label>
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value={30}>30 min</option>
                  <option value={45}>45 min</option>
                  <option value={60}>60 min</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-500">Slot: {formatTime(singleStart)} – {formatTime(addMinutes(singleStart, duration))}</p>
            <div className="flex gap-3">
              <button onClick={addSingleSlot} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-5 rounded-xl text-sm">
                {saving ? "Adding…" : "Add slot"}
              </button>
              <button onClick={() => setFormMode(null)} className="border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium py-2 px-5 rounded-xl text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Add Bulk Slots Form */}
        {formMode === "bulk" && (
          <div className="bg-white rounded-2xl border-2 border-blue-300 p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Generate slots in bulk</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
                <input type="date" value={bulkStartDate} onChange={(e) => setBulkStartDate(e.target.value)} min={today}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Number of days</label>
                <input type="number" value={bulkDays} onChange={(e) => setBulkDays(Number(e.target.value))} min={1} max={30}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First slot at</label>
                <select value={bulkStartTime} onChange={(e) => setBulkStartTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{formatTime(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last slot before</label>
                <select value={bulkEndTime} onChange={(e) => setBulkEndTime(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{formatTime(t)}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Slot duration</label>
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value={30}>30 min</option>
                  <option value={45}>45 min</option>
                  <option value={60}>60 min</option>
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={bulkSkipWeekends} onChange={(e) => setBulkSkipWeekends(e.target.checked)} className="accent-blue-600 w-4 h-4" />
                  <span className="text-sm text-gray-700">Skip weekends</span>
                </label>
              </div>
            </div>
            <div className="bg-blue-50 rounded-lg px-3 py-2">
              <p className="text-xs text-blue-700">
                This will create {bulkDays} days of slots from {formatTime(bulkStartTime)} to {formatTime(bulkEndTime)}, {duration} min each{bulkSkipWeekends ? " (weekdays only)" : ""}.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={addBulkSlots} disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-5 rounded-xl text-sm">
                {saving ? "Generating…" : "Generate slots"}
              </button>
              <button onClick={() => setFormMode(null)} className="border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium py-2 px-5 rounded-xl text-sm">Cancel</button>
            </div>
          </div>
        )}

        {/* Clear unbooked */}
        {slots.filter((s) => !s.booked).length > 0 && (
          <div className="flex justify-end">
            <button onClick={deleteAllUnbooked} className="text-xs text-red-500 hover:text-red-700 font-medium">Clear all unbooked slots</button>
          </div>
        )}

        {/* Slots by Date */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : Object.keys(slotsByDate).length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No availability slots yet.</p>
            <p className="text-gray-400 text-xs mt-1">Click "Bulk slots" to generate interview times.</p>
          </div>
        ) : (
          Object.entries(slotsByDate)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, dateSlots]) => {
              const isPast = date < today
              return (
                <div key={date} className={`bg-white rounded-2xl border border-gray-200 p-5 ${isPast ? "opacity-50" : ""}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">
                      {format(parseISO(date), "EEEE, MMMM d, yyyy")}
                      {isPast && <span className="text-xs text-gray-400 font-normal ml-2">(past)</span>}
                    </h3>
                    <span className="text-xs text-gray-400">{dateSlots.length} slot{dateSlots.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {dateSlots
                      .sort((a, b) => a.startTime.localeCompare(b.startTime))
                      .map((slot) => (
                        <div key={slot.id} className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm ${
                          slot.booked ? "bg-blue-50 border-blue-200" : "bg-white border-gray-200"
                        }`}>
                          <span className={slot.booked ? "text-blue-700 font-medium" : "text-gray-700"}>
                            {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
                          </span>
                          {slot.booked ? (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Booked</span>
                          ) : (
                            <button onClick={() => setDeleteConfirm(slot)} className="text-gray-400 hover:text-red-500 text-xs" title="Delete slot">
                              &#x2715;
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )
            })
        )}
      </div>

      {/* Delete Slot Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900">Delete slot?</h3>
            <p className="text-sm text-gray-500 mt-1">
              Remove the {formatTime(deleteConfirm.startTime)} – {formatTime(deleteConfirm.endTime)} slot on {deleteConfirm.date}?
            </p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button onClick={() => setDeleteConfirm(null)} className="text-sm text-gray-600 font-medium px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={deleteSlot} className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
