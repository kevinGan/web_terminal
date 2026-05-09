import { http } from './http';

export type ChangeKind = 'staged' | 'unstaged' | 'untracked';
export type ChangeStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?';

export interface ChangeEntry {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  adds?: number;
  dels?: number;
}

export interface GitStatusResponse {
  isRepo: boolean;
  cwd: string;
  root?: string;
  branch?: string;
  head?: string;
  staged: ChangeEntry[];
  unstaged: ChangeEntry[];
  untracked: ChangeEntry[];
  error?: string;
}

export interface GitDiffResponse {
  path: string;
  kind: ChangeKind;
  binary?: boolean;
  truncated?: boolean;
  patch: string;
}

export const gitApi = {
  status: (cwd: string) =>
    http.get<GitStatusResponse>(`/api/git/status?cwd=${encodeURIComponent(cwd)}`),
  diff: (cwd: string, file: string, kind: ChangeKind) =>
    http.get<GitDiffResponse>(
      `/api/git/diff?cwd=${encodeURIComponent(cwd)}&file=${encodeURIComponent(file)}&kind=${kind}`
    )
};
