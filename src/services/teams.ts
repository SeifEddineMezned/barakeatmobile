import { apiClient } from '@/src/lib/api';

export interface OrganizationFromAPI {
  id: number;
  owner_id: number;
  name: string;
  slug?: string;
  description?: string;
  category?: string;
  phone?: string;
  image_url?: string;
  cover_image_url?: string;
  created_at?: string;
}

export interface OrgMemberFromAPI {
  membership_id: number;
  user_id: number;
  role: string;
  permissions?: Record<string, string>;
  status?: string;
  restaurant_id?: number;
  location_id?: number;
  created_at?: string;
  email?: string;
  name?: string;
  phone?: string;
  location_name?: string;
  location_address?: string;
}

export interface OrgLocationFromAPI {
  id: number;
  name?: string;
  address?: string;
  available_quantity?: number;
  is_paused?: boolean;
  price_tier?: number;
  pickup_start_time?: string;
  pickup_end_time?: string;
  assigned_members?: number;
}

/**
 * A single membership row from /api/teams/my-context.
 * The backend returns { memberships: [...], has_organization: bool }.
 */
export interface MembershipFromAPI {
  organization_id: number;
  org_name: string;
  org_slug?: string;
  org_logo?: string;
  role: string;
  permissions?: Record<string, string>;
  location_id?: number;
  loc_id?: number;
  location_name?: string;
  location_address?: string;
}

/**
 * The full response shape from GET /api/teams/organizations/:orgId
 */
export interface OrgDetailsFromAPI {
  organization: OrganizationFromAPI;
  my_role: string;
  members: OrgMemberFromAPI[];
  locations: OrgLocationFromAPI[];
}

/**
 * Simplified context the rest of the app consumes.
 * Derived from the first membership returned by my-context,
 * or from GET /api/teams/organizations (list).
 */
export interface TeamContextFromAPI {
  organization_id?: number;
  organization_name?: string;
  location_id?: number;
  location_name?: string;
  role?: string;
  permissions?: Record<string, string>;
}

// ---------------------------------------------------------
// Fetch the user's team context.
// Strategy: call GET /api/teams/organizations (list of orgs
// the user belongs to). Pick the first org. This mirrors
// exactly what the website does.
// ---------------------------------------------------------
export async function fetchMyContext(): Promise<TeamContextFromAPI> {
  console.log('[Teams] Fetching my organizations list');
  const res = await apiClient.get<any>('/api/teams/organizations');
  const orgs = Array.isArray(res.data) ? res.data : (res.data?.organizations ?? res.data?.data ?? []);

  if (orgs.length === 0) {
    console.log('[Teams] User has no organizations');
    return {};
  }

  const first = orgs[0];
  return {
    organization_id: first.id,
    organization_name: first.name,
    role: first.my_role ?? first.role,
    location_id: first.location_id,
    location_name: first.location_name,
  };
}

// ---------------------------------------------------------
// Fetch full organization details (org + members + locations).
// Returns the complete OrgDetailsFromAPI so callers can use
// .organization, .members, .locations directly.
// ---------------------------------------------------------
export async function fetchOrganizationDetails(orgId: number | string): Promise<OrgDetailsFromAPI> {
  console.log('[Teams] Fetching organization details:', orgId);
  const res = await apiClient.get<any>(`/api/teams/organizations/${orgId}`);
  const data = res.data;

  // Backend returns { organization, my_role, members, locations }
  if (data && typeof data === 'object' && 'organization' in data) {
    return {
      organization: data.organization,
      my_role: data.my_role ?? 'member',
      members: Array.isArray(data.members) ? data.members : [],
      locations: Array.isArray(data.locations) ? data.locations : [],
    };
  }

  // Fallback: if the response is somehow just the org object
  return {
    organization: data as OrganizationFromAPI,
    my_role: 'member',
    members: [],
    locations: [],
  };
}

