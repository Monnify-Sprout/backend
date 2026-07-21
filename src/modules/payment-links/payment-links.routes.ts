import { Router } from 'express';

import { formatZodError } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { HttpError } from '../../middleware/error';
import { attachStream } from '../../middleware/stream';

import {
  createPaymentLinkSchema,
  simulateCollectionSchema,
  updateStatusSchema,
} from './payment-links.schema';
import {
  createPaymentLink,
  getPaymentLink,
  listPaymentLinks,
  setPaymentLinkStatus,
  simulateLinkCollection,
} from './payment-links.service';

export const paymentLinkRouter = Router();

// All payment-link routes are merchant-scoped (Phase 12); attachStream resolves
// the current workspace stream (Phase 14) from the X-Stream-Id header.
paymentLinkRouter.use(requireAuth, attachStream);

// GET /api/payment-links - the current stream's links plus a status-count
// summary scoped to that stream.
paymentLinkRouter.get('/', async (req, res, next) => {
  try {
    const result = await listPaymentLinks(req.merchant!.id, req.streamId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/payment-links - create a reusable link backed by a reserved account.
// Auto-assigned to the current stream.
paymentLinkRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createPaymentLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const link = await createPaymentLink(req.merchant!.id, req.streamId!, parsed.data);
    res.status(201).json({ link });
  } catch (err) {
    next(err);
  }
});

// GET /api/payment-links/:id - one link with its stats + collections.
paymentLinkRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Invalid payment link id.');
    }
    const detail = await getPaymentLink(req.merchant!.id, id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/payment-links/:id/status - pause / resume / end (ending is terminal).
paymentLinkRouter.patch('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Invalid payment link id.');
    }
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const link = await setPaymentLinkStatus(req.merchant!.id, id, parsed.data.status);
    res.json({ link });
  } catch (err) {
    next(err);
  }
});

// POST /api/payment-links/:id/simulate-collection - demo/testing only (mock
// mode). Makes a collection land against the link via the real webhook path.
paymentLinkRouter.post('/:id/simulate-collection', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Invalid payment link id.');
    }
    const parsed = simulateCollectionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const result = await simulateLinkCollection(req.merchant!.id, id, parsed.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
