import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'barakeat_auth_token';
const USER_KEY = 'barakeat_user';

export async function saveToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    console.log('[Session] Token saved');
  } catch (err) {
    console.log('[Session] Failed to save token:', err);
  }
}

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch (err) {
    console.log('[Session] Failed to get token:', err);
    return null;
  }
}

export async function removeToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    console.log('[Session] Token removed');
  } catch (err) {
    console.log('[Session] Failed to remove token:', err);
  }
}

export async function saveUser(user: object): Promise<void> {
  try {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    console.log('[Session] User saved');
  } catch (err) {
    console.log('[Session] Failed to save user:', err);
  }
}

export async function getUser<T>(): Promise<T | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    if (raw) {
      return JSON.parse(raw) as T;
    }
    return null;
  } catch (err) {
    console.log('[Session] Failed to get user:', err);
    return null;
  }
}

export async function removeUser(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(USER_KEY);
    console.log('[Session] User removed');
  } catch (err) {
    console.log('[Session] Failed to remove user:', err);
  }
}

export async function clearSession(): Promise<void> {
  await removeToken();
  await removeUser();
  console.log('[Session] Session cleared');
}
