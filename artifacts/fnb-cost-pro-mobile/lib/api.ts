import * as SecureStore from 'expo-secure-store';

const AUTH_TOKEN_KEY = 'fnb_auth_token';

export const API_BASE = process.env.EXPO_PUBLIC_DOMAIN 
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` 
  : '';

export async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Remove Content-Type if it's multipart (fetch sets it automatically with boundary)
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = 'An error occurred';
    try {
      const data = await response.json();
      message = data.error || data.message || message;
    } catch (e) {
      // Ignore JSON parse error if response is not JSON
    }
    throw new Error(message);
  }

  return response.json();
}
