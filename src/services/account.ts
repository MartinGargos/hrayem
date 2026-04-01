import { callEdgeFunctionRoute } from './edge-functions';
import type { DeleteAccountResponse } from '../types/account';

type AccountErrorCode =
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'INVALID_JSON'
  | 'INTERNAL_ERROR';

export async function deleteAccount(): Promise<DeleteAccountResponse> {
  return callEdgeFunctionRoute<DeleteAccountResponse, AccountErrorCode>('account', '/delete', {});
}
