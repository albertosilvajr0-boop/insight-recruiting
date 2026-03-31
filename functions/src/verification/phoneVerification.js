import { getFirestore, FieldValue } from 'firebase-admin/firestore'

/**
 * Generates a random 6-digit code.
 */
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/**
 * Sends a verification code to the user's phone number via SMS.
 * Stores the code in Firestore for later validation.
 *
 * Note: This uses a pluggable SMS transport. Configure TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in your Firebase Functions config
 * for production. Without Twilio credentials, the code is logged to the console
 * for testing purposes.
 */
export async function sendPhoneVerificationHandler(data, context) {
  if (!context.auth) {
    throw new Error('Authentication required.')
  }

  const db = getFirestore()
  const { uid } = data

  if (!uid || uid !== context.auth.uid) {
    throw new Error('Invalid user ID.')
  }

  // Get user's phone number from Firestore
  const userDoc = await db.collection('users').doc(uid).get()
  if (!userDoc.exists) {
    throw new Error('User not found.')
  }

  const phone = userDoc.data().phone
  if (!phone || phone.length < 10) {
    throw new Error('No valid phone number on file.')
  }

  // Rate limit: max 5 codes per hour
  const recentCodes = await db.collection('verificationCodes')
    .where('uid', '==', uid)
    .where('createdAt', '>', new Date(Date.now() - 60 * 60 * 1000))
    .get()

  if (recentCodes.size >= 5) {
    throw new Error('Too many verification attempts. Please try again later.')
  }

  const code = generateCode()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 min expiry

  // Store code in Firestore
  await db.collection('verificationCodes').add({
    uid,
    phone,
    code,
    used: false,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
  })

  // Send SMS
  const formattedPhone = `+1${phone}`

  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    const fromNumber = process.env.TWILIO_PHONE_NUMBER

    if (accountSid && authToken && fromNumber) {
      // Production: send real SMS via Twilio REST API
      const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: formattedPhone,
            From: fromNumber,
            Body: `Your Insight Recruiting verification code is: ${code}. It expires in 10 minutes.`,
          }),
        }
      )

      if (!response.ok) {
        const errorBody = await response.text()
        console.error('[phoneVerification] Twilio error:', errorBody)
        throw new Error('Failed to send SMS.')
      }

      console.log(`[phoneVerification] SMS sent to ${formattedPhone}`)
    } else {
      // Development: log code to console
      console.log(`[phoneVerification] DEV MODE — code for ${formattedPhone}: ${code}`)
    }
  } catch (err) {
    console.error('[phoneVerification] SMS send error:', err)
    throw new Error('Failed to send verification code. Please try again.')
  }

  return { sent: true }
}

/**
 * Verifies the code the user entered against the stored code.
 */
export async function verifyPhoneCodeHandler(data, context) {
  if (!context.auth) {
    throw new Error('Authentication required.')
  }

  const db = getFirestore()
  const { uid, code } = data

  if (!uid || uid !== context.auth.uid) {
    throw new Error('Invalid user ID.')
  }

  if (!code || code.length !== 6) {
    throw new Error('Invalid verification code.')
  }

  // Find the most recent unused code for this user
  const codesSnapshot = await db.collection('verificationCodes')
    .where('uid', '==', uid)
    .where('used', '==', false)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()

  if (codesSnapshot.empty) {
    throw new Error('No verification code found. Please request a new one.')
  }

  const codeDoc = codesSnapshot.docs[0]
  const codeData = codeDoc.data()

  // Check expiry
  const expiresAt = codeData.expiresAt.toDate ? codeData.expiresAt.toDate() : new Date(codeData.expiresAt)
  if (new Date() > expiresAt) {
    await codeDoc.ref.update({ used: true })
    throw new Error('Verification code has expired. Please request a new one.')
  }

  // Check code match
  if (codeData.code !== code) {
    return { verified: false }
  }

  // Mark code as used
  await codeDoc.ref.update({ used: true })

  // Update user doc
  await db.collection('users').doc(uid).update({
    phoneVerified: true,
    updatedAt: FieldValue.serverTimestamp(),
  })

  return { verified: true }
}
