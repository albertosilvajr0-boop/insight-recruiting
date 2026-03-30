# SA Recruiting Platform — Claude Code Project Spec

## Project Overview
An end-to-end AI-powered recruiting platform for **San Antonio Dodge** (Silva Consulting Group client).
Goal: Alberto only gets notified when a candidate is ready for an in-person interview.
Everything before that — posting, screening, video interviews, scoring, scheduling — is automated.

## Business Rules
- Dealership: San Antonio Dodge
- Roles hiring for: BDC Agent, Sales Rep, Service Advisor (multi-role from day one)
- Admin email for digests: albertosilva@silvaconsultinggroup.com
- Daily digest fires at 7:00 AM Mountain Time
- Auto-reject threshold: score < 5/10
- Auto-advance to scheduling threshold: score >= 8/10
- Human review required: score 5–7/10 (flagged in admin portal)
- No third-party SaaS — everything custom built
- Stack: React + Firebase (Hosting, Firestore, Storage, Functions, Auth) + Claude API + Google STT + Google Calendar API + Gmail API

## Tech Stack
- Frontend: React 18, React Router v6, Tailwind CSS
- Backend: Firebase Cloud Functions (Node.js 18)
- Database: Firestore
- File Storage: Firebase Storage (resumes + video chunks)
- Auth: Firebase Auth (admin portal only — candidates do NOT need accounts)
- AI: Claude claude-sonnet-4-20250514 via Anthropic API
- Speech-to-Text: Google Cloud Speech-to-Text v1
- Calendar: Google Calendar API v3
- Email: Gmail API (send-only, via service account)
- Hosting: Firebase Hosting

