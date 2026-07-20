import { Router } from 'express';

import { formatZodError } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { HttpError } from '../../middleware/error';

import {
  createStreamSchema,
  updateStreamSchema,
  updateStreamStatusSchema,
} from './streams.schema';
import {
  createStream,
  deleteStream,
  listStreams,
  setStreamStatus,
  updateStream,
} from './streams.service';

export const streamRouter = Router();

// All stream routes are merchant-scoped (Phase 13).
streamRouter.use(requireAuth);

// GET /api/streams - the merchant's streams with per-stream rollups
// (invoice/link counts, total collected across both, last payment).
streamRouter.get('/', async (req, res, next) => {
  try {
    const streams = await listStreams(req.merchant!.id);
    res.json({ streams });
  } catch (err) {
    next(err);
  }
});

// POST /api/streams - create a stream; with a settlement account it becomes a
// routed stream (its own Monnify sub-account), without one it is tracking-only.
streamRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createStreamSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const stream = await createStream(req.merchant!.id, parsed.data);
    res.status(201).json({ stream });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/streams/:id - rename and/or attach, replace, or clear the
// settlement destination.
streamRouter.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Invalid stream id.');
    }
    const parsed = updateStreamSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const stream = await updateStream(req.merchant!.id, id, parsed.data);
    res.json({ stream });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/streams/:id/status - archive / restore (reversible).
streamRouter.patch('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Invalid stream id.');
    }
    const parsed = updateStreamStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const stream = await setStreamStatus(req.merchant!.id, id, parsed.data.status);
    res.json({ stream });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/streams/:id - only when nothing references it (409 otherwise;
// archive keeps the history).
streamRouter.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Invalid stream id.');
    }
    await deleteStream(req.merchant!.id, id);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
