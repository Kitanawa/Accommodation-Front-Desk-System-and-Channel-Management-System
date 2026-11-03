// Single source for the API contract (S055). docs/build.js turns this into API_CONTRACT.md and openapi.yaml.
// status: 'implemented' = runs today. A status such as 'S060' would mean: defined now, built in that subtask.
const P = require('../permissions');

// ---- shorthand types: uuid, date, time, datetime, int, number, string, bool, enum:A|B, ref:Name, T[], T? (nullable)
const E = {
  role: 'enum:ADMINISTRATOR|OWNER_MANAGER|FRONT_DESK',
  resStatus: 'enum:CONFIRMED|CHECKED_IN|CHECKED_OUT|CANCELLED', payStatus: 'enum:UNPAID|PARTIAL|PAID',
  roomStatus: 'enum:AVAILABLE|OCCUPIED|CLEANING|MAINTENANCE_BLOCKED', rule: 'enum:BASE|DATE_RANGE|SELECTED_DAY|SPECIFIC_DATE',
  method: 'enum:CASH|CARD|ONLINE|BANK_TRANSFER', approval: 'enum:PENDING|APPROVED',
};
const schemas = {
  Ok: { ok: 'bool' },
  User: { user_id: 'uuid', name: 'string', email: 'string', role: E.role, can_approve_rates: 'bool', property_id: 'uuid' },
  LoginResponse: { token: 'string', expires_at: 'datetime', user: 'ref:User' },
  Source: { source_id: 'int', code: 'string', name: 'string' },
  Photo: { url: 'string', caption: 'string?', alt: 'string?', sort_order: 'int' },
  RoomType: { room_type_id: 'uuid', category_id: 'uuid', name: 'string', category: 'string', max_guests: 'int', min_nights: 'int', description: 'string?', facilities: 'string[]?', photos: 'ref:Photo[]?', layout_info: 'string?', approval_status: E.approval },
  RoomRef: { room_id: 'uuid', room_number: 'string', floor: 'int?' },
  RateLine: { rate_rule_id: 'uuid', rule_type: E.rule, rate_amount: 'number', date_from: 'date?', date_to: 'date?', selected_days: 'int[]?', specific_date: 'date?', priority: 'int?', approval_status: E.approval, supersedes_id: 'uuid?', effective_from: 'date?', valid_until: 'date?' },
  RoomTypeDetail: { room_type_id: 'uuid', category_id: 'uuid', name: 'string', category: 'string', max_guests: 'int', min_nights: 'int', description: 'string?', facilities: 'string[]?', photos: 'ref:Photo[]?', layout_info: 'string?', approval_status: E.approval, rates: 'ref:RateLine[]', rooms: 'ref:RoomRef[]' },
  RoomTypeSubmitted: { room_type_id: 'uuid', approval_status: E.approval, rates_submitted: 'int' },
  RoomTypeApproved: { ok: 'bool', approval_status: E.approval, rates_approved: 'int' },
  RoomCategory: { category_id: 'uuid', name: 'string', room_type_count: 'int' },
  RateInput: { rule_type: E.rule, rate_amount: 'number', date_from: 'date?', date_to: 'date?', selected_days: 'int[]?', specific_date: 'date?', priority: 'int?', currency_code: 'string?' },
  AddOn: { add_on_id: 'uuid', name: 'string', description: 'string?', pricing_unit: 'enum:PER_STAY|PER_NIGHT|PER_GUEST', unit_price: 'number', approval_status: E.approval, is_active: 'bool', pending_unit_price: 'number?' },
  ReservationRow: { reservation_id: 'uuid', reservation_ref: 'string', full_name: 'string', room_type: 'string', room_number: 'string?', check_in: 'date', check_out: 'date', total_guests: 'int', status: E.resStatus, payment_status: E.payStatus, source: 'string', total: 'number' },
  DashboardRow: { reservation_id: 'uuid', reservation_ref: 'string', full_name: 'string', room_type: 'string', room_number: 'string?', check_in: 'date', check_out: 'date', status: E.resStatus, payment_status: E.payStatus },
  Dashboard: { today: 'date', arrivals: 'ref:DashboardRow[]', departures: 'ref:DashboardRow[]', in_house: 'int', occupied: 'int', total_rooms: 'int', pending_rates: 'int?' },
  NightRate: { date: 'date', rate: 'number?', rule: 'string?' },
  CalendarCell: { date: 'date', left: 'int', total: 'int', rate: 'number?' },
  CalendarRoomType: { room_type_id: 'uuid', name: 'string', max_guests: 'int', min_nights: 'int', description: 'string?', cells: 'ref:CalendarCell[]' },
  Calendar: { currency: 'string', from: 'date', to: 'date', room_types: 'ref:CalendarRoomType[]' },
  AvailabilityItem: { room_type_id: 'uuid', name: 'string', category: 'string', max_guests: 'int', min_nights: 'int', nights: 'int', rooms_left: 'int', total: 'number?', nightly: 'ref:NightRate[]', bookable: 'bool', reasons: 'string[]' },
  ReservationCreated: { reservation_id: 'uuid', reservation_ref: 'string' },
  Charge: { charge_id: 'uuid', charge_type: 'enum:ROOM|ADDITIONAL|ADD_ON', description: 'string', quantity: 'number', unit_price: 'number', amount: 'number', charged_at: 'datetime' },
  Payment: { payment_id: 'uuid', amount: 'number', method: E.method, status: 'enum:PENDING|COMPLETED|FAILED', paid_at: 'datetime' },
  ReservationDetail: { reservation_id: 'uuid', reservation_ref: 'string', check_in: 'date', check_out: 'date', estimated_arrival: 'time?', total_guests: 'int', status: E.resStatus, payment_status: E.payStatus,
    special_requests: 'string?', notes: 'string?', created_at: 'datetime', guest_id: 'uuid', full_name: 'string', phone: 'string?', email: 'string?', nationality: 'string?', id_passport_no: 'string?', address: 'string?',
    source: 'string', reservation_room_id: 'uuid', room_type_id: 'uuid', room_id: 'uuid?', rate_total: 'number', room_type: 'string', room_number: 'string?', folio_id: 'uuid', closed_at: 'datetime?',
    charges: 'ref:Charge[]', payments: 'ref:Payment[]', total_charges: 'number', total_paid: 'number', balance: 'number' },
  FreeRoom: { room_id: 'uuid', room_number: 'string', status: E.roomStatus },
  Room: { room_id: 'uuid', room_number: 'string', floor: 'int?', room_type_id: 'uuid', room_type: 'string', status: E.roomStatus, in_house_ref: 'string?' },
  RoomCreated: { room_id: 'uuid', room_number: 'string', room_type_id: 'uuid', floor: 'int?', status: E.roomStatus },
  RoomUpdated: { room_id: 'uuid', room_number: 'string', floor: 'int?', room_type_id: 'uuid' },
  Rate: { rate_rule_id: 'uuid', room_type_id: 'uuid', room_type: 'string', rule_type: E.rule, rate_amount: 'number', currency_code: 'string', date_from: 'date?', date_to: 'date?', selected_days: 'int[]?', specific_date: 'date?', priority: 'int?', approval_status: E.approval,
    supersedes_id: 'uuid?', effective_from: 'date?', valid_until: 'date?', in_force: 'bool' },
  RateWarning: { code: 'string', message: 'string', rate_rule_id: 'uuid' },
  RateCreated: { rate_rule_id: 'uuid', approval_status: E.approval, warnings: 'ref:RateWarning[]' },
  RateRevisionCreated: { rate_rule_id: 'uuid', approval_status: E.approval, supersedes_id: 'uuid', current_rate: 'number', effective_from: 'date?' },
  AlsoMatched: { rate_rule_id: 'uuid', rule_type: E.rule, rate_amount: 'number', priority: 'int' },
  PreviewNight: { date: 'date', rate: 'number?', rule: 'string?', rate_rule_id: 'uuid?', also_matched: 'ref:AlsoMatched[]?', tie: 'bool?' },
  RatePreview: { room_type_id: 'uuid', room_type: 'string', nights: 'ref:PreviewNight[]', total: 'number?', missing_rate_nights: 'date[]', ties: 'date[]?' },
  AuditRecord: { audit_id: 'int', created_at: 'datetime', full_name: 'string', action: 'string', entity_type: 'string', new_values: 'object?' },
  StaffUser: { user_id: 'uuid', full_name: 'string', email: 'string', phone: 'string?', role: E.role, can_approve_rates: 'bool', is_active: 'bool', last_login_at: 'datetime?', created_at: 'datetime' },
  Session: { session_id: 'uuid', created_at: 'datetime', last_seen_at: 'datetime', expires_at: 'datetime', user_agent: 'string?', current: 'bool' },
  Revoked: { revoked: 'int' },
  PasswordPolicy: { min_length: 'int', max_length: 'int', rules: 'string[]' },
  Role: { name: E.role },
  WebUser: { id: 'uuid', name: 'string', email: 'string', phone: 'string', role: 'enum:admin|manager|front_desk', status: 'enum:active|disabled', can_approve_rates: 'bool' },
  WebUserBox: { user: 'ref:WebUser?' },
  WebUserList: { users: 'ref:WebUser[]' },
  WebMessage: { message: 'string' },
  WebSetupState: { setupRequired: 'bool' },
};

