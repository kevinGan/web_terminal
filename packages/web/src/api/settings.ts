import { http } from './http';

export interface TokenInfo {
  token: string;
  enabled: boolean;
}

export interface ConnectionInfo {
  host: string;
  port: number;
  ip: string;
  url: string;
}

export const settingsApi = {
  getToken: () => http.get<TokenInfo>('/api/settings/token'),
  setToken: (token: string) => http.put<{ ok: true; token: string }>('/api/settings/token', { token }),
  rotateToken: () => http.post<{ ok: true; token: string }>('/api/settings/token/rotate'),
  getConnection: () => http.get<ConnectionInfo>('/api/connection')
};
