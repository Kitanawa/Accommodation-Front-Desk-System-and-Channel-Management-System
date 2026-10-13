-- Core read-only queries the AI's tools will call. The model never writes SQL:
-- the backend runs these with validated parameters.
USE frontdesk_ai;

-- ---------------------------------------------------------------
-- Q1. Availability + price by room type for a stay.
--     Parameters: @from (check-in), @to (check-out, exclusive).
--     rooms_left_all_nights = the tightest night in the range, which is
--     the number the front desk can actually promise.
--     Rooms in 'maintenance' are excluded from inventory.
-- ---------------------------------------------------------------
SET @from = '2026-11-25', @to = '2026-11-30';

WITH RECURSIVE nights (night) AS (
  SELECT CAST(@from AS DATE)
  UNION ALL
  SELECT night + INTERVAL 1 DAY FROM nights WHERE night + INTERVAL 1 DAY < @to
),
totals AS (
  SELECT room_type_id, COUNT(*) AS total_rooms
  FROM rooms WHERE status <> 'maintenance' GROUP BY room_type_id
),
per_night AS (
  SELECT rt.id AS room_type_id, rt.name, n.night, t.total_rooms,
         t.total_rooms - COUNT(b.id) AS rooms_left,
         COALESCE((SELECT r.rate FROM rates r
                   WHERE r.room_type_id = rt.id
                     AND n.night BETWEEN r.start_date AND r.end_date
                   ORDER BY r.id DESC LIMIT 1), rt.base_rate) AS nightly_rate
  FROM room_types rt
  JOIN totals t ON t.room_type_id = rt.id
  CROSS JOIN nights n
  LEFT JOIN bookings b
         ON b.room_type_id = rt.id
        AND b.status IN ('blocked','confirmed','checked_in')
        AND b.check_in <= n.night AND b.check_out > n.night
  GROUP BY rt.id, rt.name, n.night, t.total_rooms, rt.base_rate
)
SELECT room_type_id, name AS room_type,
       MIN(rooms_left)            AS rooms_left_all_nights,
       MIN(rooms_left) > 0        AS is_available,
       ROUND(AVG(nightly_rate),2) AS avg_nightly_rate,
       SUM(nightly_rate)          AS total_price
FROM per_night
GROUP BY room_type_id, name
ORDER BY room_type_id;

-- ---------------------------------------------------------------
-- Q2. Blocked bookings that have passed the 72-hour point and should be
--     confirmed (a scheduled backend job does this, NOT the AI).
--     Assumption to confirm with the client: check-in counted from 00:00
--     of the check-in date.
-- ---------------------------------------------------------------
SET @as_of = '2026-10-04 09:00:00';

SELECT booking_ref, travel_agent_id, room_type_id, check_in, check_out,
       TIMESTAMPDIFF(HOUR, @as_of, CAST(check_in AS DATETIME)) AS hours_to_check_in
FROM bookings
WHERE status = 'blocked'
  AND TIMESTAMPDIFF(HOUR, @as_of, CAST(check_in AS DATETIME)) <= 72;

-- ---------------------------------------------------------------
-- Q3. Blocked bookings that can still be cancelled free (more than 72h left).
-- ---------------------------------------------------------------
SELECT booking_ref, travel_agent_id, check_in,
       TIMESTAMPDIFF(HOUR, @as_of, CAST(check_in AS DATETIME)) AS hours_left_to_cancel
FROM bookings
WHERE status = 'blocked'
  AND TIMESTAMPDIFF(HOUR, @as_of, CAST(check_in AS DATETIME)) > 72
ORDER BY check_in;

-- ---------------------------------------------------------------
-- Q4. Unpaid bookings (confirmed or in-house).
-- ---------------------------------------------------------------
SELECT b.booking_ref, COALESCE(g.full_name, ta.name) AS booked_by,
       b.check_in, b.check_out, b.status, b.total_amount
FROM bookings b
LEFT JOIN guests g         ON g.id  = b.guest_id
LEFT JOIN travel_agents ta ON ta.id = b.travel_agent_id
WHERE b.payment_status = 'unpaid' AND b.status IN ('confirmed','checked_in')
ORDER BY b.check_in;

-- ---------------------------------------------------------------
-- Q5. Booking lookup by guest name.
-- ---------------------------------------------------------------
SELECT b.booking_ref, g.full_name, rt.name AS room_type, rm.room_number,
       b.check_in, b.check_out, b.status, b.payment_status
FROM bookings b
JOIN guests g       ON g.id = b.guest_id
JOIN room_types rt  ON rt.id = b.room_type_id
LEFT JOIN rooms rm  ON rm.id = b.room_id
WHERE g.full_name LIKE CONCAT('%', 'Chong', '%');