// body field: [type, required?, note]
const f = (type, req, note) => ({ type, req: !!req, note: note || '' });
const guest = { full_name: f('string', 1, 'Required unless guest_id is sent.'), phone: f('string'), email: f('string'), nationality: f('string'), id_passport_no: f('string'), address: f('string') };

const endpoints = [
  // ---- sign in
  { m: 'POST', p: '/api/login', tag: 'Sign in', who: 'public', status: 'implemented', sum: 'Sign in with email and password. Returns a session token.', body: { email: f('string', 1), password: f('string', 1) }, ok: [200, 'LoginResponse'], err: ['VALIDATION_ERROR', 'INVALID_CREDENTIALS', 'ACCOUNT_DISABLED', 'ACCOUNT_LOCKED'] },
  { m: 'POST', p: '/api/logout', tag: 'Sign in', who: 'any', status: 'implemented', sum: 'End the current session.', ok: [200, 'Ok'], err: ['UNAUTHENTICATED', 'SESSION_REVOKED', 'SESSION_EXPIRED'] },
  { m: 'GET', p: '/api/me', tag: 'Sign in', who: 'any', status: 'implemented', sum: 'The signed-in user.', ok: [200, 'User'], err: ['UNAUTHENTICATED', 'SESSION_REVOKED', 'SESSION_EXPIRED'] },
  { m: 'GET', p: '/api/info', tag: 'Sign in', who: 'public', status: 'implemented', sum: 'Which database the server is using.', ok: [200, null] },
  { m: 'GET', p: '/api/sessions', tag: 'Sessions', who: 'any', status: 'implemented', sum: 'My active sessions (the current one is marked).', ok: [200, 'Session[]'] },
  { m: 'DELETE', p: '/api/sessions/{id}', tag: 'Sessions', who: 'any', status: 'implemented', sum: 'End one of my sessions.', ok: [200, 'Ok'], err: ['NOT_FOUND'] },
  { m: 'POST', p: '/api/sessions/revoke-others', tag: 'Sessions', who: 'any', status: 'implemented', sum: 'End all my sessions except this one.', ok: [200, 'Revoked'] },
  // ---- reference
  { m: 'GET', p: '/api/sources', tag: 'Reference data', who: 'any', status: 'implemented', sum: 'Booking sources (Walk-in, Phone, Email, Website, Travel agent, OTA).', ok: [200, 'Source[]'] },
  { m: 'GET', p: '/api/room-types', tag: 'Room types', perm: 'catalog.view', status: 'implemented', sum: 'Room types of my property. Front Desk sees APPROVED types only; Administrator and Manager also see PENDING ones.', ok: [200, 'RoomType[]'] },
  { m: 'GET', p: '/api/room-types/{id}', tag: 'Room types', perm: 'catalog.view', status: 'implemented', sum: 'One room type with its rates and rooms (Front Desk sees approved rates only).', ok: [200, 'RoomTypeDetail'], err: ['NOT_FOUND'] },
  { m: 'POST', p: '/api/room-types', tag: 'Room types', perm: 'catalog.manage', status: 'implemented', sum: 'S067: submit a room type together with its rates. Everything starts PENDING; the type cannot be sold until approved.',
    body: { category_id: f('uuid', 1), name: f('string', 1, '2 to 100 characters, unique in the category ignoring upper/lower case.'), max_guests: f('int', 1, '1 to 20.'), min_nights: f('int', 0, '1 to 365, default 1.'), description: f('string', 0, 'Up to 2000 characters.'),
      facilities: f('string[]', 0, 'Up to 40 names, each 1 to 60 characters; repeats are dropped.'), photos: f('ref:Photo[]', 0, 'Up to 20. Metadata only: url (http(s) or a path starting with /), caption, alt, sort_order.'), layout_info: f('string', 0, 'Up to 500 characters.'),
      rates: f('ref:RateInput[]', 0, 'If given, exactly one BASE rate is required. Same rules as POST /api/rates.') },
    ok: [201, 'RoomTypeSubmitted'], err: ['VALIDATION_ERROR', 'CONFLICT'] },
  { m: 'PATCH', p: '/api/room-types/{id}', tag: 'Room types', perm: 'catalog.manage', status: 'implemented', sum: 'Change room type details. Details take effect at once; only rates need approval.',
    body: { category_id: f('uuid'), name: f('string'), max_guests: f('int'), min_nights: f('int'), description: f('string'), facilities: f('string[]'), photos: f('ref:Photo[]'), layout_info: f('string') }, ok: [200, 'RoomType'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'CONFLICT'] },
  { m: 'POST', p: '/api/room-types/{id}/approve', tag: 'Room types', perm: 'rates.approve', status: 'implemented', sum: 'S067: approve a PENDING room type and its pending rates in one step. Needs a pending Base Rate.', ok: [200, 'RoomTypeApproved'], err: ['NOT_FOUND', 'INVALID_STATE'] },
  { m: 'DELETE', p: '/api/room-types/{id}', tag: 'Room types', perm: 'catalog.manage', status: 'implemented', sum: 'Withdraw a room type that is still PENDING and has no reservations (its rates and rooms go with it).', ok: [200, 'Ok'], err: ['NOT_FOUND', 'INVALID_STATE'] },
  { m: 'GET', p: '/api/room-categories', tag: 'Room categories', perm: 'catalog.view', status: 'implemented', sum: 'Room categories with the number of room types in each.', ok: [200, 'RoomCategory[]'] },
  { m: 'POST', p: '/api/room-categories', tag: 'Room categories', perm: 'catalog.manage', status: 'implemented', sum: 'S060: create a room category. The name must be unique ignoring upper/lower case.', body: { name: f('string', 1, '2 to 80 characters.') }, ok: [201, 'RoomCategory'], err: ['VALIDATION_ERROR', 'CONFLICT'] },
  { m: 'PATCH', p: '/api/room-categories/{id}', tag: 'Room categories', perm: 'catalog.manage', status: 'implemented', sum: 'Rename a room category.', body: { name: f('string', 1, '2 to 80 characters.') }, ok: [200, null], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'CONFLICT'] },
  { m: 'DELETE', p: '/api/room-categories/{id}', tag: 'Room categories', perm: 'catalog.manage', status: 'implemented', sum: 'Delete an empty room category.', ok: [200, 'Ok'], err: ['NOT_FOUND', 'INVALID_STATE'] },
  { m: 'GET', p: '/api/dashboard', tag: 'Reference data', perm: 'reports.operational', status: 'implemented', sum: "Today's arrivals and departures, in-house count, room occupancy and pending rates (pending_rates is null for Front Desk).", ok: [200, 'Dashboard'] },
  // ---- availability and reservations
  { m: 'GET', p: '/api/availability', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'Rooms left, nightly rates and total for a stay, per room type.',
    query: { from: f('date', 1, 'Check-in, not in the past.'), to: f('date', 1, 'Check-out, after from.'), guests: f('int', 0, 'Default 1.') }, ok: [200, 'AvailabilityItem[]'], err: ['VALIDATION_ERROR'] },
  { m: 'GET', p: '/api/calendar', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'Read-only room calendar for the Booking page: for each approved room type and each night, rooms left, total rooms and the nightly rate.',
    query: { from: f('date', 1, 'First night shown.'), days: f('int', 0, 'Number of nights, 1 to 62. Default 14.') }, ok: [200, 'Calendar'], err: ['VALIDATION_ERROR'] },
  { m: 'POST', p: '/api/reservations', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'Create a reservation (also creates its folio and one ROOM charge per night).',
    body: { guest: f('object', 0, 'New guest: ' + Object.keys(guest).join(', ') + '. full_name is required.'), guest_id: f('uuid', 0, 'Use an existing guest instead of guest.'), room_type_id: f('uuid', 1), check_in: f('date', 1), check_out: f('date', 1, 'Exclusive: the night of this date is not booked.'),
      total_guests: f('int', 1), source_id: f('int', 0, 'From GET /api/sources. Default 1.'), estimated_arrival: f('time'), special_requests: f('string'), notes: f('string') },
    ok: [201, 'ReservationCreated'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'SOLD_OUT', 'NO_STOCK', 'NO_APPROVED_RATE'] },
  { m: 'GET', p: '/api/reservations', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'List reservations (newest check-in first, at most 200).',
    query: { status: f('enum:CONFIRMED|CHECKED_IN|CHECKED_OUT|CANCELLED'), q: f('string', 0, 'Matches reference or guest name.') }, ok: [200, 'ReservationRow[]'], err: ['VALIDATION_ERROR'] },
  { m: 'GET', p: '/api/reservations/{id}', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'One reservation with its folio: charges, payments and balance.', ok: [200, 'ReservationDetail'], err: ['NOT_FOUND'] },
  { m: 'PATCH', p: '/api/reservations/{id}', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'Edit guest contact details, notes, requests or arrival time.',
    body: { full_name: f('string'), phone: f('string'), email: f('string'), special_requests: f('string'), notes: f('string'), estimated_arrival: f('time') }, ok: [200, 'ReservationDetail'], err: ['NOT_FOUND', 'INVALID_STATE'] },
  { m: 'POST', p: '/api/reservations/{id}/cancel', tag: 'Reservations', perm: 'reservations.manage', status: 'implemented', sum: 'Cancel a CONFIRMED reservation and release its stock.', ok: [200, 'ReservationDetail'], err: ['NOT_FOUND', 'INVALID_STATE'] },
  { m: 'GET', p: '/api/reservations/{id}/free-rooms', tag: 'Stay', perm: 'stay.operate', status: 'implemented', sum: 'Rooms of the booked type that are free for the stay.', ok: [200, 'FreeRoom[]'], err: ['NOT_FOUND'] },
  { m: 'POST', p: '/api/reservations/{id}/assign-room', tag: 'Stay', perm: 'stay.operate', status: 'implemented', sum: 'Assign a physical room.', body: { room_id: f('uuid', 1) }, ok: [200, 'ReservationDetail'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE', 'ROOM_NOT_AVAILABLE'] },
  { m: 'POST', p: '/api/reservations/{id}/check-in', tag: 'Stay', perm: 'stay.operate', status: 'implemented', sum: 'Check in. Uses the assigned room or picks a free Available one. The room becomes OCCUPIED.', ok: [200, 'ReservationDetail'], err: ['NOT_FOUND', 'INVALID_STATE', 'ROOM_NOT_AVAILABLE'] },
  { m: 'POST', p: '/api/reservations/{id}/check-out', tag: 'Stay', perm: 'stay.operate', status: 'implemented', sum: 'Check out. Needs a zero balance. The room becomes CLEANING and the folio closes.', ok: [200, 'ReservationDetail'], err: ['NOT_FOUND', 'INVALID_STATE', 'BALANCE_OUTSTANDING'] },
  // ---- folio
  { m: 'POST', p: '/api/reservations/{id}/charges', tag: 'Folio', perm: 'folio.manage', status: 'implemented', sum: 'Post a charge to the folio: an additional charge, or an approved add-on (S069). An add-on charge records the approved price of that moment; later price changes never alter it.',
    body: { description: f('string', 0, 'Up to 200 characters. Required unless add_on_id is sent (then the add-on name is used).'), quantity: f('number', 0, 'Greater than 0. Default 1; for an add-on: 1 per stay, nights per night, guests per guest.'), unit_price: f('number', 0, '0 or more. Required without add_on_id; not allowed with it.'), add_on_id: f('uuid', 0, 'An approved, active add-on.') },
    ok: [201, 'ReservationDetail'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'FOLIO_CLOSED', 'INVALID_STATE'] },
  { m: 'POST', p: '/api/reservations/{id}/payments', tag: 'Folio', perm: 'folio.manage', status: 'implemented', sum: 'Record a payment. Cannot be more than the balance. Updates payment_status.',
    body: { amount: f('number', 1, 'Greater than 0.'), method: f(E.method, 1) }, ok: [201, 'ReservationDetail'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE'] },
  // ---- rooms
  { m: 'GET', p: '/api/rooms', tag: 'Rooms', perm: 'catalog.view', status: 'implemented', sum: 'All rooms of my property with their floor and status.', ok: [200, 'Room[]'] },
  { m: 'POST', p: '/api/rooms', tag: 'Rooms', perm: 'catalog.manage', status: 'implemented', sum: 'S062: add a physical room. The room number is unique ignoring upper/lower case.',
    body: { room_type_id: f('uuid', 1), room_number: f('string', 1, '1 to 10 letters, digits or hyphens.'), floor: f('int', 0, '-5 to 200.') }, ok: [201, 'RoomCreated'], err: ['VALIDATION_ERROR', 'CONFLICT'] },
  { m: 'PATCH', p: '/api/rooms/{id}', tag: 'Rooms', perm: 'catalog.manage', status: 'implemented', sum: 'Change a room number, floor or room type. The type cannot change while the room is assigned to a confirmed or in-house reservation.',
    body: { room_number: f('string'), floor: f('int', 0, 'null removes the floor.'), room_type_id: f('uuid') }, ok: [200, 'RoomUpdated'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'CONFLICT', 'INVALID_STATE'] },
  { m: 'DELETE', p: '/api/rooms/{id}', tag: 'Rooms', perm: 'catalog.manage', status: 'implemented', sum: 'Delete a room that has never been used for a stay.', ok: [200, 'Ok'], err: ['NOT_FOUND', 'INVALID_STATE'] },
  { m: 'PATCH', p: '/api/rooms/{id}/status', tag: 'Rooms', perm: 'stay.operate', status: 'implemented', sum: 'Change a room status. OCCUPIED is set by check-in only.', body: { status: f('enum:AVAILABLE|CLEANING|MAINTENANCE_BLOCKED', 1) }, ok: [200, 'Ok'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE'] },
  // ---- rates
  { m: 'GET', p: '/api/rates', tag: 'Rates', perm: 'rates.view_approved', status: 'implemented', sum: 'Rate rules. Front Desk sees APPROVED only; Administrator and Manager see all.', ok: [200, 'Rate[]'] },
  { m: 'POST', p: '/api/rates', tag: 'Rates', perm: 'rates.manage', status: 'implemented', sum: 'Create a rate rule. It starts as PENDING and has no effect until approved.',
    body: { room_type_id: f('uuid', 1), rule_type: f(E.rule, 1), rate_amount: f('number', 1, 'More than 0, at most 9,999,999.99, up to 2 decimals.'), currency_code: f('string', 0, 'If sent, must be the property currency.'), date_from: f('date', 0, 'DATE_RANGE only (required there).'), date_to: f('date', 0, 'DATE_RANGE only (required there, on or after date_from, at most 366 days).'),
      selected_days: f('int[]', 0, 'SELECTED_DAY only (required there): 0 = Sunday to 6 = Saturday, each once.'), specific_date: f('date', 0, 'SPECIFIC_DATE only (required there).'), priority: f('int', 0, '0 to 100. Higher wins (FR-17 is still to be confirmed).') },
    ok: [201, 'RateCreated'], err: ['VALIDATION_ERROR', 'NOT_FOUND'] },
  { m: 'POST', p: '/api/rates/{id}/approve', tag: 'Rates', perm: 'rates.approve', status: 'implemented', sum: 'Approve a PENDING rate. Administrator, or a Manager whose can_approve_rates is true. Approving a change (S068) ends the rate it replaces from its effective date.', ok: [200, 'Ok'], err: ['NOT_FOUND', 'INVALID_STATE', 'BASE_RATE_EXISTS'] },
  { m: 'POST', p: '/api/rates/{id}/revise', tag: 'Rates', perm: 'rates.manage', status: 'implemented', sum: 'S068: change an approved rate. The new rate waits as PENDING; the approved rate stays in force until the change is approved and its effective date arrives.',
    body: { rate_amount: f('number', 1, 'The new rate, different from the current one.'), effective_from: f('date', 0, 'First night of the new rate, today or later. Default: the day it is approved.'), priority: f('int', 0, '0 to 100.'), currency_code: f('string', 0, 'If sent, must be the property currency.') },
    ok: [201, 'RateRevisionCreated'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'INVALID_STATE'] },
  { m: 'DELETE', p: '/api/rates/{id}', tag: 'Rates', perm: 'rates.manage', status: 'implemented', sum: 'Withdraw a PENDING rate or change. An approved rate cannot be deleted.', ok: [200, 'Ok'], err: ['NOT_FOUND', 'INVALID_STATE'] },
  { m: 'GET', p: '/api/rates/preview', tag: 'Rates', perm: 'rates.view_approved', status: 'implemented', sum: 'S066: nightly price for a stay (check-out night not counted), using approved rates only. Administrator and Manager also see the other rules that matched each night and nights that tie.',
    query: { room_type_id: f('uuid', 1), from: f('date', 1), to: f('date', 1, 'After from, at most 90 nights.') }, ok: [200, 'RatePreview'], err: ['VALIDATION_ERROR', 'NOT_FOUND'] },
  // ---- add-ons (S069)
  { m: 'GET', p: '/api/add-ons', tag: 'Add-ons', perm: 'catalog.view', status: 'implemented', sum: 'Add-ons. Front Desk sees approved, active add-ons only; Administrator and Manager see all, with any pending new price.', ok: [200, 'AddOn[]'] },
  { m: 'POST', p: '/api/add-ons', tag: 'Add-ons', perm: 'rates.manage', status: 'implemented', sum: 'Create an add-on. It starts PENDING and cannot be charged until approved.',
    body: { name: f('string', 1, '2 to 80 characters, unique ignoring upper/lower case.'), description: f('string', 0, 'Up to 300 characters.'), pricing_unit: f('enum:PER_STAY|PER_NIGHT|PER_GUEST', 0, 'Default PER_STAY.'), unit_price: f('number', 1, '0 to 9,999,999.99, up to 2 decimals.'), is_active: f('bool') }, ok: [201, 'AddOn'], err: ['VALIDATION_ERROR', 'CONFLICT'] },
  { m: 'PATCH', p: '/api/add-ons/{id}', tag: 'Add-ons', perm: 'rates.manage', status: 'implemented', sum: 'Change an add-on. On an approved add-on a new unit_price waits as pending_unit_price; the approved price stays until it is approved.',
    body: { name: f('string'), description: f('string'), pricing_unit: f('enum:PER_STAY|PER_NIGHT|PER_GUEST', 0, 'Only while PENDING.'), unit_price: f('number'), is_active: f('bool') }, ok: [200, 'AddOn'], err: ['VALIDATION_ERROR', 'NOT_FOUND', 'CONFLICT'] },
  { m: 'POST', p: '/api/add-ons/{id}/approve', tag: 'Add-ons', perm: 'rates.approve', status: 'implemented', sum: 'Approve a new add-on, or its pending new price. Independent of room type approval.', ok: [200, 'AddOn'], err: ['NOT_FOUND', 'INVALID_STATE'] },
  { m: 'DELETE', p: '/api/add-ons/{id}', tag: 'Add-ons', perm: 'rates.manage', status: 'implemented', sum: 'Withdraw an add-on that is still PENDING. An approved add-on is switched off with is_active=false.', ok: [200, 'Ok'], err: ['NOT_FOUND', 'INVALID_STATE'] },
  // ---- audit
  { m: 'GET', p: '/api/audit', tag: 'Audit', perm: 'audit.view', status: 'implemented', sum: 'Latest 100 audit records of my property.', ok: [200, 'AuditRecord[]'] },
  // ---- planned: staff accounts and passwords
  { m: 'GET', p: '/api/password-policy', tag: 'Staff accounts', who: 'public', status: 'implemented', sum: 'The password rules, so a form can show them.', ok: [200, 'PasswordPolicy'] },
  { m: 'POST', p: '/api/me/password', tag: 'Staff accounts', who: 'any', status: 'implemented', sum: 'Change my password. Ends my other sessions.', body: { current_password: f('string', 1), new_password: f('string', 1, 'Must meet the password rules.') }, ok: [200, 'Ok'], err: ['VALIDATION_ERROR'] },
  { m: 'GET', p: '/api/roles', tag: 'Staff accounts', perm: 'users.view', status: 'implemented', sum: 'The three roles.', ok: [200, 'Role[]'] },
  { m: 'GET', p: '/api/users', tag: 'Staff accounts', perm: 'users.view', status: 'implemented', sum: 'Staff accounts of my property.', ok: [200, 'StaffUser[]'] },
  { m: 'POST', p: '/api/users', tag: 'Staff accounts', perm: 'users.manage_frontdesk', status: 'implemented', sum: 'Create a staff account. Administrator: any role. Manager: Front Desk accounts only.',
    body: { full_name: f('string', 1, '2 to 120 characters.'), email: f('string', 1, 'Unique, ignoring upper/lower case.'), phone: f('string', 0, 'Up to 30 characters.'), role: f(E.role, 1), password: f('string', 1, 'Must meet the password rules.'), can_approve_rates: f('bool', 0, 'Administrator only; Owner/Manager accounts only.') },
    ok: [201, 'StaffUser'], err: ['VALIDATION_ERROR', 'FORBIDDEN', 'CONFLICT'] },
  { m: 'PATCH', p: '/api/users/{id}', tag: 'Staff accounts', perm: 'users.manage_frontdesk', status: 'implemented', sum: 'Edit an account. A Manager may only edit full_name and is_active of Front Desk accounts. Deactivating or changing a role ends that user\'s sessions.',
    body: { full_name: f('string'), phone: f('string', 0, 'Up to 30 characters; empty text removes it.'), role: f(E.role, 0, 'Administrator only.'), can_approve_rates: f('bool', 0, 'Administrator only.'), is_active: f('bool') }, ok: [200, 'StaffUser'], err: ['VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_STATE'] },
  { m: 'POST', p: '/api/users/{id}/reset-password', tag: 'Staff accounts', perm: 'users.manage_frontdesk', status: 'implemented', sum: 'Set a new password for an account (also unlocks it) and end its sessions.', body: { new_password: f('string', 1) }, ok: [200, 'Ok'], err: ['VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND'] },
  { m: 'POST', p: '/api/users/{id}/revoke-sessions', tag: 'Staff accounts', perm: 'users.manage_frontdesk', status: 'implemented', sum: 'End every session of an account.', ok: [200, 'Revoked'], err: ['FORBIDDEN', 'NOT_FOUND'] },
  // ---- for the FDS web app (apps/fds-web): cookie sign-in; role names admin / manager / front_desk; errors as { error: "text" } (section 4a)
  { m: 'POST', p: '/api/auth/login', tag: 'Web app (apps/fds-web)', who: 'public', status: 'implemented', sum: 'Sign in. Sets the HttpOnly session cookie; the token is not in the body.',
    body: { email: f('string', 1), password: f('string', 1) }, ok: [200, 'WebUserBox'], err: ['VALIDATION_ERROR', 'INVALID_CREDENTIALS', 'ACCOUNT_LOCKED', 'ACCOUNT_DISABLED'] },
  { m: 'GET', p: '/api/auth/session', tag: 'Web app (apps/fds-web)', who: 'public', status: 'implemented', sum: 'Who is signed in. Answers { "user": null } (200) when nobody is, or the session ended.', ok: [200, 'WebUserBox'] },
  { m: 'POST', p: '/api/auth/logout', tag: 'Web app (apps/fds-web)', who: 'public', status: 'implemented', sum: 'End this session and clear the cookie.', ok: [200, 'WebMessage'] },
  { m: 'GET', p: '/api/auth/setup', tag: 'Web app (apps/fds-web)', who: 'public', status: 'implemented', sum: 'True only while the database has no user at all.', ok: [200, 'WebSetupState'] },
  { m: 'POST', p: '/api/auth/setup', tag: 'Web app (apps/fds-web)', who: 'public', status: 'implemented', sum: 'Create the first Administrator. Refused (409) once any user exists.',
    body: { name: f('string', 1), email: f('string', 1), phone: f('string'), password: f('string', 1, 'Must meet the password rules.'), confirm: f('string', 0, 'Must equal password.') }, ok: [201, 'WebMessage'], err: ['VALIDATION_ERROR', 'CONFLICT'] },
  { m: 'GET', p: '/api/staff', tag: 'Web app (apps/fds-web)', perm: 'users.view', status: 'implemented', sum: 'Staff accounts of my property, in the web app format. Same rules as GET /api/users.', ok: [200, 'WebUserList'] },
  { m: 'POST', p: '/api/staff', tag: 'Web app (apps/fds-web)', perm: 'users.manage_frontdesk', status: 'implemented', sum: 'Create a staff account. Same rules as POST /api/users.',
    body: { name: f('string', 1), email: f('string', 1), phone: f('string'), role: f('enum:admin|manager|front_desk', 1), password: f('string', 1, 'Must meet the password rules.') }, ok: [201, 'WebUserBox'], err: ['VALIDATION_ERROR', 'FORBIDDEN', 'CONFLICT'] },
  { m: 'PATCH', p: '/api/staff/{id}', tag: 'Web app (apps/fds-web)', perm: 'users.manage_frontdesk', status: 'implemented', sum: 'Edit an account. Same rules as PATCH /api/users/{id}. status "pending" and a changed email are refused.',
    body: { name: f('string'), email: f('string', 0, 'Must equal the current email.'), phone: f('string'), role: f('enum:admin|manager|front_desk'), status: f('enum:active|disabled') }, ok: [200, 'WebUserBox'], err: ['VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_STATE'] },
];

// who may call: derived from the permission matrix so the contract cannot drift from the code
function rolesOf(e) {
  if (e.who === 'public') return 'Public';
  if (e.who === 'any') return 'Any signed-in user';
  const roles = P.MATRIX[e.perm].map(r => ({ ADMINISTRATOR: 'Administrator', OWNER_MANAGER: 'Manager', FRONT_DESK: 'Front Desk' }[r]));
  const all = roles.length === 3;
  let s = all ? 'All roles' : roles.join(', ');
  if (e.perm === 'rates.approve') s = 'Administrator; Manager only if can_approve_rates';
  if (e.perm === 'users.manage_frontdesk') s = 'Administrator (any role); Manager (Front Desk accounts only)';
  return s;
}
module.exports = { schemas, endpoints, rolesOf, E };
