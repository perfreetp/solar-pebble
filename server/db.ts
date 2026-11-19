import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type Role = 'designer' | 'supervisor';

export interface User {
  id: string;
  name: string;
  role: Role;
  org: string;
}

export const USERS: User[] = [
  { id: 'u-li', name: '李工', role: 'designer', org: '拼装工艺组' },
  { id: 'u-zhang', name: '张主管', role: 'supervisor', org: '生产管理部' },
  { id: 'u-chen', name: '陈工', role: 'designer', org: '拼装工艺组' },
];

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'kd-studio.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    project_code TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft','submitted','approved','rejected')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    submitted_at TEXT,
    reviewed_at TEXT,
    reviewer TEXT,
    review_reason TEXT,
    share_token TEXT,
    note TEXT,
    scene TEXT NOT NULL,
    bom TEXT NOT NULL,
    topview TEXT NOT NULL,
    report TEXT NOT NULL,
    part_count INTEGER NOT NULL DEFAULT 0,
    weight REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS review_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    reason TEXT,
    at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_versions_status ON versions(status, id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_share ON versions(share_token);
`);

export function nowISO(): string {
  return new Date().toISOString();
}

export function userById(id: string | undefined): User | null {
  return USERS.find((u) => u.id === id) ?? null;
}
