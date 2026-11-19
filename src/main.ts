// 入口：注册全部 Web Components 并加载存档
import './styles.css';
import { store } from './core/store';
import { AppShell } from './ui/app-shell';
import { ProjectPage } from './ui/project-page';
import { EditorPage } from './ui/editor-page';
import { PreviewPage } from './ui/preview-page';
import { EditorToolbar } from './ui/editor-toolbar';
import { LayerOutliner } from './ui/layer-outliner';

customElements.define('app-shell', AppShell);
customElements.define('project-page', ProjectPage);
customElements.define('editor-page', EditorPage);
customElements.define('preview-page', PreviewPage);
customElements.define('editor-toolbar', EditorToolbar);
customElements.define('layer-outliner', LayerOutliner);

store.load();

// 开发期暴露，便于控制台调试
declare global {
  interface Window {
    voxelStore: typeof store;
  }
}
window.voxelStore = store;
