require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const authRouter = require('./routes/auth');
const guidesRouter = require('./routes/guides');
const toursRouter = require('./routes/tours');
const bookingsRouter = require('./routes/bookings');
const reviewsRouter = require('./routes/reviews');

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());
app.use('/auth', authRouter);
app.use('/guides', guidesRouter);
app.use('/tours', toursRouter);
app.use('/bookings', bookingsRouter);
app.use('/reviews', reviewsRouter);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
