// Web Component 基类：Shadow DOM + store 订阅 + 轻量重渲染
import { store } from '../core/store';

const memo = new WeakMap<HTMLElement, string>();

export abstract class BaseComponent extends HTMLElement {
  protected shadow: ShadowRoot;
  private unsub: (() => void) | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.unsub = store.subscribe(() => this.scheduleRender());
    this.scheduleRender();
  }

  disconnectedCallback(): void {
    this.unsub?.();
    this.unsub = null;
  }

  /** 数据驱动重绘：浅比较 html 字符串，避免输入框焦点丢失 */
  protected scheduleRender(): void {
    const html = this.render();
    if (memo.get(this) === html) return;
    memo.set(this, html);
    this.shadow.innerHTML = html;
    this.afterRender();
    this.onRendered();
  }

  protected forceRender(): void {
    memo.delete(this);
    this.scheduleRender();
  }

  protected abstract render(): string;

  protected afterRender(): void {
    // 子类按需绑定事件
  }

  /** 每次 innerHTML 重绘完成后调用（用于重挂 canvas 等易失资源） */
  protected onRendered(): void {}

  protected $<T extends HTMLElement = HTMLElement>(sel: string): T | null {
    return this.shadow.querySelector<T>(sel);
  }

  protected $all(sel: string): HTMLElement[] {
    return [...this.shadow.querySelectorAll<HTMLElement>(sel)];
  }
}

export function toast(msg: string, duration = 2600): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration);
}
