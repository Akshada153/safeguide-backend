const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireRole('tourist'), async (req, res) => {
  const tourist_id = req.user.id;
  const { tour_id, booking_date, start_time } = req.body;

  if (!tour_id || !booking_date || !start_time) {
    return res.status(400).json({ error: 'tour_id, booking_date, and start_time are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tourResult = await client.query(
      `SELECT guide_id FROM tours WHERE id = $1 AND is_active = true`,
      [tour_id]
    );
    if (tourResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tour not found' });
    }
    const guide_id = tourResult.rows[0].guide_id;

    // THE CONFLICT GUARD
    // Lock any existing rows for this guide/date/time before checking them.
    // If two requests arrive at the same moment, one will wait here until
    // the other finishes — preventing both from thinking the slot is free.
    await client.query(
      `SELECT id FROM bookings
       WHERE guide_id = $1 AND booking_date = $2 AND start_time = $3
       AND status IN ('pending', 'confirmed')
       FOR UPDATE`,
      [guide_id, booking_date, start_time]
    );

    // Now check if any conflicting booking actually exists
    const conflict = await client.query(
      `SELECT id, status FROM bookings
       WHERE guide_id = $1 AND booking_date = $2 AND start_time = $3
       AND status IN ('pending', 'confirmed')`,
      [guide_id, booking_date, start_time]
    );

    if (conflict.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'This slot is already booked or has a pending request',
        existing_status: conflict.rows[0].status
      });
    }

    const result = await client.query(
      `INSERT INTO bookings (tourist_id, guide_id, tour_id, booking_date, start_time, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [tourist_id, guide_id, tour_id, booking_date, start_time]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23514') {
      return res.status(400).json({ error: 'You cannot book your own tour' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create booking' });
  } finally {
    client.release();
  }
});
// Tourist sees their own bookings
router.get('/my', authenticate, requireRole('tourist'), async (req, res) => {
  const tourist_id = req.user.id;
  try {
    const result = await pool.query(
      `SELECT b.id, b.booking_date, b.start_time, b.status,
              t.title AS tour_title,
              u.full_name AS guide_name
       FROM bookings b
       JOIN tours t ON t.id = b.tour_id
       JOIN users u ON u.id = b.guide_id
       WHERE b.tourist_id = $1
       ORDER BY b.created_at DESC`,
      [tourist_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch bookings' });
  }
});

module.exports = router;