import { Router } from 'express';

import { env } from '../../config/env';
import { verifyMonnifySignature } from '../../lib/webhook';

import {
  processMonnifyWebhook,
  type MonnifyWebhookPayload,
} from './webhook.service';

export const webhookRouter = Router();

// POST /api/webhooks/monnify - Monnify's collection callback. No auth: trust is
// established by the HMAC signature over the raw body. Acknowledge quickly (FR-06).
webhookRouter.post('/monnify', (req, res, next) => {
  const signature = req.header('monnify-signature');
  if (
    !verifyMonnifySignature(req.rawBody, signature, env.MONNIFY_WEBHOOK_SECRET)
  ) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  const payload = req.body as MonnifyWebhookPayload;
  // Ack only after a handled outcome; unexpected errors bubble to a 500 so
  // Monnify retries the delivery.
  processMonnifyWebhook(payload)
    .then((outcome) => {
      res.status(200).json({ received: true, outcome });
    })
    .catch(next);
});
