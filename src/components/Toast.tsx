import { createSignal, For, onCleanup } from 'solid-js';

export interface Toast {
  id: number;
  kind: 'info' | 'good' | 'bad' | 'warn';
  text: string;
}

const [toasts, setToasts] = createSignal<Toast[]>([]);
let seq = 0;

export function toast(text: string, kind: Toast['kind'] = 'info', ttl = 3600) {
  seq += 1;
  const id = seq;
  setToasts((t) => [...t, { id, kind, text }]);
  setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
}

export function ToastStack() {
  onCleanup(() => setToasts([]));
  return (
    <div class="toast-stack">
      <For each={toasts()}>
        {(t) => <div class={`toast ${t.kind}`}>{t.text}</div>}
      </For>
    </div>
  );
}

const BATCH_STATUS_TEXT: Record<string, string> = {
  checking: '自动检查中',
  pending_review: '待复核',
  released: '已放行',
  returned: '已退回',
};

export function BatchStatusTag(props: { status: string }) {
  const cls =
    props.status === 'released'
      ? 'ok'
      : props.status === 'returned'
        ? 'severe'
        : props.status === 'checking'
          ? 'purple'
          : 'notice';
  return <span class={`tag ${cls}`}>{BATCH_STATUS_TEXT[props.status] ?? props.status}</span>;
}

export function ItemStatusTag(props: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending: ['gray', '待复核'],
    approved: ['ok', '已确认'],
    rejected: ['severe', '已驳回'],
  };
  const [cls, text] = map[props.status] ?? ['gray', props.status];
  return <span class={`tag ${cls}`}>{text}</span>;
}

export function IssueStatusTag(props: { status: string }) {
  const map: Record<string, [string, string]> = {
    open: ['notice', '待处理'],
    confirmed: ['ok', '已确认'],
    rejected: ['severe', '已驳回'],
  };
  const [cls, text] = map[props.status] ?? ['gray', props.status];
  return <span class={`tag ${cls}`}>{text}</span>;
}
