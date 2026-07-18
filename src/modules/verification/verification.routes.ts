import { Router } from 'express';

import { formatZodError } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { HttpError } from '../../middleware/error';

import { verificationSchema } from './verification.schema';
import { verifyMerchantIdentity } from './verification.service';

export const verificationRouter = Router();

// POST /api/verification - the authenticated merchant submits their BVN/NIN.
// Returns the updated merchant: verified+active on success, or failed (still not
// active) with a stored reason. A mocked check is flagged via verification_mode.
verificationRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const parsed = verificationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    // requireAuth guarantees req.merchant is set.
    const merchant = await verifyMerchantIdentity(req.merchant!.id, parsed.data);
    res.json({ merchant });
  } catch (err) {
    next(err);
  }
});
