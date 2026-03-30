import { google } from 'googleapis'

let authClient = null

export async function getGoogleAuth() {
  if (authClient) return authClient
  authClient = new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar'
    ]
  })
  return authClient
}

export async function getGmailClient() {
  const auth = await getGoogleAuth()
  return google.gmail({ version: 'v1', auth })
}

export async function getCalendarClient() {
  const auth = await getGoogleAuth()
  return google.calendar({ version: 'v3', auth })
}
