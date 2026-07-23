import type { Paginated } from '@/features/clientes/api/types';

export type { Paginated };

export type BillingType = 'RECURRING' | 'INSTALLMENTS' | 'ONE_TIME';
export type ContractStatus = 'ACTIVE' | 'PAUSED' | 'FINISHED' | 'CANCELED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELED';
export type PaymentMethod = 'PIX' | 'TRANSFER' | 'BOLETO' | 'CARD' | 'CASH';

export interface Payment {
  id: string;
  contractId: string;
  description: string;
  amount: string;
  dueDate: string;
  status: PaymentStatus;
  paidAt?: string | null;
  paidAmount?: string | null;
  method?: PaymentMethod | null;
  notes?: string | null;
  contract?: {
    id: string;
    description: string;
    billingType: BillingType;
    clientId: string;
    client: { id: string; name: string };
  };
}

export interface Contract {
  id: string;
  clientId: string;
  client: { id: string; name: string };
  projectId?: string | null;
  proposalId?: string | null;
  description: string;
  billingType: BillingType;
  status: ContractStatus;
  monthlyAmount?: string | null;
  billingDay?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  downPayment?: string | null;
  installments?: number | null;
  installmentAmount?: string | null;
  payments: Payment[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateContractBody {
  clientId: string;
  description: string;
  billingType: BillingType;
  projectId?: string;
  proposalId?: string;
  // RECURRING
  monthlyAmount?: number;
  billingDay?: number;
  startDate?: string;
  endDate?: string;
  // INSTALLMENTS
  downPayment?: number;
  downPaymentDueDate?: string;
  installments?: number;
  installmentAmount?: number;
  firstInstallmentDueDate?: string;
  // ONE_TIME
  amount?: number;
  dueDate?: string;
}
export interface UpdateContractBody {
  description?: string;
  monthlyAmount?: number;
  billingDay?: number;
  endDate?: string;
}

export interface UpdatePaymentBody {
  description?: string;
  amount?: number;
  dueDate?: string;
}
export interface PayPaymentBody {
  method: PaymentMethod;
  paidAt?: string;
  paidAmount?: number;
  notes?: string;
}

export interface ListContractsParams {
  page?: number;
  limit?: number;
  clientId?: string;
  status?: ContractStatus;
  billingType?: BillingType;
}
export interface ListPaymentsParams {
  page?: number;
  limit?: number;
  search?: string;
  clientId?: string;
  contractId?: string;
  status?: PaymentStatus;
  billingType?: BillingType;
  dueFrom?: string;
  dueTo?: string;
}
