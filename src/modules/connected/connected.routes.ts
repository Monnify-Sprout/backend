import { Router } from 'express';

import { formatZodError } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { HttpError } from '../../middleware/error';

import { listConnectedAccounts } from './connected.repo';
import { connectAccountSchema } from './connected.schema';
import { connectAccount, syncConnectedAccount } from './connected.service';

export const connectedRouter = Router();

// Any authenticated merchant may connect an external account - this segment is
// pure reporting and does not require Sprout verification (PRD §7.6).
connectedRouter.use(requireAuth);

// POST /api/connected-accounts - link an existing Monnify account (read-only).
connectedRouter.post('/', async (req, res, next) => {
  try {
    const parsed = connectAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const account = await connectAccount(req.merchant!.id, parsed.data);
    res.status(201).json({ account });
  } catch (err) {
    next(err);
  }
});

// GET /api/connected-accounts - the merchant's linked accounts (no credentials).
connectedRouter.get('/', async (req, res, next) => {
  try {
    const accounts = await listConnectedAccounts(req.merchant!.id);
    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

// POST /api/connected-accounts/:id/sync - pull transaction history.
connectedRouter.post('/:id/sync', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Invalid connected account id.');
    }
    const result = await syncConnectedAccount(req.merchant!.id, id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
