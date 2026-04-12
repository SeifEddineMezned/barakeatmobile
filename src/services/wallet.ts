import { apiClient } from '@/src/lib/api';

export interface WalletTransaction {
  id: number;
  wallet_id: number;
  type: 'reward' | 'referral' | 'refund' | 'payment' | 'admin_credit' | 'code_redeem';
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

export interface RedeemCodeResponse {
  success: boolean;
  message: string;
  balance: number;
  transaction: WalletTransaction;
}

export async function fetchWallet(): Promise<WalletData> {
  const res = await apiClient.get<any>('/api/wallet');
  return {
    balance: res.data?.balance ?? 0,
    currency: res.data?.currency ?? 'TND',
    transactions: res.data?.transactions ?? [],
  };
}

export async function payWithCredits(amount: number, reservationId?: number): Promise<{ balance: number }> {
  const res = await apiClient.post<any>('/api/wallet/pay', { amount, reservation_id: reservationId });
  return { balance: res.data?.balance ?? 0 };
}

export async function creditWallet(data: {
  user_id?: number;
  amount: number;
  type?: string;
  description?: string;
}): Promise<{ balance: number }> {
  const res = await apiClient.post<any>('/api/wallet/credit', data);
  return { balance: res.data?.balance ?? 0 };
}

export async function redeemCode(code: string): Promise<RedeemCodeResponse> {
  const res = await apiClient.post<any>('/api/wallet/redeem', { code: code.trim().toUpperCase() });
  return res.data as RedeemCodeResponse;
}
