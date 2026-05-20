import { apiClient } from '@/src/lib/api';

// ─── Auth ────────────────────────────────────────────────────────────────────
// The admin JWT is separate from the user JWT but both use the same Bearer
// header. saveToken() in signIn swaps the stored token, so every apiClient
// call after an admin login automatically uses the admin token.

export interface AdminLoginResponse {
  token: string;
  admin: { email: string; type: 'admin' };
}

export async function adminLogin(email: string, password: string): Promise<AdminLoginResponse> {
  const res = await apiClient.post<AdminLoginResponse>('/api/admin/login', { email, password });
  return res.data;
}

// ─── Stats ───────────────────────────────────────────────────────────────────
export async function fetchAdminStats(): Promise<any> {
  const res = await apiClient.get('/api/admin/stats');
  return res.data;
}

// ─── Generic table browse ────────────────────────────────────────────────────
// The backend exposes a generic /api/admin/tables/:tableName endpoint that
// covers users / organizations / locations / reports in one shape. v1 of the
// mobile admin UI relies on this for listing; approve/suspend/delete actions
// hit the same endpoint family with PUT/DELETE.

export interface TableRow { [key: string]: any }

export async function fetchAdminTable(
  tableName: string,
  opts: { limit?: number; offset?: number; search?: string } = {}
): Promise<{ rows: TableRow[]; total: number }> {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.offset != null) params.set('offset', String(opts.offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  const path = opts.search
    ? `/api/admin/tables/${tableName}/search?q=${encodeURIComponent(opts.search)}`
    : `/api/admin/tables/${tableName}${query}`;
  const res = await apiClient.get(path);
  const data = res.data;
  if (Array.isArray(data)) return { rows: data, total: data.length };
  return { rows: data?.rows ?? data?.data ?? [], total: data?.total ?? data?.rows?.length ?? 0 };
}

export async function updateAdminTableRow(tableName: string, id: number | string, updates: Record<string, any>): Promise<any> {
  const res = await apiClient.put(`/api/admin/tables/${tableName}/${id}`, updates);
  return res.data;
}

export async function deleteAdminTableRow(tableName: string, id: number | string): Promise<void> {
  await apiClient.delete(`/api/admin/tables/${tableName}/${id}`);
}

// ─── Business registration approvals ─────────────────────────────────────────
export async function fetchBusinessRegistrations(): Promise<TableRow[]> {
  const res = await apiClient.get('/api/admin/business-registrations');
  const data = res.data;
  return Array.isArray(data) ? data : (data?.rows ?? data?.data ?? []);
}

export async function updateBusinessRegistration(id: number | string, updates: { status?: 'approved' | 'rejected' | 'pending'; notes?: string }): Promise<any> {
  const res = await apiClient.patch(`/api/admin/business-registrations/${id}`, updates);
  return res.data;
}

// ─── Manage organizations / locations (higher-level wrappers) ────────────────
export async function fetchManageOrganizations(): Promise<TableRow[]> {
  const res = await apiClient.get('/api/admin/manage/organizations');
  const data = res.data;
  return Array.isArray(data) ? data : (data?.rows ?? data?.organizations ?? []);
}

export async function updateManageOrganization(id: number | string, updates: Record<string, any>): Promise<any> {
  const res = await apiClient.put(`/api/admin/manage/organizations/${id}`, updates);
  return res.data;
}

export async function fetchManageLocations(): Promise<TableRow[]> {
  const res = await apiClient.get('/api/admin/manage/locations');
  const data = res.data;
  return Array.isArray(data) ? data : (data?.rows ?? data?.locations ?? []);
}

export async function updateManageLocation(id: number | string, updates: Record<string, any>): Promise<any> {
  const res = await apiClient.put(`/api/admin/manage/locations/${id}`, updates);
  return res.data;
}
