export const ROLES = Object.freeze({
  SUPERADMIN: 'superadmin',
  MANAGER: 'manager',
})

export const PERMISSIONS = Object.freeze({
  VIEW_DASHBOARD: 'view_dashboard',
  VIEW_CANDIDATES: 'view_candidates',
  SCORE_CANDIDATES: 'score_candidates',
  SCHEDULE_INTERVIEWS: 'schedule_interviews',
  MANAGE_JOBS: 'manage_jobs',
  MANAGE_QUESTIONS: 'manage_questions',
  MANAGE_AVAILABILITY: 'manage_availability',
  MANAGE_USERS: 'manage_users',
  VIEW_ANALYTICS: 'view_analytics',
})

export const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  [ROLES.SUPERADMIN]: Object.values(PERMISSIONS),
  [ROLES.MANAGER]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_CANDIDATES,
    PERMISSIONS.SCORE_CANDIDATES,
    PERMISSIONS.SCHEDULE_INTERVIEWS,
  ],
})

export function isAllowedRole(role) {
  return role === ROLES.SUPERADMIN || role === ROLES.MANAGER
}

export function normalizeRole(role) {
  return isAllowedRole(role) ? role : ROLES.MANAGER
}

export function normalizePermissions(role, permissions) {
  if (role === ROLES.SUPERADMIN) return ROLE_DEFAULT_PERMISSIONS[ROLES.SUPERADMIN]
  const allowed = new Set(Object.values(PERMISSIONS))
  const requested = Array.isArray(permissions) ? permissions.filter((p) => allowed.has(p)) : []
  return requested.length ? requested : ROLE_DEFAULT_PERMISSIONS[ROLES.MANAGER]
}

export function canManageUsers(userData) {
  return userData?.role === ROLES.SUPERADMIN && userData.disabled !== true
}