## Environment Variables (set in .env and Firebase Functions config)
```
ANTHROPIC_API_KEY=
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
GMAIL_SENDER=albertosilva@silvaconsultinggroup.com
GOOGLE_CALENDAR_ID=primary
FIREBASE_PROJECT_ID=
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

## Project Structure
```
sa-recruiting/
├── CLAUDE.md                    ← you are here
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── .env                         ← gitignored
├── package.json                 ← root (workspaces)
├── src/                         ← React frontend
│   ├── main.jsx
│   ├── App.jsx                  ← router
│   ├── firebase.js              ← Firebase init
│   ├── pages/
│   │   ├── JobListings.jsx      ← public job board
│   │   ├── Apply.jsx            ← candidate portal + video recording
│   │   ├── ThankYou.jsx         ← post-submission confirmation
│   │   ├── Schedule.jsx         ← candidate self-scheduling (token-gated)
│   │   ├── AdminLogin.jsx
│   │   ├── AdminDashboard.jsx   ← pipeline kanban
│   │   ├── AdminCandidate.jsx   ← candidate detail + video playback
│   │   └── AdminJobs.jsx        ← job posting management
│   ├── components/
│   │   ├── VideoRecorder.jsx    ← MediaRecorder wrapper (video + voice)
│   │   ├── ScoreBadge.jsx
│   │   ├── PipelineColumn.jsx
│   │   ├── CandidateCard.jsx
│   │   └── ProtectedRoute.jsx
│   ├── hooks/
│   │   ├── useMediaRecorder.js  ← handles MediaRecorder API
│   │   └── useUploadChunks.js   ← chunked upload to Firebase Storage
│   └── utils/
│       ├── scoring.js           ← score display helpers
│       └── dateUtils.js
├── functions/
│   ├── package.json
│   └── src/
│       ├── index.js             ← function exports
│       ├── pipeline/
│       │   ├── scoreResume.js   ← Claude API resume scoring
│       │   ├── transcribeVideo.js ← Google STT
│       │   ├── scoreInterview.js  ← Claude API video/transcript scoring
│       │   └── routeCandidate.js  ← threshold logic + auto-actions
│       ├── email/
│       │   ├── sendRejection.js
│       │   ├── sendScheduleLink.js
│       │   ├── sendConfirmation.js
│       │   ├── sendReminder.js
│       │   └── dailyDigest.js
│       ├── calendar/
│       │   ├── getAvailableSlots.js
│       │   ├── bookSlot.js
│       │   └── cancelSlot.js
│       └── utils/
│           ├── anthropic.js     ← Anthropic client
│           ├── googleAuth.js    ← Google API auth
│           └── firestore.js     ← Firestore helpers
```

## Firestore Schema

### Collection: `jobs`
```js
{
  id: string,
  title: string,                 // "BDC Agent" | "Sales Rep" | "Service Advisor"
  dealership: "San Antonio Dodge",
  description: string,
  requirements: string[],
  mustHaves: string[],           // hard requirements for scoring
  niceToHaves: string[],
  payRange: { min: number, max: number },
  status: "active" | "paused" | "closed",
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### Collection: `candidates`
```js
{
  id: string,
  firstName: string,
  lastName: string,
  email: string,
  phone: string,
  jobId: string,
  jobTitle: string,
  dealership: "San Antonio Dodge",
  stage: "applied" | "screening" | "interview_1" | "interview_2" | "scheduling" | "scheduled" | "rejected" | "hired",
  resumeUrl: string,             // Firebase Storage URL
  videoUrl: string,              // Firebase Storage URL
  videoTranscript: string,
  resumeScore: number,           // 1-10
  interviewScore: number,        // 1-10
  compositeScore: number,        // weighted average
  resumeAnalysis: string,        // Claude reasoning
  interviewAnalysis: string,     // Claude reasoning
  strengths: string[],
  concerns: string[],
  schedulingToken: string,       // UUID for schedule link
  scheduledAt: Timestamp,
  scheduledSlotId: string,
  adminNotes: string,
  hiringManagerRating: number,   // 1-5 post-interview feedback
  rejectionEmailSent: boolean,
  scheduleEmailSent: boolean,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### Collection: `availability`
```js
{
  id: string,
  date: string,                  // "2025-04-15"
  startTime: string,             // "09:00"
  endTime: string,               // "09:45"
  duration: 45,                  // minutes
  booked: boolean,
  candidateId: string | null,
  googleEventId: string | null,
  createdAt: Timestamp
}
```

## Video Recording — Key Technical Notes
- Use browser-native `MediaRecorder` API — no external SDK
- Support both video (webcam + mic) and audio-only (voice) modes
- Record in chunks: `timeslice: 1000` (1 second chunks)
- Upload each chunk to Firebase Storage as it arrives (streaming upload)
- Path pattern: `videos/{candidateId}/{chunkIndex}.webm`
- On completion: Cloud Function stitches chunks, produces final file
- Fallback: if MediaRecorder not supported, show file upload input
- Max recording time: 3 minutes per question
- Show countdown timer + waveform visualizer during recording
- Questions are defined per job role (see scoring rubrics below)

## Interview Questions Per Role

### BDC Agent
1. "Tell me about yourself and why you're interested in this BDC role."
2. "A customer calls frustrated about a follow-up that was missed. Walk me through how you handle that call."
3. "How do you stay motivated making high-volume outbound calls?"

### Sales Rep
1. "Tell me about yourself and your sales background."
2. "A customer says the monthly payment is too high. Walk me through your response."
3. "What does your follow-up process look like after a customer visits but doesn't buy?"

### Service Advisor
1. "Tell me about yourself and your service experience."
2. "A customer is upset their car wasn't ready when promised. How do you handle it?"
3. "How do you upsell additional services without feeling pushy?"

## Claude API Scoring Rubrics

### Resume Scoring Prompt Pattern
```
You are a recruiter for San Antonio Dodge evaluating a candidate for {jobTitle}.

Score this resume 1-10 based on:
- Relevant experience in automotive/dealership (weight: 30%)
- Customer-facing or sales experience (weight: 25%)
- Communication indicators from resume quality (weight: 20%)
- Tenure/stability at previous jobs (weight: 15%)
- Education/certifications (weight: 10%)

Hard disqualifiers (auto score 1): no license if required, requires sponsorship

Respond in JSON:
{
  "score": number,
  "strengths": string[],
  "concerns": string[],
  "reasoning": string,
  "autoDisqualified": boolean,
  "disqualifierReason": string | null
}
```

### Interview Scoring Prompt Pattern
```
You are evaluating a candidate interview transcript for {jobTitle} at San Antonio Dodge.

Score 1-10 based on:
- Communication clarity and professionalism (weight: 35%)
- Relevant experience demonstrated (weight: 30%)
- Customer service orientation (weight: 20%)
- Motivation and enthusiasm for the role (weight: 15%)

Transcript:
{transcript}

Respond in JSON:
{
  "score": number,
  "strengths": string[],
  "concerns": string[],
  "reasoning": string,
  "standoutQuotes": string[]
}
```

## Routing Logic (routeCandidate.js)
```
compositeScore = (resumeScore * 0.4) + (interviewScore * 0.6)

if autoDisqualified → stage = "rejected", send rejection email
if compositeScore < 5 → stage = "rejected", send rejection email
if compositeScore >= 8 → stage = "scheduling", send schedule link email
if compositeScore 5-7 → stage = "interview_2", flag for admin review
```

## Email Templates

### Rejection Email
Subject: "Thank you for your interest — San Antonio Dodge"
Warm, professional, encourage reapplication in 6 months.

### Schedule Link Email
Subject: "Great news! Next step — San Antonio Dodge"
Congratulate, explain in-person interview, include scheduling link.
URL: https://{domain}/schedule/{schedulingToken}

### Confirmation Email
Subject: "Interview confirmed — San Antonio Dodge"
Date, time, address (18011 Blanco Rd, San Antonio, TX 78258), what to bring.

### Reminder Emails
- 24 hours before: reminder with details
- 1 hour before: "See you soon" reminder

### Daily Digest (7 AM MT)
To: albertosilva@silvaconsultinggroup.com
List all candidates scheduled for today with: name, role, time, composite score, top strengths.

## Admin Portal Features
- Firebase Auth email/password login (admin only)
- Kanban board: columns = pipeline stages
- Candidate card: name, role, score badge, time in stage
- Candidate detail: resume PDF viewer, video playback, score breakdown, Claude analysis, approve/reject/flag actions
- Job management: create/edit/pause jobs, set scoring criteria
- Analytics: funnel by stage, platform source, avg scores by role
- Post-interview rating: 1-5 stars after in-person interview (feeds scoring feedback loop)

## Scheduling UI (public, token-gated)
- Candidate receives unique link with token
- Page shows available slots for next 14 days
- Candidate picks one slot, confirms
- Google Calendar event created
- Confirmation email sent to candidate
- Admin notified

## Coding Standards
- Use async/await throughout, no callbacks
- All Firestore writes use batch where touching >1 doc
- All Cloud Functions have try/catch with structured error logging
- React components use functional components + hooks only
- No class components
- Tailwind for all styling — no CSS files
- All date handling uses date-fns
- Environment variables never hardcoded
- Every Cloud Function validates input before processing

## Current Build Status
- [ ] Project scaffold
- [ ] Firebase config
- [ ] Job listings page
- [ ] Apply page with video recording
- [ ] Thank you page
- [ ] Cloud Functions: pipeline
- [ ] Cloud Functions: email
- [ ] Cloud Functions: calendar
- [ ] Admin portal
- [ ] Schedule page
- [ ] Daily digest
- [ ] Deploy + test

## How to Run Locally
```bash
# Frontend
npm install
npm run dev

# Functions (emulator)
cd functions && npm install
firebase emulators:start
```
