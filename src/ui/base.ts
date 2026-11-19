/** 轻量 Web Component 基类: Shadow DOM + 声明式渲染 + 事件总线 */
export abstract class BaseElement extends HTMLElement {
  protected root: ShadowRoot;
  private renderQueued = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.onMount();
    this.invalidate();
  }

  disconnectedCallback(): void {
    this.onUnmount();
  }

  /** 子类可覆写的生命周期钩子 */
  protected onMount(): void {}
  protected onUnmount(): void {}

  /** 标记需要重绘 (下一帧合并) */
  invalidate(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      if (this.isConnected) this.render();
    });
  }

  /** 子类实现: 输出 shadow root 内容 */
  protected abstract render(): void;

  /** 子类可返回 css 文本 */
  protected styles(): string {
    return '';
  }

  protected useStyles(css: string): void {
    const existing = this.root.querySelector<HTMLStyleElement>('style[data-base]');
    if (existing) {
      if (existing.textContent !== css) existing.textContent = css;
      return;
    }
    const style = document.createElement('style');
    style.dataset.base = '1';
    style.textContent = css;
    this.root.prepend(style);
  }

  /**
   * 写入 shadow root 主体内容, 保留基类插入的样式表。
   * 直接赋值 innerHTML 会把 <style> 一起清掉, 导致组件失去样式。
   */
  protected setContent(html: string): void {
    const style = this.root.querySelector('style[data-base]');
    if (style) {
      const template = document.createElement('template');
      template.innerHTML = html.trim();
      this.root.replaceChildren(style, template.content);
    } else {
      this.root.innerHTML = html;
    }
  }

  protected $<T extends Element = HTMLElement>(sel: string): T | null {
    return this.root.querySelector(sel) as T | null;
  }

  protected $$<T extends Element = HTMLElement>(sel: string): T[] {
    return Array.from(this.root.querySelectorAll(sel)) as T[];
  }

  protected emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

export function defineElement(name: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(name)) customElements.define(name, ctor);
}

export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
