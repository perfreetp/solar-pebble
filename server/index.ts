import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, USERS, userById, nowISO } from './db';
import type { SceneData } from '../shared/types';
import { makeBOM, computeTopView, computeInterference } from '../shared/geometry';

const app = express();
app.use(express.json({ limit: '12mb' }));

const ROOT = process.cwd();
const PORT = Number(process.env.PORT ?? 9077);

function currentUser(req: express.Request) {
  const id = String(req.header('x-user-id') ?? 'u-li');
  return userById(id) ?? USERS[0];
}

function requireRole(req: express.Request, res: express.Response, role: 'designer' | 'supervisor'): boolean {
  const u = currentUser(req);
  if (u.role !== role) {
    res.status(403).json({ error: 'forbidden', message: role === 'supervisor' ? '仅主管可执行此操作' : '仅工艺员可执行此操作' });
    return false;
  }
  return true;
}

function displayName(id: string | null | undefined): string | null {
  if (!id) return null;
  return userById(id)?.name ?? id;
}

function summaryRow(r: any) {
  return {
    id: r.id,
    project: r.project,
    name: r.name,
    status: r.status,
    created_by: displayName(r.created_by),
    created_by_id: r.created_by,
    created_at: r.created_at,
    submitted_at: r.submitted_at,
    reviewed_at: r.reviewed_at,
    reviewer: displayName(r.reviewer),
    reviewer_id: r.reviewer,
    review_reason: r.review_reason,
    share_token: r.share_token,
    note: r.note,
    thumb: JSON.parse(r.topview),
    part_count: r.part_count,
    weight: r.weight,
    interference: JSON.parse(r.report).length,
  };
}

// ---- bootstrap ----
app.get('/api/bootstrap', (req, res) => {
  res.json({ users: USERS, me: currentUser(req) });
});

// ---- versions ----
app.get('/api/versions', (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const rows = status
    ? db.prepare('SELECT * FROM versions WHERE status = ? ORDER BY id DESC').all(status)
    : db.prepare('SELECT * FROM versions ORDER BY id DESC').all();
  res.json(rows.map(summaryRow));
});

app.get('/api/versions/:id', (req, res) => {
  const r: any = db.prepare('SELECT * FROM versions WHERE id = ?').get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json({
    ...summaryRow(r),
    scene: JSON.parse(r.scene),
    bom: JSON.parse(r.bom),
    topview: JSON.parse(r.topview),
    report: JSON.parse(r.report),
  });
});

function computePayload(scene: SceneData) {
  const bom = makeBOM(scene);
  const topview = computeTopView(scene);
  const report = computeInterference(scene);
  return { bom, topview, report };
}

