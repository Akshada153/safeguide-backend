const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Guide creates a new tour under their own profile
router.post('/', authenticate, requireRole('guide'), async (req, res) => {
  const guide_id = req.user.id;
  const { title, description, duration_minutes, price_cents } = req.body;

  if (!title || !duration_minutes || price_cents === undefined) {
    return res.status(400).json({ error: 'title, duration_minutes, and price_cents are required' });
  }
  if (duration_minutes <= 0) {
    return res.status(400).json({ error: 'duration_minutes must be greater than 0' });
  }
  if (price_cents < 0) {
    return res.status(400).json({ error: 'price_cents must be >= 0' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO tours (guide_id, title, description, duration_minutes, price_cents)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [guide_id, title, description || null, duration_minutes, price_cents]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') {
      // foreign_key_violation - guide_id doesn't exist in guides table
      return res.status(400).json({ error: 'You must create a guide profile before adding tours' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create tour' });
  }
});

// Guide updates one of their own tours
router.put('/:id', authenticate, requireRole('guide'), async (req, res) => {
  const { id } = req.params;
  const guide_id = req.user.id;
  const { title, description, duration_minutes, price_cents, is_active } = req.body;

  try {
    const result = await pool.query(
      `UPDATE tours
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           duration_minutes = COALESCE($3, duration_minutes),
           price_cents = COALESCE($4, price_cents),
           is_active = COALESCE($5, is_active)
       WHERE id = $6 AND guide_id = $7
       RETURNING *`,
      [title, description, duration_minutes, price_cents, is_active, id, guide_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Tour not found or not owned by you' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update tour' });
  }
});

module.exports = router;