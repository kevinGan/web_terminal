const KEY = 'wt_token';

function fromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const t = params.get('token');
  if (!t) return null;
  return t.trim();
}

export function getToken(): string {
  const fromUrlVal = fromUrl();
  if (fromUrlVal) {
    sessionStorage.setItem(KEY, fromUrlVal);
    // Clean URL so the token doesn't sit in browser history
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
    return fromUrlVal;
  }
  return sessionStorage.getItem(KEY) ?? '';
}

export function clearToken(): void {
  sessionStorage.removeItem(KEY);
}

export function setStoredToken(tok: string): void {
  if (tok) sessionStorage.setItem(KEY, tok);
  else sessionStorage.removeItem(KEY);
}
