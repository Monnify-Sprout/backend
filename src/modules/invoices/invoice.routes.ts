import { Router } from 'express';

import { formatZodError } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { HttpError } from '../../middleware/error';
import { attachStream } from '../../middleware/stream';

import {
  expireOverdueInvoicesForMerchant,
  findInvoiceForMerchant,
  findPaymentForInvoice,
  listInvoicesForMerchant,
} from './invoice.repo';
import { createInvoiceSchema } from './invoice.schema';
import { createInvoice, simulateInvoicePayment } from './invoice.service';

export const invoiceRouter = Router();

// All invoice routes are merchant-scoped; attachStream additionally resolves the
// current workspace stream (Phase 14) from the X-Stream-Id header.
invoiceRouter.use(requireAuth, attachStream);

// POST /api/invoices - create a Dynamic Invoice (returns virtual account +
// checkout URL + the settlement split). Auto-assigned to the current stream.
invoiceRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const result = await createInvoice(req.merchant!.id, req.streamId!, parsed.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices - the current stream's invoices, newest first (dashboard,
// FR-08). Scoped to the workspace stream so the dashboard shows one stream at a
// time.
invoiceRouter.get('/', async (req, res, next) => {
  try {
    // Lazy expiry sweep so the dashboard agrees with the public payment page.
    await expireOverdueInvoicesForMerchant(req.merchant!.id);
    const invoices = await listInvoicesForMerchant(req.merchant!.id, req.streamId);
    res.json({ invoices });
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices/:id - one invoice plus its payment/settlement outcome.
invoiceRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Invalid invoice id.');
    }
    await expireOverdueInvoicesForMerchant(req.merchant!.id);
    const invoice = await findInvoiceForMerchant(req.merchant!.id, id);
    if (!invoice) {
      throw new HttpError(404, 'Invoice not found.');
    }
    const payment = await findPaymentForInvoice(invoice.id);
    res.json({ invoice, payment });
  } catch (err) {
    next(err);
  }
});

// POST /api/invoices/:id/simulate-payment - demo/testing only (mock mode). Pays
// this invoice via the real webhook path so judges can complete the flow without
// firing a signed webhook by hand. Refuses under live mode.
invoiceRouter.post('/:id/simulate-payment', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'Invalid invoice id.');
    }
    const result = await simulateInvoicePayment(req.merchant!.id, id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
