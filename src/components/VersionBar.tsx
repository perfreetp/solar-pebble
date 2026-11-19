import { createSignal, For, Show, type JSX } from 'solid-js';
import { appStore } from '../store';

/** 顶部版本栏：版本切换、提交新版本、进入对比 */
export function VersionBar(): JSX.Element {
  const [showSubmit, setShowSubmit] = createSignal(false);
  const [label, setLabel] = createSignal('');
  const [note, setNote] = createSignal('');
  const [left, setLeft] = createSignal(appStore.state.compareLeftId ?? '');
  const [right, setRight] = createSignal(appStore.state.compareRightId ?? '');

  const submit = () => {
    if (!label().trim()) return;
    appStore.submitNewVersion(label().trim(), note().trim() || '无备注');
    setLabel('');
    setNote('');
    setShowSubmit(false);
  };

  return (
    <div class="version-bar">
      <div class="brand">🚀 发射场布局审片</div>
      <div class="version-tabs">
        <For each={appStore.state.versions}>
          {(v) => (
            <button
              class="version-tab"
              classList={{ active: !appStore.state.compareMode && appStore.state.activeVersionId === v.id }}
              onClick={() => appStore.selectVersion(v.id)}
              title={v.note}
            >
              {v.label}
              <span class="version-date">{v.createdAt.slice(5, 10)}</span>
            </button>
          )}
        </For>
      </div>
      <div class="version-actions">
        <button class="btn-small" onClick={() => setShowSubmit((s) => !s)}>
          ＋ 提交新版本
        </button>
        <Show when={!appStore.state.compareMode}>
          <button
            class="btn-small btn-primary"
            disabled={appStore.state.versions.length < 2}
            onClick={() => appStore.enterCompare(left() || appStore.state.versions[0]!.id, right() || appStore.state.versions[1]!.id)}
          >
            并排对比
          </button>
        </Show>
        <Show when={appStore.state.compareMode}>
          <button class="btn-small btn-danger" onClick={() => appStore.exitCompare()}>
            退出对比
          </button>
        </Show>
      </div>

      <Show when={showSubmit()}>
        <div class="popover">
          <div class="popover-title">提交审片新版本</div>
          <label class="form-label">版本名称</label>
          <input
            class="form-input"
            placeholder={`V${appStore.state.versions.length + 1} 修订版`}
            value={label()}
            onInput={(e) => setLabel(e.currentTarget.value)}
          />
          <label class="form-label">修订说明</label>
          <textarea
            class="form-input"
            rows="2"
            value={note()}
            onInput={(e) => setNote(e.currentTarget.value)}
            placeholder="本次提交的变更摘要…"
          />
          <div class="popover-actions">
            <button class="btn-small btn-primary" disabled={!label().trim()} onClick={submit}>
              生成快照
            </button>
            <button class="btn-small" onClick={() => setShowSubmit(false)}>
              取消
            </button>
          </div>
        </div>
      </Show>

      <Show when={appStore.state.compareMode}>
        <div class="compare-picker">
          <label>
            左（旧）
            <select value={left()} onChange={(e) => setLeft(e.currentTarget.value)}>
              <For each={appStore.state.versions}>
                {(v) => <option value={v.id}>{v.label}</option>}
              </For>
            </select>
          </label>
          <label>
            右（新）
            <select value={right()} onChange={(e) => setRight(e.currentTarget.value)}>
              <For each={appStore.state.versions}>
                {(v) => <option value={v.id}>{v.label}</option>}
              </For>
            </select>
          </label>
          <button
            class="btn-small btn-primary"
            onClick={() => appStore.enterCompare(left(), right())}
          >
            应用
          </button>
        </div>
      </Show>
    </div>
  );
}
