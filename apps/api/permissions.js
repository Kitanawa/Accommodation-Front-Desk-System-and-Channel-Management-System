// Role privilege matrix, SRS section 4. Single source of truth for server-side checks (S057).
const ADMIN = 'ADMINISTRATOR', MGR = 'OWNER_MANAGER', FD = 'FRONT_DESK';
const ALL = [ADMIN, MGR, FD];
const ROLES = ALL;

// permission -> roles that hold it. The two special cases are handled in can().
const MATRIX = {
  'users.view':               [ADMIN, MGR],      // Manage users & roles: Admin Full, Manager Limited / View, Front Desk No
  'users.manage_any':         [ADMIN],           // full
  'users.manage_frontdesk':   [ADMIN, MGR],      // "Limited": a Manager manages Front Desk accounts only (assumption)
  'catalog.view':             ALL,               // Manage room categories/types: Full, Full, View
  'catalog.manage':           [ADMIN, MGR],
  'stock.view':               ALL,               // Manage room stock: Full, Full, View
  'stock.manage':             [ADMIN, MGR],
  'rates.view_approved':      ALL,               // Create/edit rates: Full, Full, View approved
  'rates.view_all':           [ADMIN, MGR],
  'rates.manage':             [ADMIN, MGR],
  'rates.approve':            [ADMIN, MGR],      // Manager only when users.can_approve_rates (Configurable), see can()
  'reservations.manage':      ALL,               // Create/edit/cancel reservations: Full for all
  'stay.operate':             ALL,               // Assign rooms / check-in / check-out: Full for all
  'folio.manage':             ALL,               // Folio, charges & payments: Full for all
  'billing.discount':         [ADMIN, MGR],      // not in the matrix: discounts and refund approval need management (assumption)
  'billing.refund':           [ADMIN, MGR],
  'settings.view':            ALL,               // property policies: everyone reads, management changes (assumption)
  'settings.manage':          [ADMIN, MGR],
  'maintenance.release':      [ADMIN, MGR],      // anyone reports a problem; management releases a blocked room (assumption)
  'integration.manage':       [ADMIN],           // Channel/integration settings: Full, View, No
  'integration.view':         [ADMIN, MGR],
  'reports.full':             [ADMIN, MGR],      // Reports: Full, Full, Operational
  'reports.operational':      ALL,
  'audit.view':               [ADMIN, MGR],      // not in the matrix: assumption (FR-22 audit trail is for management)
};

function can(user, permission) {
  if (!user || !(MATRIX[permission] || []).includes(user.role)) return false;
  if (permission === 'rates.approve' && user.role === MGR) return user.can_approve_rates === true;   // "Configurable"
  return true;
}
// Can this user manage (create / edit / reset / revoke) an account that has targetRole?
function canManageUser(actor, targetRole) {
  if (can(actor, 'users.manage_any')) return true;
  return targetRole === FD && can(actor, 'users.manage_frontdesk');
}
module.exports = { ADMIN, MGR, FD, ROLES, MATRIX, can, canManageUser };