/**
 * @deprecated Use fetchOrganizationDetails() instead.
 * Kept for backward compat; extracts only the organization object.
 */
export async function fetchOrganization(orgId: number | string): Promise<OrganizationFromAPI> {
  const details = await fetchOrganizationDetails(orgId);
  return details.organization;
}

/**
 * @deprecated Use fetchOrganizationDetails() instead.
 * Kept for backward compat; extracts only the members array.
 */
export async function fetchOrganizationMembers(orgId: number | string): Promise<OrgMemberFromAPI[]> {
  const details = await fetchOrganizationDetails(orgId);
  return details.members;
}

// ---------------------------------------------------------
// Add a team member.
// Backend requires: email, name, password (mandatory).
// Optional: phone, role, restaurant_id, location_id, permissions.
// ---------------------------------------------------------
export async function addMember(
  orgId: number | string,
  payload: {
    email: string;
    name: string;
    password: string;
    phone?: string;
    role?: string;
    restaurant_id?: number | string;
    location_id?: number | string;
    permissions?: Record<string, string>;
  }
): Promise<any> {
  console.log('[Teams] Adding member:', payload.email, 'to org:', orgId);
  const res = await apiClient.post(`/api/teams/organizations/${orgId}/members`, payload);
  return res.data;
}

// ---------------------------------------------------------
// Update a member's role / permissions / status.
// memberId here is the membership_id (organization_members.id).
// ---------------------------------------------------------
export async function updateMember(
  orgId: number | string,
  memberId: number | string,
  updates: {
    role?: string;
    permissions?: Record<string, string>;
    status?: string;
    restaurant_id?: number | string;
  }
): Promise<any> {
  console.log('[Teams] Updating member:', memberId);
  const res = await apiClient.put(`/api/teams/organizations/${orgId}/members/${memberId}`, updates);
  return res.data;
}

// ---------------------------------------------------------
// Remove a member from the organization.
// memberId here is the membership_id (organization_members.id).
// ---------------------------------------------------------
export async function removeMember(orgId: number | string, memberId: number | string): Promise<void> {
  console.log('[Teams] Removing member:', memberId, 'from org:', orgId);
  await apiClient.delete(`/api/teams/organizations/${orgId}/members/${memberId}`);
}

// ---------------------------------------------------------
// Create a new organization.
// ---------------------------------------------------------
export async function createOrganization(data: {
  name: string;
  description?: string;
  category?: string;
  phone?: string;
}): Promise<OrganizationFromAPI> {
  console.log('[Teams] Creating organization:', data.name);
  const res = await apiClient.post<any>('/api/teams/organizations', data);
  const resData = res.data;
  // Backend returns the org row directly (with location_id appended)
  return resData as OrganizationFromAPI;
}

// ---------------------------------------------------------
// Add a new location to an organization.
// Backend endpoint: POST /api/teams/organizations/:orgId/locations
// ---------------------------------------------------------
export async function addLocation(
  orgId: number | string,
  payload: {
    name?: string;
    address?: string;
    phone?: string;
    category?: string;
    price_tier?: number;
    pickup_start_time?: string;
    pickup_end_time?: string;
  }
): Promise<OrgLocationFromAPI> {
  console.log('[Teams] Adding location to org:', orgId);
  const res = await apiClient.post<any>(`/api/teams/organizations/${orgId}/locations`, payload);
  const data = res.data;
  return (data?.location ?? data) as OrgLocationFromAPI;
}

// ---------------------------------------------------------
// Delete a location from an organization.
// Backend endpoint: DELETE /api/teams/organizations/:orgId/locations/:locationId
// ---------------------------------------------------------
export async function deleteLocation(orgId: number | string, locationId: number | string): Promise<void> {
  console.log('[Teams] Deleting location:', locationId, 'from org:', orgId);
  await apiClient.delete(`/api/teams/organizations/${orgId}/locations/${locationId}`);
}
