import { For, Show, createMemo } from 'solid-js';
import type { PartDef } from '../../shared/types';

/** Small isometric thumbnail for the parts library. */
export function PartThumb(props: { def: PartDef; size?: number }) {
  const s = () => props.size ?? 34;
  const color = () => props.def.color;
  const shade = (amt: number) => {
    const n = parseInt(color().replace('#', ''), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  };

  return (
    <svg width={s()} height={s()} viewBox="0 0 40 36" style={{ 'pointer-events': 'none' }}>
      <Show when={props.def.shape === 'cyl'} fallback={<BoxGlyph color={color()} shade={shade} tall={props.def.size.h > props.def.size.w} />}>
        <CylGlyph color={color()} shade={shade} vertical={props.def.size.h > Math.max(props.def.size.w, props.def.size.d)} />
      </Show>
    </svg>
  );
}

function BoxGlyph(props: { color: string; shade: (a: number) => string; tall?: boolean }) {
  const top = () => (props.tall ? '11,8 29,14 29,28 11,22' : '9,12 27,8 33,16 15,20');
  return (
    <>
      <polygon points="15,20 33,16 33,25 15,29" fill={props.shade(-0.18)} opacity="0.95" />
      <polygon points="9,12 15,20 15,29 9,21" fill={props.shade(-0.38)} />
      <polygon points="9,12 27,8 33,16 15,20" fill={props.shade(0.16)} stroke={props.shade(-0.25)} stroke-width="0.5" />
      <polygon points="9,12 27,8 33,16 15,20" fill="none" stroke={props.shade(-0.3)} stroke-width="0.6" opacity="0.7" />
    </>
  );
}

function CylGlyph(props: { color: string; shade: (a: number) => string; vertical?: boolean }) {
  if (props.vertical) {
    return (
      <>
        <path d="M14 8 Q14 5 20 5 Q26 5 26 8 L26 27 Q26 30 20 30 Q14 30 14 27 Z" fill={props.shade(0)} />
        <ellipse cx="20" cy="8" rx="6" ry="2.6" fill={props.shade(0.22)} stroke={props.shade(-0.3)} stroke-width="0.5" />
        <ellipse cx="20" cy="8" rx="2.6" ry="1.1" fill={props.shade(-0.15)} opacity="0.7" />
        <path d="M15.4 9 L15.4 27" stroke={props.shade(0.32)} stroke-width="1.5" opacity="0.5" stroke-linecap="round" />
        <path d="M14 27 Q14 30 20 30 Q26 30 26 27" fill="none" stroke={props.shade(-0.25)} stroke-width="0.6" />
      </>
    );
  }
  return (
    <>
      <path d="M8 17 L27 12 L32 14 L13 20 Z" fill={props.shade(0)} />
      <path d="M8 17 L13 20 L13 24 L8 21 Z" fill={props.shade(-0.34)} />
      <path d="M13 20 L32 14 L32 18 L13 24 Z" fill={props.shade(-0.14)} />
      <ellipse cx="29.5" cy="16" rx="2.6" ry="4.4" transform="rotate(-15 29.5 16)" fill={props.shade(0.2)} stroke={props.shade(-0.28)} stroke-width="0.5" />
      <ellipse cx="29.5" cy="16" rx="1.1" ry="2" transform="rotate(-15 29.5 16)" fill={props.shade(-0.12)} opacity="0.7" />
      <path d="M9.5 16.4 L28.5 11.4" stroke={props.shade(0.35)} stroke-width="1.2" opacity="0.45" stroke-linecap="round" />
    </>
  );
}

/** Category swatch dot. */
export function CatDot(props: { color: string }) {
  return <span class="tree-dot" style={{ background: props.color }} />;
}

/** Deterministic small LCG for repeatable jitter, used for wood grain etc. */
export function seeded(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function EmptyState(props: { icon: string; title: string; hint?: string }) {
  return (
    <div class="empty-state">
      <div class="big">{props.icon}</div>
      <div style={{ color: 'var(--text-dim)', 'margin-bottom': '4px' }}>{props.title}</div>
      <Show when={props.hint}>
        <div style={{ 'font-size': '11px' }}>{props.hint}</div>
      </Show>
    </div>
  );
}
