import { Router } from 'express';

import { requireAuth } from '../../middleware/auth';
import { HttpError } from '../../middleware/error';
import { findConnectedAccount } from '../connected/connected.repo';

import { analyticsFor } from './analytics.service';

export const analyticsRouter = Router();

// GET /api/analytics[?connected_account_id=…][&days=30]
// Without connected_account_id: the merchant's own invoice/payment analytics.
// With it: the same engine over that connected account's pulled history -
// identical response shape, so the frontend renders one component for both.
analyticsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const merchantId = req.merchant!.id;

    const daysRaw = req.query.days;
    const days = daysRaw === undefined ? 30 : Number(daysRaw);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new HttpError(422, 'days must be an integer between 1 and 365.');
    }

    const connectedAccountId = req.query.connected_account_id;
    if (connectedAccountId !== undefined) {
      if (typeof connectedAccountId !== 'string' || !connectedAccountId) {
        throw new HttpError(422, 'connected_account_id must be a single id.');
      }
      // Ownership check - a merchant can only read accounts they connected.
      const account = await findConnectedAccount(merchantId, connectedAccountId);
      if (!account) {
        throw new HttpError(404, 'Connected account not found.');
      }
      const result = await analyticsFor(
        { type: 'connected_account', id: account.id },
        days,
      );
      res.json(result);
      return;
    }

    const result = await analyticsFor({ type: 'merchant', id: merchantId }, days);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
