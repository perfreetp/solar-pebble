import type { Project, Role, Shot } from './types';

const DB_KEY = 'avw-db-v1';
const SESSION_KEY = 'avw-session-v1';

interface DB { projects: Project[]; shots: Shot[]; seeded: boolean; }

let db: DB = load();

function load(): DB {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch { /* ignore */ }
  return { projects: [], shots: [], seeded: false };
}

export function save(): void {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------- 项目 ---------------- */
export function listProjects(): Project[] {
  return [...db.projects].sort((a, b) => b.createdAt - a.createdAt);
}
export function getProject(id: string): Project | undefined {
  return db.projects.find(p => p.id === id);
}
export function createProject(p: Omit<Project, 'id' | 'reworkCount' | 'delivered' | 'createdAt'>): Project {
  const proj: Project = { ...p, id: uid(), reworkCount: 0, delivered: false, createdAt: Date.now() };
  db.projects.push(proj); save();
  return proj;
}
export function updateProject(p: Project): void { save(); }
export function deleteProject(id: string): void {
  db.projects = db.projects.filter(p => p.id !== id);
  db.shots = db.shots.filter(s => s.projectId !== id);
  save();
}

/* ---------------- 镜头 ---------------- */
export function listShots(projectId: string): Shot[] {
  return db.shots.filter(s => s.projectId === projectId);
}
export function getShot(id: string): Shot | undefined {
  return db.shots.find(s => s.id === id);
}
export function createShot(projectId: string, name: string, assignee: string): Shot {
  const shot: Shot = {
    id: uid(), projectId, name, assignee,
    status: '未开始', reviewComment: '', voxelData: '', voxelCount: 0, updatedAt: Date.now(),
  };
  db.shots.push(shot); save();
  return shot;
}
export function updateShot(s: Shot): void { s.updatedAt = Date.now(); save(); }
export function deleteShot(id: string): void {
  db.shots = db.shots.filter(s => s.id !== id); save();
}

/* ---------------- 会话(角色) ---------------- */
export interface Session { role: Role; userName: string; }
export function getSession(): Session {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as Session;
  } catch { /* ignore */ }
  return { role: 'customer', userName: '访客' };
}
export function setSession(s: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

/* ---------------- 体素数据编解码 ---------------- */
export function encodeVoxels(data: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < data.length; i += CHUNK) {
    bin += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
export function decodeVoxels(b64: string, size: number): Uint8Array {
  const out = new Uint8Array(size * size * size);
  if (!b64) return out;
  try {
    const bin = atob(b64);
    const n = Math.min(bin.length, out.length);
    for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
  } catch { /* ignore */ }
  return out;
}

/* ---------------- 演示数据 ---------------- */
export function seedIfEmpty(): void {
  if (db.seeded || db.projects.length > 0) return;
  db.seeded = true;
  const proj: Project = {
    id: uid(), name: '灵神星(16 Psyche)探测任务概念建模', customer: '深空探测总体部',
    brief: '为小行星探测任务概念设计提供灵神星外形模型:不规则金属质小天体,表面含陨石坑与碎石堆,用于环绕/着陆镜头预演。',
    deadline: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    voxelLimit: 60000, targetFaces: 20000, gridSize: 64,
    reworkCount: 0, delivered: false, createdAt: Date.now(),
  };
  db.projects.push(proj);
  const s1 = createShot(proj.id, '全景环绕镜头', '张工');
  const s2 = createShot(proj.id, '表面陨石坑特写', '李工');
  s2.status = '制作中';
  save();
  void s1; void s2;
}
