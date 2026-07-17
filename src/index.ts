import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(express.json());

// Placeholder route — feature routes arrive in phase 1+.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'sprout-backend' });
});

app.listen(port, () => {
  console.log(`sprout-backend listening on http://localhost:${port}`);
});
