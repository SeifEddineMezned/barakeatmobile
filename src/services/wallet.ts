import { apiClient } from '@/src/lib/api';

export interface WalletTransaction {
  id: number;
  wallet_id: number;
  type: 'reward' | 'referral' | 'refund' | 'payment' | 'admin_credit';
  amount: number;
  description?: string;
  reference_id?: number;
  created_at: string;
}

export interface WalletData {
  balance: number;
  currency: string;
  transactions: WalletTransaction[];
}

// pg's NUMERIC / DECIMAL columns arrive as strings over the wire. Coerce once
// here so every downstream consumer can safely call .toFixed / do arithmetic.
const toNumber = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function fetchWallet(): Promise<WalletData> {
  const res = await apiClient.get<any>('/api/wallet');
  const rawTransactions: any[] = Array.isArray(res.data?.transactions) ? res.data.transactions : [];
  return {
    balance: toNumber(res.data?.balance),
    currency: res.data?.currency ?? 'TND',
    transactions: rawTransactions.map((t) => ({ ...t, amount: toNumber(t?.amount) })) as WalletTransaction[],
  };
}

export async function payWithCredits(amount: number, reservationId?: number): Promise<{ balance: number }> {
  const res = await apiClient.post<any>('/api/wallet/pay', { amount, reservation_id: reservationId });
  return { balance: toNumber(res.data?.balance) };
}

export async function redeemCode(code: string): Promise<{ balance: number; amount: number }> {
  const res = await apiClient.post<any>('/api/wallet/redeem', { code });
  // Backend puts the credited amount on `transaction.amount`; keep a root-level
  // fallback in case that ever changes.
  const amount = toNumber(res.data?.transaction?.amount ?? res.data?.amount);
  return { balance: toNumber(res.data?.balance), amount };
}

export async function creditWallet(data: {
  user_id?: number;
  amount: number;
  type?: string;
  description?: string;
}): Promise<{ balance: number }> {
  const res = await apiClient.post<any>('/api/wallet/credit', data);
  return { balance: toNumber(res.data?.balance) };
}
