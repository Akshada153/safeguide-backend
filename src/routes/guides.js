const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Create or update the logged-in guide's own profile
router.put('/me', authenticate, requireRole('guide'), async (req, res) => {
  const guide_id = req.user.id;
  const { bio, languages, base_price_cents, location_city, location_country } = req.body;

  if (base_price_cents === undefined || base_price_cents < 0) {
    return res.status(400).json({ error: 'base_price_cents is required and must be >= 0' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO guides (user_id, bio, languages, base_price_cents, location_city, location_country)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         bio = EXCLUDED.bio,
         languages = EXCLUDED.languages,
         base_price_cents = EXCLUDED.base_price_cents,
         location_city = EXCLUDED.location_city,
         location_country = EXCLUDED.location_country
       RETURNING *`,
      [guide_id, bio || null, languages || [], base_price_cents, location_city || null, location_country || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save guide profile' });
  }
});
// Public — view a single guide's profile + their active tours
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const guideResult = await pool.query(
      `SELECT u.id, u.full_name, g.bio, g.languages, g.base_price_cents,
              g.location_city, g.location_country, g.created_at
       FROM guides g
       JOIN users u ON u.id = g.user_id
       WHERE g.user_id = $1`,
      [id]
    );

    if (guideResult.rowCount === 0) {
      return res.status(404).json({ error: 'Guide not found' });
    }

    const toursResult = await pool.query(
      `SELECT id, title, description, duration_minutes, price_cents
       FROM tours
       WHERE guide_id = $1 AND is_active = true`,
      [id]
    );

    res.json({
      ...guideResult.rows[0],
      tours: toursResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch guide' });
  }
});

// Public — list/search guides
router.get('/', async (req, res) => {
  const { city, language, max_price_cents } = req.query;

  let query = `
    SELECT u.id, u.full_name, g.bio, g.languages, g.base_price_cents,
           g.location_city, g.location_country
    FROM guides g
    JOIN users u ON u.id = g.user_id
    WHERE 1=1
  `;
  const params = [];

  if (city) {
    params.push(city);
    query += ` AND g.location_city ILIKE $${params.length}`;
  }
  if (language) {
    params.push(language);
    query += ` AND $${params.length} = ANY(g.languages)`;
  }
  if (max_price_cents) {
    params.push(max_price_cents);
    query += ` AND g.base_price_cents <= $${params.length}`;
  }
  console.log('QUERY:', query);
  query += ` ORDER BY g.created_at DESC`;

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch guides' });
  }
});

module.exports = router;