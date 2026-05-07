import { getToken } from './token';

class HttpError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`HTTP ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers });
  let body: unknown = null;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) body = await res.json();
  else body = await res.text();
  if (!res.ok) throw new HttpError(res.status, body);
  return body as T;
}

export const http = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body == null ? undefined : JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' })
};

export { HttpError };

export interface Bookmark { id: string; label: string; path: string; addedAt: number; }
export interface Snippet { id: string; label: string; command: string; addedAt: number; }
export interface CdHistoryEntry { path: string; count: number; lastUsed: number; }
export interface FileEntry { name: string; path: string; type: 'dir' | 'file' | 'symlink' | 'other'; size?: number; mtimeMs?: number; }

export interface PersistedWorkspace {
  schemaVersion: number;
  tabs: unknown[];
  activeTabId: string;
  idCounter: number;
}

export const api = {
  bookmarks: {
    list: () => http.get<Bookmark[]>('/api/bookmarks'),
    add: (path: string, label?: string) => http.post<{ bookmark: Bookmark; all: Bookmark[] }>('/api/bookmarks', { path, label }),
    remove: (id: string) => http.del<{ all: Bookmark[] }>(`/api/bookmarks/${id}`),
    rename: (id: string, label: string) => http.put<{ all: Bookmark[] }>(`/api/bookmarks/${id}`, { label })
  },
  snippets: {
    list: () => http.get<Snippet[]>('/api/snippets'),
    add: (command: string, label?: string) => http.post<{ snippet: Snippet; all: Snippet[] }>('/api/snippets', { command, label }),
    remove: (id: string) => http.del<{ all: Snippet[] }>(`/api/snippets/${id}`)
  },
  history: {
    cd: (limit = 30) => http.get<{ entries: CdHistoryEntry[]; file: string }>(`/api/history/cd?limit=${limit}`)
  },
  files: {
    list: (path: string, showHidden = false) =>
      http.get<{ path: string; parent: string; entries: FileEntry[] }>(
        `/api/files?path=${encodeURIComponent(path)}${showHidden ? '&showHidden=1' : ''}`
      ),
    read: (path: string) =>
      http.get<{ name: string; path: string; size: number; content?: string; binary?: boolean }>(
        `/api/files/read?path=${encodeURIComponent(path)}`
      ),
    roots: () => http.get<{ roots: string[] }>('/api/files/roots')
  },
  state: {
    load: () => http.get<PersistedWorkspace>('/api/state'),
    save: (state: PersistedWorkspace) => http.put<{ ok: true }>('/api/state', state)
  }
};
