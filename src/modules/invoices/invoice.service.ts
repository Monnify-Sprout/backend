import { randomBytes } from 'node:crypto';

import { env } from '../../config/env';
import { getMonnifyProvider } from '../../lib/monnify';
import { computeSplit, round2 } from '../../lib/money';
import { HttpError } from '../../middleware/error';
import { findMerchantById } from '../auth/auth.repo';

import {
  insertInvoice,
  type PublicInvoice,
  type SettlementPath,
} from './invoice.repo';
import type { CreateInvoiceInput } from './invoice.schema';

export interface InvoiceWithSettlement {
  invoice: PublicInvoice;
  settlement: {
    path: SettlementPath;
    commission_percent: number;
    commission_amount: number; // Sprout's cut
    settlement_amount: number; // merchant's take-home
  };
}

// PRD §7.2 / §7.3 / FR-04, FR-12.
export async function createInvoice(
  merchantId: string,
  input: CreateInvoiceInput,
): Promise<InvoiceWithSettlement> {
  const merchant = await findMerchantById(merchantId);
  if (!merchant) {
    throw new HttpError(404, 'Merchant not found.');
  }
  // Only a verified, sub-account-holding merchant can collect (PRD §7.1).
  if (merchant.status !== 'active' || !merchant.sub_account_code) {
    throw new HttpError(
      403,
      'Complete BVN/NIN verification before creating invoices.',
    );
  }

  const amount = round2(input.amount);
  const { commission, settlement } = computeSplit(
    amount,
    env.SPROUT_COMMISSION_PERCENT,
  );

  // Split applied at settlement only if Monnify's Create Invoice supports it
  // (UNCONFIRMED, PRD §7.3); otherwise the safe manual fallback.
  const splitSupported = env.MONNIFY_INVOICE_SPLIT_SUPPORTED;
  const settlementPath: SettlementPath = splitSupported ? 'split' : 'manual';

  const invoiceReference = `SPT-${Date.now().toString(36).toUpperCase()}-${randomBytes(
    3,
  )
    .toString('hex')
    .toUpperCase()}`;
  const customerEmail =
    input.customer_email ??
    `invoice+${invoiceReference.toLowerCase()}@sprout.invalid`;
  const description = input.description ?? `Payment for ${input.customer_name}`;

  const provider = getMonnifyProvider();
  const created = await provider.createInvoice({
    invoiceReference,
    amount,
    currency: 'NGN',
    description,
    customerName: input.customer_name,
    customerEmail,
    dueDate: input.due_date,
    incomeSplit: splitSupported
      ? {
          subAccountCode: merchant.sub_account_code,
          splitPercentage: round2((settlement / amount) * 100),
        }
      : undefined,
  });

  const invoice = await insertInvoice({
    merchantId,
    invoiceReference,
    customerName: input.customer_name,
    customerEmail,
    description,
    amount,
    currency: 'NGN',
    dueDate: input.due_date ?? null,
    transactionReference: created.transactionReference,
    virtualAccountNumber: created.virtualAccountNumber,
    checkoutUrl: created.checkoutUrl,
    settlementPath,
  });

  return {
    invoice,
    settlement: {
      path: settlementPath,
      commission_percent: env.SPROUT_COMMISSION_PERCENT,
      commission_amount: commission,
      settlement_amount: settlement,
    },
  };
}
