import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { getCalendarClient } from '../utils/googleAuth.js'
import { sendConfirmationEmail } from '../email/sendConfirmation.js'
import { parseISO, setHours, setMinutes } from 'date-fns'

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary'

export async function bookSlot(token, slotId) {
  const db = getFirestore()

  // Verify token
  const candidateSnap = await db.collection('candidates')
    .where('schedulingToken', '==', token)
    .where('stage', '==', 'scheduling')
    .limit(1)
    .get()

  if (candidateSnap.empty) {
    throw new Error('Invalid or expired scheduling link.')
  }

  const candidateDoc = candidateSnap.docs[0]
  const candidate = candidateDoc.data()
  const candidateId = candidateDoc.id

  // Get the slot
  const slotRef = db.collection('availability').doc(slotId)
  const slotSnap = await slotRef.get()

  if (!slotSnap.exists || slotSnap.data().booked) {
    throw new Error('This time slot is no longer available. Please select another.')
  }

  const slot = slotSnap.data()

  // Parse date and time for Google Calendar
  const [startHour, startMin] = slot.startTime.split(':').map(Number)
  const [endHour, endMin] = slot.endTime.split(':').map(Number)
  const dateObj = parseISO(slot.date)
  const startDateTime = setMinutes(setHours(dateObj, startHour), startMin)
  const endDateTime = setMinutes(setHours(dateObj, endHour), endMin)

  // Create Google Calendar event
  let googleEventId = null
  try {
    const calendar = await getCalendarClient()
    const event = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      requestBody: {
        summary: `Interview: ${candidate.firstName} ${candidate.lastName} — ${candidate.jobTitle}`,
        description: `Candidate: ${candidate.firstName} ${candidate.lastName}\nRole: ${candidate.jobTitle}\nEmail: ${candidate.email}\nPhone: ${candidate.phone}\nComposite Score: ${candidate.compositeScore?.toFixed(1) || 'N/A'}/10`,
        location: '18011 Blanco Rd, San Antonio, TX 78258',
        start: { dateTime: startDateTime.toISOString(), timeZone: 'America/Chicago' },
        end: { dateTime: endDateTime.toISOString(), timeZone: 'America/Chicago' },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 60 },
            { method: 'popup', minutes: 15 }
          ]
        }
      }
    })
    googleEventId = event.data.id
  } catch (err) {
    console.error('[calendar] Failed to create event:', err.message)
    // Continue even if calendar fails — the booking itself still works
  }

  // Use a batch to atomically update slot + candidate
  const batch = db.batch()

  batch.update(slotRef, {
    booked: true,
    candidateId,
    googleEventId
  })

  batch.update(db.collection('candidates').doc(candidateId), {
    stage: 'scheduled',
    scheduledAt: Timestamp.fromDate(startDateTime),
    scheduledSlotId: slotId,
    updatedAt: FieldValue.serverTimestamp()
  })

  await batch.commit()

  // Send confirmation email
  try {
    await sendConfirmationEmail(candidateId, slot.date, `${slot.startTime} – ${slot.endTime}`)
  } catch (err) {
    console.error('[email] Failed to send confirmation:', err.message)
  }

  return {
    date: slot.date,
    time: `${slot.startTime} – ${slot.endTime}`,
    location: '18011 Blanco Rd, San Antonio, TX 78258'
  }
}
