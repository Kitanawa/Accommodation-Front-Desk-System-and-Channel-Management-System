-- FAKE DATA ONLY. No real guests, agents or prices.
USE frontdesk_ai;

INSERT INTO room_types (id, name, description, max_guests, base_rate) VALUES
 (1, 'Single',  'One single bed',        1,  90.00),
 (2, 'Double',  'One double bed',        2, 150.00),
 (3, 'Deluxe',  'Larger room with view', 3, 250.00),
 (4, 'Suite',   'Suite with living area',4, 400.00);

-- 20 rooms in total (matches the client's schematic: 20 rooms)
INSERT INTO rooms (room_number, room_type_id, status) VALUES
 ('1001',1,'occupied'),('1002',1,'available'),('1003',1,'available'),
 ('1004',1,'available'),('1005',1,'available'),('1006',1,'available'),
 ('1007',2,'available'),('1008',2,'available'),('1009',2,'available'),
 ('1010',2,'available'),('1101',2,'available'),('1102',2,'available'),
 ('1103',3,'available'),('1104',3,'available'),('1105',3,'maintenance'),
 ('1106',3,'cleaning'),  ('1107',3,'available'),
 ('1108',4,'available'),('1109',4,'available'),('1110',4,'available');

-- Seasonal rates (RM per night)
INSERT INTO rates (room_type_id, start_date, end_date, rate, label) VALUES
 (1, '2026-11-20', '2026-11-30', 110.00, 'School holiday'),
 (2, '2026-11-20', '2026-11-30', 170.00, 'School holiday'),
 (3, '2026-11-20', '2026-11-30', 280.00, 'School holiday'),
 (4, '2026-11-20', '2026-11-30', 450.00, 'School holiday'),
 (1, '2026-12-20', '2027-01-03',  120.00, 'Year-end peak'),
 (2, '2026-12-20', '2027-01-03',  200.00, 'Year-end peak'),
 (3, '2026-12-20', '2027-01-03',  330.00, 'Year-end peak'),
 (4, '2026-12-20', '2027-01-03',  520.00, 'Year-end peak');

INSERT INTO guests (id, full_name, phone, email) VALUES
 (1,'Mr. Chong',        '012-000 0001','chong@example.com'),
 (2,'Aisyah Rahman',    '012-000 0002','aisyah@example.com'),
 (3,'Daniel Wong',      '012-000 0003','daniel@example.com'),
 (4,'Siti Nurhaliza',   '012-000 0004','siti@example.com'),
 (5,'Kevin Lim',        '012-000 0005','kevin@example.com'),
 (6,'Mei Ling Tan',     '012-000 0006','meiling@example.com'),
 (7,'Ravi Kumar',       '012-000 0007','ravi@example.com'),
 (8,'Grace Ong',        '012-000 0008','grace@example.com'),
 (9,'Ahmad Faiz',       '012-000 0009','faiz@example.com'),
 (10,'Linda Chua',      '012-000 0010','linda@example.com'),
 (11,'Peter Ngu',       '012-000 0011','peter@example.com'),
 (12,'Farah Aziz',      '012-000 0012','farah@example.com');

INSERT INTO travel_agents (id, name, contact_email) VALUES
 (1,'Borneo Trails Travel','agent1@example.com'),
 (2,'Sunrise Tours',       'agent2@example.com'),
 (3,'Kuching Getaways',    'agent3@example.com');

-- Bookings. "blocked" = reserved (still cancellable free until 72h before check-in).
-- Dates are chosen so the prototype has interesting cases around late Oct, late Nov, and year-end.
INSERT INTO bookings
 (booking_ref, guest_id, travel_agent_id, room_type_id, room_id, check_in, check_out, num_guests, source, status, payment_status, total_amount, confirmed_at, cancelled_at)
VALUES
 -- Singles
 ('BK-0001', 1,    NULL, 1, 1,    '2026-10-03','2026-10-06',1,'walk_in',       'checked_in','paid',  270.00,'2026-10-03 14:00:00',NULL),
 ('BK-0002', NULL, 1,    1, NULL, '2026-10-06','2026-10-09',1,'travel_agent',  'blocked',   'unpaid',270.00,NULL,NULL),
 ('BK-0003', 2,    NULL, 1, NULL, '2026-10-25','2026-10-28',1,'phone',         'confirmed', 'paid',  270.00,'2026-09-20 10:00:00',NULL),
 ('BK-0004', NULL, 2,    1, NULL, '2026-10-26','2026-10-30',1,'travel_agent',  'blocked',   'unpaid',360.00,NULL,NULL),
 ('BK-0005', 3,    NULL, 1, NULL, '2026-11-23','2026-11-27',1,'email',         'confirmed', 'unpaid',440.00,'2026-09-28 09:30:00',NULL),
 ('BK-0006', NULL, 1,    1, NULL, '2026-11-24','2026-11-28',1,'travel_agent',  'blocked',   'unpaid',440.00,NULL,NULL),
 ('BK-0007', 4,    NULL, 1, NULL, '2026-11-25','2026-11-26',1,'whatsapp',      'cancelled', 'unpaid',110.00,NULL,'2026-10-01 11:00:00'),
 ('BK-0008', NULL, 3,    1, NULL, '2026-11-26','2026-11-29',1,'travel_agent',  'blocked',   'unpaid',330.00,NULL,NULL),
 -- Doubles
 ('BK-0009', 5,    NULL, 2, NULL, '2026-10-24','2026-10-27',2,'direct_website','confirmed', 'paid',  450.00,'2026-09-15 16:00:00',NULL),
 ('BK-0010', NULL, 1,    2, NULL, '2026-11-20','2026-11-25',2,'travel_agent',  'blocked',   'unpaid',850.00,NULL,NULL),
 ('BK-0011', 6,    NULL, 2, NULL, '2026-11-22','2026-11-24',2,'phone',         'confirmed', 'paid',  340.00,'2026-09-30 13:00:00',NULL),
 ('BK-0012', 7,    NULL, 2, NULL, '2026-12-24','2026-12-28',2,'direct_website','confirmed', 'unpaid',800.00,'2026-09-29 12:00:00',NULL),
 -- Deluxe (note: room 1105 is under maintenance, so only 4 are bookable)
 ('BK-0013', 8,    NULL, 3, NULL, '2026-10-25','2026-10-27',2,'ota',           'confirmed', 'paid',  500.00,'2026-09-18 08:00:00',NULL),
 ('BK-0014', NULL, 2,    3, NULL, '2026-11-25','2026-11-30',2,'travel_agent',  'blocked',   'unpaid',1400.00,NULL,NULL),
 ('BK-0015', 9,    NULL, 3, NULL, '2026-11-26','2026-11-29',3,'email',         'confirmed', 'unpaid',840.00,'2026-09-27 15:00:00',NULL),
 ('BK-0016', 10,   NULL, 3, NULL, '2026-12-24','2026-12-27',2,'whatsapp',      'confirmed', 'paid',  990.00,'2026-09-26 10:30:00',NULL),
 -- Suites
 ('BK-0017', 11,   NULL, 4, NULL, '2026-11-25','2026-11-28',4,'phone',         'confirmed', 'paid', 1350.00,'2026-09-24 11:30:00',NULL),
 ('BK-0018', NULL, 3,    4, NULL, '2026-12-20','2026-12-27',4,'travel_agent',  'blocked',   'unpaid',3640.00,NULL,NULL),
 ('BK-0019', 12,   NULL, 4, NULL, '2026-11-27','2026-11-30',3,'direct_website','confirmed', 'unpaid',1350.00,'2026-09-25 14:15:00',NULL);
