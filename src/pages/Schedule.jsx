import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { format, parseISO } from 'date-fns'

export default function Schedule() {
  const { token } = useParams()
  const [slots, setSlots] = useState([])
  const [candidateName, setCandidateName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [booking, setBooking] = useState(false)
  const [booked, setBooked] = useState(false)
  const [bookedDetails, setBookedDetails] = useState(null)

  useEffect(() => {
    async function loadSlots() {
      try {
        const getSlots = httpsCallable(functions, 'getSlots')
        const result = await getSlots({ token })
        setSlots(result.data.slots || [])
        setCandidateName(result.data.candidateName || '')
      } catch (err) {
        setError(err.message || 'Invalid or expired scheduling link.')
      } finally {
        setLoading(false)
      }
    }
    loadSlots()
  }, [token])

  const handleBook = async () => {
    if (!selectedSlot) return
    setBooking(true)
    try {
      const bookInterview = httpsCallable(functions, 'bookInterview')
      const result = await bookInterview({ token, slotId: selectedSlot })
      setBooked(true)
      setBookedDetails(result.data)
    } catch (err) {
      alert('Booking failed: ' + (err.message || 'Please try again.'))
    } finally {
      setBooking(false)
    }
  }

  // Group slots by date
  const slotsByDate = slots.reduce((acc, slot) => {
    if (!acc[slot.date]) acc[slot.date] = []
    acc[slot.date].push(slot)
    return acc
  }, {})

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 max-w-md text-center">
        <p className="text-red-600 font-medium">{error}</p>
        <p className="text-sm text-gray-500 mt-2">If you believe this is an error, please contact us.</p>
      </div>
    </div>
  )

  if (booked) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-gray-200 p-8 max-w-md text-center space-y-4">
        <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <span className="text-green-600 text-2xl">&#10003;</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Interview Confirmed!</h1>
        {bookedDetails && (
          <div className="bg-gray-50 rounded-xl p-4 text-sm text-left space-y-2">
            <p><span className="text-gray-500">Date:</span> <span className="font-medium text-gray-900">{bookedDetails.date}</span></p>
            <p><span className="text-gray-500">Time:</span> <span className="font-medium text-gray-900">{bookedDetails.time}</span></p>
            <p><span className="text-gray-500">Location:</span> <span className="font-medium text-gray-900">18011 Blanco Rd, San Antonio, TX 78258</span></p>
          </div>
        )}
        <p className="text-sm text-gray-500">A confirmation email has been sent. Please bring a valid ID and arrive 10 minutes early.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-xl font-bold">SA</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Schedule Your Interview</h1>
          {candidateName && <p className="text-gray-500 mt-1">Welcome, {candidateName}</p>}
          <p className="text-sm text-gray-500 mt-1">Pick a time that works for you</p>
        </div>

        {Object.keys(slotsByDate).length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400">No available time slots right now. Please check back later.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(slotsByDate).map(([date, dateSlots]) => (
              <div key={date}>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">
                  {format(parseISO(date), 'EEEE, MMMM d, yyyy')}
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {dateSlots.map(slot => (
                    <button
                      key={slot.id}
                      onClick={() => setSelectedSlot(slot.id)}
                      className={`border rounded-xl py-3 px-4 text-sm font-medium transition-all ${
                        selectedSlot === slot.id
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'
                      }`}
                    >
                      {slot.startTime} – {slot.endTime}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedSlot && (
          <div className="mt-8">
            <button
              onClick={handleBook}
              disabled={booking}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-3 rounded-xl transition-colors"
            >
              {booking ? 'Booking...' : 'Confirm Interview'}
            </button>
          </div>
        )}

        <div className="mt-8 bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-sm text-blue-900 font-medium">Interview Location</p>
          <p className="text-sm text-blue-800 mt-1">San Antonio Dodge — 18011 Blanco Rd, San Antonio, TX 78258</p>
          <p className="text-xs text-blue-700 mt-1">Duration: ~45 minutes. Please bring a valid photo ID.</p>
        </div>
      </div>
    </div>
  )
}
