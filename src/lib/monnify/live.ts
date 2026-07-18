import { env } from '../../config/env';
import { HttpError } from '../../middleware/error';

import type {
  CreateInvoiceInput,
  CreateInvoiceResult,
  CreateSubAccountInput,
  CreateSubAccountResult,
  MonnifyProvider,
  TransactionStatus,
  VerifyIdentityInput,
  VerifyIdentityResult,
  VerifyTransactionResult,
} from './types';

// Monnify wraps every response in this envelope.
interface MonnifyEnvelope<T = unknown> {
  requestSuccessful?: boolean;
  responseMessage?: string;
  responseCode?: string;
  responseBody?: T;
}
interface AuthBody {
  accessToken: string;
  expiresIn: number;
}
interface SubAccountBody {
  subAccountCode: string;
}
interface InvoiceBody {
  invoiceReference: string;
  transactionReference: string;
  accountNumber?: string;
  bankName?: string;
  checkoutUrl: string;
}
interface TransactionBody {
  transactionReference: string;
  paymentStatus?: string;
  amountPaid?: number | string;
  currencyCode?: string;
  paymentMethod?: string;
  paidOn?: string;
}

// Real Monnify integration.
//
// IMPORTANT: BVN/NIN verification is Live-Mode-only (PRD §5) and sub-account
// activation on Sprout's contract is a manual approval process (§11) — so this
// path cannot be exercised in sandbox. It is kept structurally complete behind the
// env gate; confirm the exact verification endpoints against Monnify's live docs
// before a production run. The hackathon demo runs on the mock provider.
export class MonnifyLiveProvider implements MonnifyProvider {
  readonly mode = 'live' as const;
  private token?: { value: string; expiresAt: number };

  private config(): {
    baseUrl: string;
    apiKey: string;
    secretKey: string;
    contractCode: string;
  } {
    const {
      MONNIFY_BASE_URL,
      MONNIFY_API_KEY,
      MONNIFY_SECRET_KEY,
      MONNIFY_CONTRACT_CODE,
    } = env;
    if (
      !MONNIFY_BASE_URL ||
      !MONNIFY_API_KEY ||
      !MONNIFY_SECRET_KEY ||
      !MONNIFY_CONTRACT_CODE
    ) {
      throw new HttpError(
        500,
        'Monnify live credentials are not configured. Set MONNIFY_BASE_URL, MONNIFY_API_KEY, MONNIFY_SECRET_KEY and MONNIFY_CONTRACT_CODE, or use MONNIFY_VERIFICATION_MODE=mock.',
      );
    }
    return {
      baseUrl: MONNIFY_BASE_URL.replace(/\/$/, ''),
      apiKey: MONNIFY_API_KEY,
      secretKey: MONNIFY_SECRET_KEY,
      contractCode: MONNIFY_CONTRACT_CODE,
    };
  }

