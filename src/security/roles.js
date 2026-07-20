export const ROLES = Object.freeze({
  SUPERADMIN: 'superadmin',
  MANAGER: 'manager',
})

export const ROLE_LEVELS = Object.freeze({
  [ROLES.SUPERADMIN]: 100,
  [ROLES.MANAGER]: 10,
})

export const PERMISSIONS = Object.freeze({
  VIEW_DASHBOARD: 'view_dashboard',
  VIEW_CANDIDATES: 'view_candidates',
  SCORE_CANDIDATES: 'score_candidates',
  MANAGE_JOBS: 'manage_jobs',
  MANAGE_QUESTIONS: 'manage_questions',
  MANAGE_ONBOARDING: 'manage_onboarding',
  MANAGE_USERS: 'manage_users',
  VIEW_ANALYTICS: 'view_analytics',
})

export const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  [ROLES.SUPERADMIN]: Object.values(PERMISSIONS),
  [ROLES.MANAGER]: [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_CANDIDATES,
    PERMISSIONS.SCORE_CANDIDATES,
    PERMISSIONS.MANAGE_ONBOARDING,
  ],
})

export function normalizeRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_LEVELS, role) ? role : null
}

export function roleLevel(role) {
  return ROLE_LEVELS[normalizeRole(role)] || 0
}

export function hasRequiredRole(userRole, requiredRole) {
  if (!requiredRole) return roleLevel(userRole) > 0
  return roleLevel(userRole) >= roleLevel(requiredRole)
}

export function hasPermission(user, permission) {
  if (!user || user.disabled) return false
  if (user.role === ROLES.SUPERADMIN) return true
  return Array.isArray(user.permissions) && user.permissions.includes(permission)
}

export function canAccessRoute(user, { requiredRole, requiredPermission } = {}) {
  if (!user || user.disabled) return false
  if (!hasRequiredRole(user.role, requiredRole)) return false
  if (requiredPermission && !hasPermission(user, requiredPermission)) return false
  return true
}
