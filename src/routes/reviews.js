const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireRole('tourist'), async (req, res) => {
  const tourist_id = req.user.id;
  const { booking_id, rating, comment } = req.body;

  if (!booking_id || !rating) {
    return res.status(400).json({ error: 'booking_id and rating are required' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be between 1 and 5' });
  }

  try {
    const bookingResult = await pool.query(
      `SELECT id, guide_id, status FROM bookings
       WHERE id = $1 AND tourist_id = $2`,
      [booking_id, tourist_id]
    );

    if (bookingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    if (booking.status !== 'completed') {
      return res.status(403).json({
        error: `Cannot review a booking with status '${booking.status}' — must be completed`
      });
    }

    const result = await pool.query(
      `INSERT INTO reviews (booking_id, tourist_id, guide_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [booking_id, tourist_id, booking.guide_id, rating, comment || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'You have already reviewed this booking' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create review' });
  }
});

router.get('/guide/:guideId', async (req, res) => {
  const { guideId } = req.params;
  try {
    const result = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name AS tourist_name
       FROM reviews r
       JOIN users u ON u.id = r.tourist_id
       WHERE r.guide_id = $1
       ORDER BY r.created_at DESC`,
      [guideId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch reviews' });
  }
});

module.exports = router;
