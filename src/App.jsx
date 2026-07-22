import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import CandidateLogin from './pages/CandidateLogin'
import JobListings from './pages/JobListings'
import Apply from './pages/Apply'
import ThankYou from './pages/ThankYou'
import Status from './pages/Status'
import EmployerReview from './pages/EmployerReview'
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import AdminCandidate from './pages/AdminCandidate'
import AdminJobs from './pages/AdminJobs'
import AdminUsers from './pages/AdminUsers'
import AdminQuestions from './pages/AdminQuestions'
import AdminLibrary from './pages/AdminLibrary'
import AdminInvite from './pages/AdminInvite'
import AdminDemo from './pages/AdminDemo'
import AdminAnalytics from './pages/AdminAnalytics'
import AdminOnboarding from './pages/AdminOnboarding'
import AdminEmployers from './pages/AdminEmployers'
import AdminEmployerDetail from './pages/AdminEmployerDetail'
import AdminCampaignDetail from './pages/AdminCampaignDetail'
import ProtectedRoute from './components/ProtectedRoute'
import useForceRefresh from './hooks/useForceRefresh'
import { PERMISSIONS, ROLES } from './security/roles'

export default function App() {
  useForceRefresh()
  return (
    <BrowserRouter>
      <Routes>
        {/* Public — candidate facing */}
        <Route path="/" element={<CandidateLogin />} />
        <Route path="/jobs" element={<JobListings />} />
        <Route path="/apply/:jobId" element={<Apply />} />
        <Route path="/i/:code" element={<Apply />} />
        <Route path="/thank-you" element={<ThankYou />} />
        <Route path="/status/:token" element={<Status />} />
        <Route path="/review/:campaignId/:token" element={<EmployerReview />} />

        {/* Admin */}
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={
          <ProtectedRoute requiredPermission={PERMISSIONS.VIEW_DASHBOARD}><AdminDashboard /></ProtectedRoute>
        } />
        <Route path="/admin/candidates/:candidateId" element={
          <ProtectedRoute requiredPermission={PERMISSIONS.VIEW_CANDIDATES}><AdminCandidate /></ProtectedRoute>
        } />
        <Route path="/admin/invite" element={
          <ProtectedRoute requiredPermission={PERMISSIONS.VIEW_CANDIDATES}><AdminInvite /></ProtectedRoute>
        } />
        <Route path="/admin/demo" element={
          <ProtectedRoute requiredRole={ROLES.SUPERADMIN}><AdminDemo /></ProtectedRoute>
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
        <Route path="/admin/library" element={
          <ProtectedRoute requiredRole={ROLES.SUPERADMIN} requiredPermission={PERMISSIONS.MANAGE_QUESTIONS}><AdminLibrary /></ProtectedRoute>
        } />
        <Route path="/admin/analytics" element={
          <ProtectedRoute requiredRole={ROLES.SUPERADMIN} requiredPermission={PERMISSIONS.VIEW_ANALYTICS}><AdminAnalytics /></ProtectedRoute>
        } />
        <Route path="/admin/employers" element={
          <ProtectedRoute requiredPermission={PERMISSIONS.VIEW_CANDIDATES}><AdminEmployers /></ProtectedRoute>
        } />
        <Route path="/admin/employers/:employerId" element={
          <ProtectedRoute requiredPermission={PERMISSIONS.VIEW_CANDIDATES}><AdminEmployerDetail /></ProtectedRoute>
        } />
        <Route path="/admin/campaigns/:campaignId" element={
          <ProtectedRoute requiredPermission={PERMISSIONS.VIEW_CANDIDATES}><AdminCampaignDetail /></ProtectedRoute>
        } />
        <Route path="/admin/onboarding" element={
          <ProtectedRoute requiredPermission={PERMISSIONS.MANAGE_ONBOARDING}><AdminOnboarding /></ProtectedRoute>
        } />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
