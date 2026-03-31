import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import JobListings from './pages/JobListings'
import Apply from './pages/Apply'
import ThankYou from './pages/ThankYou'
import Schedule from './pages/Schedule'
import AdminLogin from './pages/AdminLogin'
import CreateAccount from './pages/CreateAccount'
import VerifyAccount from './pages/VerifyAccount'
import AdminDashboard from './pages/AdminDashboard'
import AdminCandidate from './pages/AdminCandidate'
import AdminJobs from './pages/AdminJobs'
import AdminUsers from './pages/AdminUsers'
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public — candidate facing */}
        <Route path="/" element={<JobListings />} />
        <Route path="/apply/:jobId" element={<Apply />} />
        <Route path="/thank-you" element={<ThankYou />} />
        <Route path="/schedule/:token" element={<Schedule />} />

        {/* Admin */}
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/create-account" element={<CreateAccount />} />
        <Route path="/admin/verify" element={<VerifyAccount />} />
        <Route path="/admin/dashboard" element={
          <ProtectedRoute><AdminDashboard /></ProtectedRoute>
        } />
        <Route path="/admin/candidates/:candidateId" element={
          <ProtectedRoute><AdminCandidate /></ProtectedRoute>
        } />
        <Route path="/admin/jobs" element={
          <ProtectedRoute><AdminJobs /></ProtectedRoute>
        } />
        <Route path="/admin/users" element={
          <ProtectedRoute><AdminUsers /></ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
