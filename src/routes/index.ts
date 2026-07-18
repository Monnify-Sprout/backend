import { Router } from 'express';

import { requireAuth } from '../middleware/auth';
import { HttpError } from '../middleware/error';
import { authRouter } from '../modules/auth/auth.routes';
import { findMerchantById } from '../modules/auth/auth.repo';
import { verificationRouter } from '../modules/verification/verification.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/verification', verificationRouter);

// Protected placeholder — proves the JWT middleware works and lets a client
// read the authenticated merchant (including its non-Active status).
apiRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    // requireAuth guarantees req.merchant is set.
    const merchantId = req.merchant!.id;
    const merchant = await findMerchantById(merchantId);
    if (!merchant) {
      throw new HttpError(404, 'Merchant not found.');
    }
    res.json({ merchant });
  } catch (err) {
    next(err);
  }
});
