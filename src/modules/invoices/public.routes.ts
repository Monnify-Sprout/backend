import { Router } from 'express';

import { HttpError } from '../../middleware/error';

import {
  expireOverdueInvoiceByReference,
  findPaymentForInvoice,
  findPublicInvoiceByReference,
} from './invoice.repo';

// Buyer-facing lookup (PRD §7.2 flow C). No auth: anyone holding the invoice
// reference (the shared payment link) may read it. The response is a safe
// subset - business name only, no merchant contact details, no customer email,
// no settlement/commission figures - and payment channels are returned ONLY
// while the invoice is still payable, so a terminal invoice never re-offers
// payment.
export const publicInvoiceRouter = Router();

publicInvoiceRouter.get('/invoices/:reference', async (req, res, next) => {
  try {
    const { reference } = req.params;
    if (!reference) {
      throw new HttpError(400, 'Invalid invoice reference.');
    }

    // Settle expiry server-side before reading, so the client never has to
    // (and can never mis-) derive it.
    await expireOverdueInvoiceByReference(reference);

    const found = await findPublicInvoiceByReference(reference);
    if (!found) {
      throw new HttpError(404, 'Invoice not found.');
    }

    const payable = found.status === 'pending';
    const payment = found.status === 'paid'
      ? await findPaymentForInvoice(found.id)
      : null;

    res.json({
      invoice: {
        invoice_reference: found.invoice_reference,
        business_name: found.business_name,
        customer_name: found.customer_name,
        description: found.description,
        amount: found.amount,
        currency: found.currency,
        due_date: found.due_date,
        status: found.status,
        virtual_account_number: payable ? found.virtual_account_number : null,
        checkout_url: payable ? found.checkout_url : null,
        created_at: found.created_at,
      },
      payment: payment
        ? {
            amount: payment.amount,
            payment_method: payment.payment_method,
            paid_at: payment.paid_at,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});
