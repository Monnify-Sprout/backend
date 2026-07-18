import { Router } from 'express';

import { formatZodError } from '../../lib/validation';
import { requireAuth } from '../../middleware/auth';
import { HttpError } from '../../middleware/error';

import {
  findInvoiceForMerchant,
  findPaymentForInvoice,
  listInvoicesForMerchant,
} from './invoice.repo';
import { createInvoiceSchema } from './invoice.schema';
import { createInvoice } from './invoice.service';

export const invoiceRouter = Router();

// All invoice routes are merchant-scoped.
invoiceRouter.use(requireAuth);

// POST /api/invoices - create a Dynamic Invoice (returns virtual account +
// checkout URL + the settlement split).
invoiceRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(422, 'Validation failed', formatZodError(parsed.error));
    }
    const result = await createInvoice(req.merchant!.id, parsed.data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices - the merchant's invoices, newest first (dashboard, FR-08).
invoiceRouter.get('/', async (req, res, next) => {
  try {
    const invoices = await listInvoicesForMerchant(req.merchant!.id);
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
