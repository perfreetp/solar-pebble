import './styles.css';
import { AppShell } from './components/app-shell';
import { ViewEditor } from './components/view-editor';
import { ViewOrders } from './components/view-orders';
import { ViewWorkshop } from './components/view-workshop';
import { ViewBoard } from './components/view-board';

customElements.define('app-shell', AppShell);
customElements.define('view-editor', ViewEditor);
customElements.define('view-orders', ViewOrders);
customElements.define('view-workshop', ViewWorkshop);
customElements.define('view-board', ViewBoard);