app.post('/api/versions', (req, res) => {
  if (!requireRole(req, res, 'designer')) return;
  const u = currentUser(req);
  const { name, note, scene } = req.body ?? {};
  if (!scene || !Array.isArray(scene.entities)) return res.status(400).json({ error: 'bad_scene' });
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name_required', message: '请填写版本名称' });
  const { bom, topview, report } = computePayload(scene);
  const now = nowISO();
  const result = db
    .prepare(
      `INSERT INTO versions (project, project_code, name, status, created_by, created_at, note, scene, bom, topview, report, part_count, weight)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      scene.project ?? '未命名项目',
      scene.projectCode ?? '',
      String(name).trim(),
      u.id,
      now,
      note ? String(note) : null,
      JSON.stringify(scene),
      JSON.stringify(bom),
      JSON.stringify(topview),
      JSON.stringify(report),
      bom.totalParts,
      bom.totalWeight,
    );
  const id = Number(result.lastInsertRowid);
  db.prepare('INSERT INTO review_log (version_id, action, actor, reason, at) VALUES (?, ?, ?, ?, ?)').run(id, 'save', u.id, null, now);
  res.status(201).json({ id });
});

app.put('/api/versions/:id', (req, res) => {
  if (!requireRole(req, res, 'designer')) return;
  const u = currentUser(req);
  const id = Number(req.params.id);
  const r: any = db.prepare('SELECT * FROM versions WHERE id = ?').get(id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.status !== 'draft' && r.status !== 'rejected') {
    return res.status(409).json({ error: 'locked', message: '该版本已提交，不能再修改，请另存新版本' });
  }
  const { name, note, scene } = req.body ?? {};
  if (!scene || !Array.isArray(scene.entities)) return res.status(400).json({ error: 'bad_scene' });
  const { bom, topview, report } = computePayload(scene);
  db.prepare(
    `UPDATE versions SET name = ?, note = ?, scene = ?, bom = ?, topview = ?, report = ?, part_count = ?, weight = ? WHERE id = ?`,
  ).run(
    name ? String(name).trim() : r.name,
    note != null ? String(note) : r.note,
    JSON.stringify(scene),
    JSON.stringify(bom),
    JSON.stringify(topview),
    JSON.stringify(report),
    bom.totalParts,
    bom.totalWeight,
    id,
  );
  db.prepare('INSERT INTO review_log (version_id, action, actor, reason, at) VALUES (?, ?, ?, ?, ?)').run(id, 'save', u.id, null, nowISO());
  res.json({ ok: true });
});

app.post('/api/versions/:id/submit', (req, res) => {
  if (!requireRole(req, res, 'designer')) return;
  const u = currentUser(req);
  const id = Number(req.params.id);
  const r: any = db.prepare('SELECT * FROM versions WHERE id = ?').get(id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.status !== 'draft' && r.status !== 'rejected') {
    return res.status(409).json({ error: 'bad_state', message: '当前状态不能提交' });
  }
  const now = nowISO();
  db.prepare("UPDATE versions SET status = 'submitted', submitted_at = ?, reviewed_at = NULL, reviewer = NULL, review_reason = NULL WHERE id = ?").run(now, id);
  db.prepare('INSERT INTO review_log (version_id, action, actor, reason, at) VALUES (?, ?, ?, ?, ?)').run(id, 'submit', u.id, null, now);
  res.json({ ok: true });
});

app.post('/api/versions/:id/review', (req, res) => {
  if (!requireRole(req, res, 'supervisor')) return;
  const u = currentUser(req);
  const id = Number(req.params.id);
  const { decision, reason } = req.body ?? {};
  if (decision !== 'approve' && decision !== 'reject') return res.status(400).json({ error: 'bad_decision' });
  const r: any = db.prepare('SELECT * FROM versions WHERE id = ?').get(id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.status !== 'submitted') return res.status(409).json({ error: 'bad_state', message: '仅待评审版本可审批' });
  if (decision === 'reject' && !String(reason ?? '').trim()) {
    return res.status(400).json({ error: 'reason_required', message: '退回必须填写原因' });
  }
  const now = nowISO();
  const status = decision === 'approve' ? 'approved' : 'rejected';
  db.prepare('UPDATE versions SET status = ?, reviewer = ?, reviewed_at = ?, review_reason = ? WHERE id = ?').run(
    status,
    u.id,
    now,
    decision === 'reject' ? String(reason).trim() : null,
    id,
  );
  db.prepare('INSERT INTO review_log (version_id, action, actor, reason, at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    decision === 'approve' ? 'approve' : 'reject',
    u.id,
    decision === 'reject' ? String(reason).trim() : null,
    now,
  );
  res.json({ ok: true, status });
});

app.get('/api/versions/:id/log', (req, res) => {
  const rows = db.prepare('SELECT * FROM review_log WHERE version_id = ? ORDER BY id ASC').all(Number(req.params.id));
  res.json(rows);
});

// ---- share links ----
app.post('/api/versions/:id/share', (req, res) => {
  const id = Number(req.params.id);
  const r: any = db.prepare('SELECT * FROM versions WHERE id = ?').get(id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  const u = currentUser(req);
  if (r.created_by !== u.id && u.role !== 'supervisor') {
    return res.status(403).json({ error: 'forbidden' });
  }
  let token = r.share_token;
  if (!token) {
    token = crypto.randomBytes(9).toString('base64url');
    db.prepare('UPDATE versions SET share_token = ? WHERE id = ?').run(token, id);
  }
  res.json({ token });
});

app.delete('/api/versions/:id/share', (req, res) => {
  const id = Number(req.params.id);
  const r: any = db.prepare('SELECT * FROM versions WHERE id = ?').get(id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  db.prepare('UPDATE versions SET share_token = NULL WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Public read-only payload for customers: top view + BOM only.
app.get('/api/share/:token', (req, res) => {
  const r: any = db.prepare('SELECT * FROM versions WHERE share_token = ?').get(String(req.params.token));
  if (!r) return res.status(404).json({ error: 'not_found' });
  if (r.status !== 'approved') {
    return res.status(409).json({ error: 'not_approved', message: '该方案尚未通过主管评审，暂不可对外分享' });
  }
  res.json({
    project: r.project,
    name: r.name,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
    topview: JSON.parse(r.topview),
    bom: JSON.parse(r.bom),
  });
});

// ---- static client ----
const clientDist = path.join(ROOT, 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[kd-studio] API listening on http://localhost:${PORT}`);
});
