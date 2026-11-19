import type {
  BOMData,
  InterferencePair,
  SceneData,
  TopViewData,
  VersionDetail,
  VersionSummary,
  VersionStatus,
} from '../../shared/types';

let userId = 'u-li';

export function setUserId(id: string) {
  userId = id;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`) as Error & { code?: string; status?: number };
    err.code = data?.error;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export const api = {
  bootstrap: () => req<{ users: any[]; me: any }>('GET', '/api/bootstrap'),
  listVersions: (status?: VersionStatus) =>
    req<VersionSummary[]>('GET', `/api/versions${status ? `?status=${status}` : ''}`),
  getVersion: (id: number) => req<VersionDetail>('GET', `/api/versions/${id}`),
  createVersion: (payload: { name: string; note?: string; scene: SceneData }) =>
    req<{ id: number }>('POST', '/api/versions', payload),
  updateVersion: (id: number, payload: { name?: string; note?: string; scene: SceneData }) =>
    req<{ ok: true }>('PUT', `/api/versions/${id}`, payload),
  submitVersion: (id: number) => req<{ ok: true }>('POST', `/api/versions/${id}/submit`),
  reviewVersion: (id: number, decision: 'approve' | 'reject', reason?: string) =>
    req<{ ok: true; status: VersionStatus }>('POST', `/api/versions/${id}/review`, { decision, reason }),
  getLog: (id: number) => req<any[]>('GET', `/api/versions/${id}/log`),
  share: (id: number) => req<{ token: string }>('POST', `/api/versions/${id}/share`),
  unshare: (id: number) => req<{ ok: true }>('DELETE', `/api/versions/${id}/share`),
};

export async function fetchShare(token: string): Promise<{
  project: string;
  name: string;
  created_at: string;
  reviewed_at: string;
  topview: TopViewData;
  bom: BOMData;
}> {
  const res = await fetch(`/api/share/${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? '链接无效');
  return data;
}

export function interferenceSummary(report: InterferencePair[]) {
  return { count: report.length, volume: report.reduce((s, r) => s + r.volume, 0) };
}
