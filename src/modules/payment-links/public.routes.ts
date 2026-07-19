import { Router } from 'express';

import { HttpError } from '../../middleware/error';

import { findPublicPaymentLinkBySlug } from './payment-links.repo';

// Buyer-facing lookup for a static payment link. No auth: anyone holding the
// shared link may read it. The response is a safe subset - business name only,
// no merchant contact, no settlement/commission - and payment channels are
// returned ONLY while the link is 'active', so a paused or ended link never
// offers a way to pay.
export const publicPaymentLinkRouter = Router();

publicPaymentLinkRouter.get('/links/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    if (!slug) {
      throw new HttpError(400, 'Invalid payment link.');
    }

    const found = await findPublicPaymentLinkBySlug(slug);
    if (!found) {
      throw new HttpError(404, 'Payment link not found.');
    }

    const payable = found.status === 'active';

    res.json({
      link: {
        slug: found.slug,
        business_name: found.business_name,
        title: found.title,
        item: found.item,
        amount: found.amount,
        currency: found.currency,
        status: found.status,
        reserved_account_number: payable ? found.reserved_account_number : null,
        reserved_account_bank_name: payable ? found.reserved_account_bank_name : null,
        checkout_url: payable ? found.checkout_url : null,
      },
    });
  } catch (err) {
    next(err);
  }
});
