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

    await client.query(
      `SELECT id FROM bookings
       WHERE guide_id = $1 AND booking_date = $2 AND start_time = $3
       AND status IN ('pending', 'confirmed')
       FOR UPDATE`,
      [guide_id, booking_date, start_time]
    );

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

router.get('/guide', authenticate, requireRole('guide'), async (req, res) => {
  const guide_id = req.user.id;
  try {
    const result = await pool.query(
      `SELECT b.id, b.booking_date, b.start_time, b.status,
              t.title AS tour_title,
              u.full_name AS tourist_name
       FROM bookings b
       JOIN tours t ON t.id = b.tour_id
       JOIN users u ON u.id = b.tourist_id
       WHERE b.guide_id = $1
       ORDER BY b.created_at DESC`,
      [guide_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch bookings' });
  }
});

router.patch('/:id/confirm', authenticate, requireRole('guide'), async (req, res) => {
  const { id } = req.params;
  const guide_id = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT * FROM bookings WHERE id = $1 AND guide_id = $2 FOR UPDATE`,
      [id, guide_id]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];
    if (booking.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Cannot confirm a booking with status '${booking.status}'` });
    }

    const updated = await client.query(
      `UPDATE bookings
       SET status = 'confirmed', confirmed_at = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Guide already has a confirmed booking for this slot' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not confirm booking' });
  } finally {
    client.release();
  }
});

router.patch('/:id/decline', authenticate, requireRole('guide'), async (req, res) => {
  const { id } = req.params;
  const guide_id = req.user.id;

  try {
    const result = await pool.query(
      `UPDATE bookings
       SET status = 'declined'
       WHERE id = $1 AND guide_id = $2 AND status = 'pending'
       RETURNING *`,
      [id, guide_id]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'Booking not found, not yours, or not in pending status' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not decline booking' });
  }
});

router.patch('/:id/complete', authenticate, requireRole('guide'), async (req, res) => {
  const { id } = req.params;
  const guide_id = req.user.id;

  try {
    const result = await pool.query(
      `UPDATE bookings
       SET status = 'completed', completed_at = now()
       WHERE id = $1 AND guide_id = $2 AND status = 'confirmed'
       RETURNING *`,
      [id, guide_id]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ error: 'Booking not found, not yours, or not in confirmed status' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not complete booking' });
  }
});

module.exports = router;
