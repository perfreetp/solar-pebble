<script>
  import { versions } from '../lib/stores/versions.js';
  import VoxelViewport from '../components/VoxelViewport.svelte';

  let data = $state(versions.data);
  $effect(() => versions.subscribe((d) => (data = d)));

  let selectedId = $state(null);
  let role = $state('reviewer'); // reviewer | maker
  let authorName = $state('蜻蜓老师');
  let replyName = $state('小甲');
  let draft = $state('');
  let replyDrafts = $state({}); // annotationId -> text
  let pendingPos = $state(null);
  let activeAnnotationId = $state(null);
  let showGrid = $state(true);
  let cameraMode = $state('perspective');

  // 默认选中最新版本(在派生值里兜底,避免只捕获初始快照)
  const current = $derived(
    data.versions.find((v) => v.id === selectedId) ?? data.versions.at(-1)
  );

  function switchRole(r) {
    role = r;
    authorName = r === 'reviewer' ? '蜻蜓老师' : '小甲';
  }

  function onEmptyTap(cell) {
    if (role !== 'reviewer') return;
    if (!cell) return;
    pendingPos = { x: cell.x, y: cell.y, z: cell.z };
  }

  function addAnnotation() {
    if (!pendingPos || !draft.trim()) return;
    versions.addAnnotation(current.id, pendingPos, authorName, draft.trim());
    draft = '';
    pendingPos = null;
  }

  function reply(aid) {
    const text = (replyDrafts[aid] || '').trim();
    if (!text) return;
    versions.replyAnnotation(current.id, aid, replyName, text);
    replyDrafts[aid] = '';
  }

  function fmt(ts) {
    return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="review">
  <!-- 左:版本列表 -->
  <aside class="panel side">
    <h2>版本列表</h2>
    <div class="col">
      {#each [...data.versions].reverse() as v (v.id)}
        <button class="vcard" class:active={current?.id === v.id} onclick={() => (selectedId = v.id)}>
          <div class="row between">
            <strong>v{v.no} {v.name}</strong>
            <span class="tag {v.annotations.some(a => !a.resolved) ? 'warn' : 'ok'}">
              {v.annotations.filter(a => !a.resolved).length} 待处理
            </span>
          </div>
          <div class="muted small">{fmt(v.createdAt)} · 批注 {v.annotations.length} 条</div>
          {#if v.note}<div class="small note">📝 {v.note}</div>{/if}
        </button>
      {/each}
    </div>
  </aside>

  <!-- 中:3D 审核画面 -->
  <section class="stage panel">
    <div class="stage-head">
      <strong>{current ? `v${current.no} ${current.name}` : ''}</strong>
      <div class="row">
        <button class:active={role === 'reviewer'} onclick={() => switchRole('reviewer')}>审核人模式</button>
        <button class:active={role === 'maker'} onclick={() => switchRole('maker')}>制作方模式</button>
        <button class:active={cameraMode === 'perspective'} onclick={() => (cameraMode = 'perspective')}>透视</button>
        <button class:active={cameraMode === 'ortho'} onclick={() => (cameraMode = 'ortho')}>正交</button>
        <button onclick={() => (showGrid = !showGrid)}>{showGrid ? '隐藏网格' : '显示网格'}</button>
      </div>
    </div>
    <div class="canvas-wrap">
      {#if current}
        <VoxelViewport
          voxels={current.voxels}
          interactive={false}
          readonly={role !== 'reviewer'}
          showGrid={showGrid}
          cameraMode={cameraMode}
          annotations={current.annotations}
          onEmptyTap={onEmptyTap}
          onAnnotationClick={(a) => (activeAnnotationId = a.id)}
        />
      {/if}
      {#if pendingPos}
        <div class="pin-draft toast">
          📍 落点 ({pendingPos.x}, {pendingPos.y}, {pendingPos.z}),写批注后保存
          <button onclick={() => (pendingPos = null)}>取消</button>
        </div>
      {/if}
      {#if role === 'reviewer' && !pendingPos}
        <div class="hint-bubble">点击模型旁的空白处即可在该位置放置批注图钉 📌</div>
      {/if}
    </div>
  </section>

  <!-- 右:批注与回复 -->
  <aside class="panel side right">
    <h2>批注线程</h2>
    {#if role === 'reviewer'}
      <div class="col composer">
        <h3>以「{authorName}」身份写新批注</h3>
        <textarea rows="3" placeholder="说说这个位置需要怎么改…" bind:value={draft} disabled={!pendingPos}></textarea>
        <button class="primary" onclick={addAnnotation} disabled={!pendingPos || !draft.trim()}>保存批注到落点</button>
      </div>
    {/if}

    <div class="threads">
      {#each current?.annotations ?? [] as a (a.id)}
        <div class="thread" class:resolved={a.resolved} class:hot={activeAnnotationId === a.id}>
          <div class="row between">
            <strong>📍 ({a.pos.x}, {a.pos.y}, {a.pos.z})</strong>
            <span class="tag {a.resolved ? 'ok' : 'warn'}">{a.resolved ? '已处理' : '待处理'}</span>
          </div>
          <div class="bubble reviewer">
            <div class="meta">{a.author} · {fmt(a.createdAt)}</div>
            {a.text}
          </div>
          {#each a.replies as r (r.id)}
            <div class="bubble maker">
              <div class="meta">{r.author} · {fmt(r.createdAt)}</div>
              {r.text}
            </div>
          {/each}
          {#if role === 'maker'}
            <div class="reply-box">
              <textarea rows="2" placeholder="逐条回复处理意见…" bind:value={replyDrafts[a.id]}></textarea>
              <div class="row end">
                <button onclick={() => versions.toggleResolved(current.id, a.id)}>
                  {a.resolved ? '重新打开' : '标记已处理'}
                </button>
                <button class="primary" onclick={() => reply(a.id)}>回复</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
      {#if !current?.annotations?.length}
        <p class="muted">还没有批注。切换到审核人模式,在画面上点一个位置开始。</p>
      {/if}
    </div>
  </aside>
</div>

<style>
  .review { display: grid; grid-template-columns: 240px 1fr 340px; gap: 12px; height: 100%; min-height: 0; }
  .side { padding: 12px; overflow-y: auto; }
  .vcard { text-align: left; display: flex; flex-direction: column; gap: 4px; }
  .vcard.active { border-color: var(--brand); background: #f2faf8; }
  .between { justify-content: space-between; }
  .small { font-size: 12px; }
  .note { color: var(--ink-soft); }
  .stage { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .stage-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .canvas-wrap { flex: 1; position: relative; min-height: 0; padding: 10px; }
  .composer { background: #f7fbfd; border: 1px dashed var(--line); border-radius: 12px; padding: 10px; margin-bottom: 12px; }
  .thread { border: 1px solid var(--line); border-radius: 12px; padding: 10px; margin-bottom: 10px; }
  .thread.resolved { opacity: .7; background: #f6f8fa; }
  .thread.hot { outline: 2px solid rgba(233,30,99,.4); }
  .bubble { border-radius: 10px; padding: 8px 10px; margin: 8px 0; font-size: 13px; }
  .bubble.reviewer { background: #fdeaf1; }
  .bubble.maker { background: #e9f5f2; margin-left: 18px; }
  .meta { font-size: 11px; color: var(--ink-soft); margin-bottom: 3px; }
  .reply-box { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
  .end { justify-content: flex-end; }
  .toast {
    position: absolute; top: 22px; left: 50%; transform: translateX(-50%);
    background: rgba(36,52,71,.9); color: #fff; padding: 8px 16px;
    border-radius: 999px; font-size: 13px; z-index: 5; display: flex; gap: 10px; align-items: center;
  }
  .hint-bubble {
    position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%);
    background: rgba(255,138,61,.95); color: #fff; padding: 7px 16px;
    border-radius: 999px; font-size: 13px;
  }
</style>
