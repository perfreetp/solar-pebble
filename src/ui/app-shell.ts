// 应用外壳：项目页 / 建模页 / 预览页 路由（页面常驻，按 hidden 切换，避免重建 WebGPU 场景）
import { BaseComponent } from './base';
import { store } from '../core/store';
import type { EditorPage } from './editor-page';
import type { PreviewPage } from './preview-page';

export type Route = 'projects' | 'editor' | 'preview';

export class AppShell extends BaseComponent {
  route: Route = store.currentProjectId ? 'editor' : 'projects';

  navigate(route: Route): void {
    if (route !== 'projects' && !store.currentProjectId) route = 'projects';
    if (route === this.route) return;
    this.lifecycle(this.route, false);
    this.route = route;
    this.lifecycle(route, true);
    this.forceRender();
  }

  private lifecycle(route: Route, entering: boolean): void {
    const sel = route === 'projects' ? 'project-page' : route === 'editor' ? 'editor-page' : 'preview-page';
    const page = this.shadow.querySelector(sel) as (EditorPage | PreviewPage) & {
      enter?: () => void;
      exit?: () => void;
    } | null;
    if (!page) return;
    if (entering) page.enter?.();
    else page.exit?.();
  }

  protected render(): string {
    const hidden = (r: Route): string => (r === this.route ? '' : 'hidden');
    return `
      <style>
        :host { display: flex; flex-direction: column; height: 100vh; }
        .page { flex: 1; min-height: 0; display: flex; flex-direction: column; }
        .page[hidden] { display: none; }
      </style>
      <project-page class="page" ${hidden('projects')}></project-page>
      <editor-page class="page" ${hidden('editor')}></editor-page>
      <preview-page class="page" ${hidden('preview')}></preview-page>
    `;
  }

  protected afterRender(): void {
    // 子页面通过冒泡的 navigate 事件请求跳转
    this.shadow.addEventListener('navigate', ((e: Event) => {
      const detail = (e as CustomEvent<Route>).detail;
      this.navigate(detail);
    }) as EventListener);
    // 首次进入默认路由时触发生命周期
    this.lifecycle(this.route, true);
  }
}
