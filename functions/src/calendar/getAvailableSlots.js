import { getFirestore } from 'firebase-admin/firestore'
import { format, addDays } from 'date-fns'

export async function getAvailableSlots(token) {
  const db = getFirestore()

  // Verify token belongs to a real candidate in scheduling stage
  const candidateSnap = await db.collection('candidates')
    .where('schedulingToken', '==', token)
    .limit(1)
    .get()

  if (candidateSnap.empty || !['to_schedule', 'scheduling'].includes(candidateSnap.docs[0].data().stage)) {
    throw new Error('Invalid or expired scheduling link.')
  }

  const candidate = candidateSnap.docs[0].data()

  // Get available (unbooked) slots for the next 14 days
  const today = format(new Date(), 'yyyy-MM-dd')
  const twoWeeksOut = format(addDays(new Date(), 14), 'yyyy-MM-dd')

  const slotsSnap = await db.collection('availability')
    .where('booked', '==', false)
    .where('date', '>=', today)
    .where('date', '<=', twoWeeksOut)
    .orderBy('date', 'asc')
    .orderBy('startTime', 'asc')
    .get()

  const slots = slotsSnap.docs.map(d => ({
    id: d.id,
    date: d.data().date,
    startTime: d.data().startTime,
    endTime: d.data().endTime,
    duration: d.data().duration
  }))

  return {
    slots,
    candidateName: candidate.firstName
  }
}
