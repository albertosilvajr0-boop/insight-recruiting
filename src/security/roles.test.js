import { describe, expect, it } from 'vitest'
import { PERMISSIONS, ROLES, canAccessRoute, hasPermission, hasRequiredRole } from './roles'

describe('role and permission helpers', () => {
  it('lets superadmins satisfy manager-only and superadmin-only checks', () => {
    expect(hasRequiredRole(ROLES.SUPERADMIN, ROLES.MANAGER)).toBe(true)
    expect(hasRequiredRole(ROLES.SUPERADMIN, ROLES.SUPERADMIN)).toBe(true)
  })

  it('does not let managers satisfy superadmin-only checks', () => {
    expect(hasRequiredRole(ROLES.MANAGER, ROLES.SUPERADMIN)).toBe(false)
  })

  it('honors explicit manager permissions and disabled users', () => {
    const manager = { role: ROLES.MANAGER, permissions: [PERMISSIONS.VIEW_CANDIDATES] }
    expect(hasPermission(manager, PERMISSIONS.VIEW_CANDIDATES)).toBe(true)
    expect(hasPermission(manager, PERMISSIONS.MANAGE_USERS)).toBe(false)
    expect(hasPermission({ ...manager, disabled: true }, PERMISSIONS.VIEW_CANDIDATES)).toBe(false)
  })

  it('checks route role and permission together', () => {
    const user = { role: ROLES.MANAGER, permissions: [PERMISSIONS.VIEW_DASHBOARD] }
    expect(canAccessRoute(user, { requiredPermission: PERMISSIONS.VIEW_DASHBOARD })).toBe(true)
    expect(canAccessRoute(user, { requiredPermission: PERMISSIONS.MANAGE_USERS })).toBe(false)
    expect(canAccessRoute(user, { requiredRole: ROLES.SUPERADMIN })).toBe(false)
  })
})
