import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import JobListings from './pages/JobListings'
import Apply from './pages/Apply'
import ThankYou from './pages/ThankYou'
import Status from './pages/Status'
import Schedule from './pages/Schedule'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import AdminCandidate from './pages/AdminCandidate'
import AdminJobs from './pages/AdminJobs'
import AdminUsers from './pages/AdminUsers'
import AdminAvailability from './pages/AdminAvailability'
import AdminQuestions from './pages/AdminQuestions'
import AdminAnalytics from './pages/AdminAnalytics'
import ProtectedRoute from './components/ProtectedRoute'
import useForceRefresh from './hooks/useForceRefresh'
import { PERMISSIONS, ROLES } from './security/roles'

export default function App() {
  useForceRefresh()
  return (
    <BrowserRouter>
      <Routes>
        {/* Public — candidate facing */}
        <Route path="/" element={<JobListings />} />
        <Route path="/apply/:jobId" element={<Apply />} />
        <Route path="/thank-you" element={<ThankYou />} />
        <Route path="/status/:token" element={<Status />} />
        <Route path="/schedule/:token" element={<Schedule />} />

        {/* Admin */}
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={
          <ProtectedRoute requiredPermission={PERMISSIONS.VIEW_DASHBOARD}><AdminDashboard /></ProtectedRoute>
        } />
        <Route path="/admin/candidates/:candidateId" element={
          <ProtectedRoute requiredPermission={PERMISSIONS.VIEW_CANDIDATES}><AdminCandidate /></ProtectedRoute>
        } />
        {/* Superadmin only */}
        <Route path="/admin/jobs" element={
          <ProtectedRoute requiredRole={ROLES.SUPERADMIN} requiredPermission={PERMISSIONS.MANAGE_JOBS}><AdminJobs /></ProtectedRoute>
        } />
        <Route path="/admin/users" element={
          <ProtectedRoute requiredRole={ROLES.SUPERADMIN} requiredPermission={PERMISSIONS.MANAGE_USERS}><AdminUsers /></ProtectedRoute>
        } />
        <Route path="/admin/questions" element={
          <ProtectedRoute requiredRole={ROLES.SUPERADMIN} requiredPermission={PERMISSIONS.MANAGE_QUESTIONS}><AdminQuestions /></ProtectedRoute>
        } />
        <Route path="/admin/availability" element={
          <ProtectedRoute requiredRole={ROLES.SUPERADMIN} requiredPermission={PERMISSIONS.MANAGE_AVAILABILITY}><AdminAvailability /></ProtectedRoute>
        } />
        <Route path="/admin/analytics" element={
          <ProtectedRoute requiredRole={ROLES.SUPERADMIN} requiredPermission={PERMISSIONS.VIEW_ANALYTICS}><AdminAnalytics /></ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
