import 'dotenv/config';
import express from 'express';

import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiRouter } from './routes';

const app = express();

app.use(express.json());

// Liveness probe.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'sprout-backend' });
});

// Feature API (auth + protected routes).
app.use('/api', apiRouter);

// Fallbacks — order matters: 404 first, then the error handler.
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`sprout-backend listening on http://localhost:${env.PORT}`);
});
