const rawBase = (import.meta.env.VITE_API_BASE_URL || '').trim();

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

// Default to the same host on backend port for local usage when no env override is set.
export const API_BASE_URL = stripTrailingSlash(
  rawBase || `${window.location.protocol}//${window.location.hostname}:3001`
);

export const API_PREFIX = `${API_BASE_URL}/api`;

export function apiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_PREFIX}${normalizedPath}`;
}

export function backendAssetUrl(pathOrUrl) {
  if (!pathOrUrl) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const normalizedPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export async function apiFetchJson(path, options = {}) {
  const url = apiUrl(path);
  
  // Ensure Content-Type is set for POST requests with body
  if (options.body && !options.headers) {
    options.headers = {};
  }
  if (options.body && options.headers) {
    options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
  }
  
  console.log('[API] Request:', options.method || 'GET', url, options.body ? JSON.parse(options.body) : '');
  
  const response = await fetch(url, options);
  
  // Try to get error details from response
  let errorBody = '';
  try {
    errorBody = await response.text();
  } catch (e) {
    errorBody = '(unable to read response)';
  }
  
  if (!response.ok) {
    console.error(`[API] Error ${response.status}: ${errorBody}`);
    throw new Error(`Request failed (${response.status}): ${errorBody.substring(0, 200)}`);
  }
  
  try {
    const data = JSON.parse(errorBody);
    console.log('[API] Response:', data);
    return data;
  } catch (e) {
    throw new Error(`Failed to parse response: ${errorBody}`);
  }
}