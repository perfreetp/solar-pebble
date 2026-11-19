import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildStarterScene } from '../shared/scene';

const PORT = 9188;
const BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let dataDir: string;

const H = (user: string) => ({ 'content-type': 'application/json', 'x-user-id': user });
const designer = 'u-li';
const supervisor = 'u-zhang';

async function waitForServer(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/bootstrap`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-test-'));
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer();
});

test.after(() => {
  server?.kill();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('bootstrap exposes designers and a supervisor', async () => {
  const r = await fetch(`${BASE}/api/bootstrap`);
  const b = await r.json();
  assert.ok(b.users.some((u: any) => u.role === 'supervisor'));
  assert.ok(b.users.some((u: any) => u.role === 'designer'));
});

test('designer saves a draft, supervisor reviews, customer reads the approved snapshot', async () => {
  const scene = buildStarterScene();
  let r = await fetch(`${BASE}/api/versions`, {
    method: 'POST', headers: H(designer),
    body: JSON.stringify({ name: 'V-测试-01', note: '联调', scene }),
  });
  assert.equal(r.status, 201);
  const { id } = await r.json();

  // draft appears in the list with computed BOM stats
  r = await fetch(`${BASE}/api/versions`);
  const list = await r.json();
  const draft = list.find((v: any) => v.id === id);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.part_count, scene.entities.length);

  // a supervisor cannot save a version (role guard)
  r = await fetch(`${BASE}/api/versions`, {
    method: 'POST', headers: H(supervisor),
    body: JSON.stringify({ name: 'x', scene }),
  });
  assert.equal(r.status, 403);

  // designer cannot self-approve
  r = await fetch(`${BASE}/api/versions/${id}/submit`, { method: 'POST', headers: H(designer) });
  assert.equal(r.status, 200);
  r = await fetch(`${BASE}/api/versions/${id}/review`, {
    method: 'POST', headers: H(designer),
    body: JSON.stringify({ decision: 'approve' }),
  });
  assert.equal(r.status, 403);

  // returning a submitted version requires a reason
  r = await fetch(`${BASE}/api/versions/${id}/review`, {
    method: 'POST', headers: H(supervisor),
    body: JSON.stringify({ decision: 'reject' }),
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'reason_required');

  // a proper rejection carries its reason back to the designer
  r = await fetch(`${BASE}/api/versions/${id}/review`, {
    method: 'POST', headers: H(supervisor),
    body: JSON.stringify({ decision: 'reject', reason: '通道宽度不足，请调整装箱区' }),
  });
  assert.equal(r.status, 200);
  r = await fetch(`${BASE}/api/versions/${id}`);
  let detail = await r.json();
  assert.equal(detail.status, 'rejected');
  assert.equal(detail.review_reason, '通道宽度不足，请调整装箱区');

  // resubmit and approve
  await fetch(`${BASE}/api/versions/${id}/submit`, { method: 'POST', headers: H(designer) });
  r = await fetch(`${BASE}/api/versions/${id}/review`, {
    method: 'POST', headers: H(supervisor),
    body: JSON.stringify({ decision: 'approve' }),
  });
  assert.equal(r.status, 200);

  // approved versions can be shared; the public payload is top view + BOM only
  r = await fetch(`${BASE}/api/versions/${id}/share`, { method: 'POST', headers: H(designer) });
  const { token } = await r.json();
  assert.ok(token && token.length > 6);
  r = await fetch(`${BASE}/api/share/${token}`);
  assert.equal(r.status, 200);
  const pub = await r.json();
  assert.ok(pub.topview && pub.bom);
  assert.equal(pub.scene, undefined, 'public payload must not leak the editable scene');
  assert.equal(pub.report, undefined, 'public payload must not leak the interference report');
  assert.equal(pub.bom.totalParts, scene.entities.length);

  // audit trail records the full life cycle in order
  r = await fetch(`${BASE}/api/versions/${id}/log`);
  const log = (await r.json()).map((x: any) => x.action);
  assert.deepEqual(log, ['save', 'submit', 'reject', 'submit', 'approve']);
});

test('unapproved versions are not shareable and unknown tokens 404', async () => {
  const scene = buildStarterScene();
  const r = await fetch(`${BASE}/api/versions`, {
    method: 'POST', headers: H(designer),
    body: JSON.stringify({ name: 'V-草稿', scene }),
  });
  const { id } = await r.json();
  const share = await fetch(`${BASE}/api/versions/${id}/share`, { method: 'POST', headers: H(designer) });
  const { token } = await share.json();
  const pub = await fetch(`${BASE}/api/share/${token}`);
  assert.equal(pub.status, 409, 'a draft link must not resolve to customer data');

  const missing = await fetch(`${BASE}/api/share/does-not-exist`);
  assert.equal(missing.status, 404);
});

test('submitted versions are locked against edits', async () => {
  const scene = buildStarterScene();
  const r = await fetch(`${BASE}/api/versions`, {
    method: 'POST', headers: H(designer),
    body: JSON.stringify({ name: 'V-锁', scene }),
  });
  const { id } = await r.json();
  await fetch(`${BASE}/api/versions/${id}/submit`, { method: 'POST', headers: H(designer) });
  const upd = await fetch(`${BASE}/api/versions/${id}`, {
    method: 'PUT', headers: H(designer),
    body: JSON.stringify({ scene }),
  });
  assert.equal(upd.status, 409);
});

test('version names are required', async () => {
  const r = await fetch(`${BASE}/api/versions`, {
    method: 'POST', headers: H(designer),
    body: JSON.stringify({ name: '   ', scene: buildStarterScene() }),
  });
  assert.equal(r.status, 400);
});