  // Bearer token cached until shortly before expiry (Monnify §11 "Authenticate").
  private async authToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 5_000) {
      return this.token.value;
    }
    const cfg = this.config();
    const basic = Buffer.from(`${cfg.apiKey}:${cfg.secretKey}`).toString(
      'base64',
    );
    const res = await fetch(`${cfg.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}` },
    });
    const json = (await res.json()) as MonnifyEnvelope<AuthBody>;
    if (!res.ok || !json.requestSuccessful || !json.responseBody?.accessToken) {
      throw new HttpError(
        502,
        `Monnify authentication failed: ${json.responseMessage ?? res.status}`,
      );
    }
    const { accessToken, expiresIn } = json.responseBody;
    this.token = {
      value: accessToken,
      expiresAt: Date.now() + (expiresIn || 0) * 1000,
    };
    return accessToken;
  }

  async verifyIdentity(
    input: VerifyIdentityInput,
  ): Promise<VerifyIdentityResult> {
    const cfg = this.config();
    const token = await this.authToken();
    const path =
      input.idType === 'BVN'
        ? '/api/v1/vas/bvn-details-match'
        : '/api/v1/vas/nin-details';
    const body =
      input.idType === 'BVN'
        ? { bvn: input.idNumber, name: input.name }
        : { nin: input.idNumber };
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as MonnifyEnvelope;
    if (!res.ok || !json.requestSuccessful) {
      return {
        verified: false,
        reason: json.responseMessage ?? `Verification failed (${res.status}).`,
      };
    }
    return { verified: true };
  }

  async createSubAccount(
    input: CreateSubAccountInput,
  ): Promise<CreateSubAccountResult> {
    if (!input.bankCode || !input.accountNumber) {
      throw new HttpError(
        422,
        'Live sub-account creation needs a settlement bank code and account number.',
      );
    }
    const cfg = this.config();
    const token = await this.authToken();
    const res = await fetch(`${cfg.baseUrl}/api/v1/sub-accounts`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify([
        {
          currencyCode: 'NGN',
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
          email: input.email,
          defaultSplitPercentage: 0,
        },
      ]),
    });
    const json = (await res.json()) as MonnifyEnvelope<SubAccountBody[]>;
    const code = json.responseBody?.[0]?.subAccountCode;
    if (!res.ok || !json.requestSuccessful || !code) {
      throw new HttpError(
        502,
        `Monnify sub-account creation failed: ${json.responseMessage ?? res.status}`,
      );
    }
    return { subAccountCode: code };
  }

  async createInvoice(
    input: CreateInvoiceInput,
  ): Promise<CreateInvoiceResult> {
    const cfg = this.config();
    const token = await this.authToken();
    const body: Record<string, unknown> = {
      amount: input.amount,
      invoiceReference: input.invoiceReference,
      description: input.description,
      currencyCode: input.currency,
      contractCode: cfg.contractCode,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      expiryDate: toMonnifyExpiry(input.dueDate),
      paymentMethods: ['ACCOUNT_TRANSFER', 'CARD'],
    };
    // Split path (PRD §7.3) — send only when we've confirmed Create Invoice
    // accepts incomeSplitConfig.
    if (input.incomeSplit) {
      body.incomeSplitConfig = [
        {
          subAccountCode: input.incomeSplit.subAccountCode,
          splitPercentage: input.incomeSplit.splitPercentage,
          feeBearer: true,
        },
      ];
    }
    const res = await fetch(`${cfg.baseUrl}/api/v1/invoice/create`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as MonnifyEnvelope<InvoiceBody>;
    const b = json.responseBody;
    if (!res.ok || !json.requestSuccessful || !b?.transactionReference) {
      throw new HttpError(
        502,
        `Monnify invoice creation failed: ${json.responseMessage ?? res.status}`,
      );
    }
    return {
      invoiceReference: b.invoiceReference,
      transactionReference: b.transactionReference,
      virtualAccountNumber: b.accountNumber ?? '',
      virtualAccountBankName: b.bankName,
      checkoutUrl: b.checkoutUrl,
    };
  }

  async verifyTransaction(
    transactionReference: string,
  ): Promise<VerifyTransactionResult> {
    const cfg = this.config();
    const token = await this.authToken();
    const url = `${cfg.baseUrl}/api/v2/merchant/transactions/query?transactionReference=${encodeURIComponent(
      transactionReference,
    )}`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as MonnifyEnvelope<TransactionBody>;
    const b = json.responseBody;
    if (!res.ok || !json.requestSuccessful || !b) {
      return { transactionReference, status: 'UNKNOWN', amountPaid: 0 };
    }
    return {
      transactionReference,
      status: normaliseStatus(b.paymentStatus),
      amountPaid: Number(b.amountPaid ?? 0),
      currency: b.currencyCode,
      paymentMethod: b.paymentMethod,
      paidAt: b.paidOn,
    };
  }
}

function normaliseStatus(status: string | undefined): TransactionStatus {
  switch (status) {
    case 'PAID':
      return 'PAID';
    case 'PENDING':
    case 'PARTIALLY_PAID':
      return 'PENDING';
    case 'FAILED':
    case 'EXPIRED':
    case 'CANCELLED':
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
}

// Monnify expects "yyyy-MM-dd HH:mm:ss"; default to +7 days end-of-day.
function toMonnifyExpiry(dueDate?: string): string {
  const base = dueDate
    ? new Date(`${dueDate}T23:59:59`)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(
    base.getDate(),
  )} ${pad(base.getHours())}:${pad(base.getMinutes())}:${pad(base.getSeconds())}`;
}
