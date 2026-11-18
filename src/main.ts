import { getSession, seedIfEmpty, setSession } from './store';
import { ROLE_NAMES, type Role } from './types';
import { h } from './ui/dom';
import './ui/projectsPage';
import './ui/projectDetailPage';
import './ui/editorPage';
import './ui/reviewPage';

seedIfEmpty();

function buildShell(): { main: HTMLElement } {
  const app = document.getElementById('app')!;
  app.textContent = '';

  const session = getSession();
  const roleSel = h('select', {},
    ...(Object.keys(ROLE_NAMES) as Role[]).map(r =>
      h('option', { value: r, ...(r === session.role ? { selected: true } : {}) }, ROLE_NAMES[r]),
    ),
  ) as HTMLSelectElement;
  const nameIn = h('input', { value: session.userName, placeholder: '姓名', style: 'width:90px' }) as HTMLInputElement;
  const saveSession = () => setSession({ role: roleSel.value as Role, userName: nameIn.value.trim() || '访客' });
  roleSel.onchange = () => { saveSession(); route(); };
  nameIn.onchange = () => { saveSession(); route(); };

  const header = h('div', { class: 'app-header' },
    h('span', { class: 'logo' }, '◆ 小天体体素建模工作台'),
    h('nav', {},
      h('a', { href: '#/projects' }, '项目列表'),
    ),
    h('span', { class: 'spacer' }),
    h('div', { class: 'role-box' },
      h('span', {}, '角色'),
      roleSel,
      nameIn,
    ),
  );
  const main = h('main');
  app.append(header, main);
  return { main };
}

const { main } = buildShell();

function route(): void {
  const hash = location.hash || '#/projects';
  main.textContent = '';
  let m: RegExpMatchArray | null;
  if ((m = hash.match(/^#\/project\/([\w]+)$/))) {
    const el = document.createElement('project-detail-page') as HTMLElement & { projectId: string };
    el.projectId = m[1];
    main.append(el);
  } else if ((m = hash.match(/^#\/editor\/([\w]+)$/))) {
    const el = document.createElement('editor-page') as HTMLElement & { shotId: string };
    el.shotId = m[1];
    main.append(el);
  } else if ((m = hash.match(/^#\/review\/([\w]+)$/))) {
    const el = document.createElement('review-page') as HTMLElement & { projectId: string };
    el.projectId = m[1];
    main.append(el);
  } else {
    main.append(document.createElement('projects-page'));
  }
}

window.addEventListener('hashchange', route);
route();
