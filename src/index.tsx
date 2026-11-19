import { Show, createSignal, onMount, createEffect } from 'solid-js';
import { render } from 'solid-js/web';
import './styles/app.css';
import Editor from './pages/Editor';
import VersionsPage from './pages/VersionsPage';
import ReviewPage from './pages/ReviewPage';
import SharePage from './pages/SharePage';
import { api, setUserId } from './lib/api';

type Route =
  | { kind: 'editor' }
  | { kind: 'versions'; id?: number }
  | { kind: 'review' }
  | { kind: 'share'; token: string };

function parseHash(): Route {
  // Path-based share links (/share/<token>) open directly — a customer link.
  const pathMatch = location.pathname.match(/\/share\/([^/?#]+)/);
  if (pathMatch) return { kind: 'share', token: decodeURIComponent(pathMatch[1]) };
  const h = location.hash.replace(/^#\/?/, '');
  const [path] = h.split('?');
  if (path.startsWith('share/')) return { kind: 'share', token: path.slice(6) };
  if (path === 'versions') return { kind: 'versions' };
  if (path === 'review') return { kind: 'review' };
  return { kind: 'editor' };
}

function App() {
  const [route, setRoute] = createSignal<Route>(parseHash());
  const [me, setMe] = createSignal<any>(null);
  const [users, setUsers] = createSignal<any[]>([]);

  onMount(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    api.bootstrap().then((b) => {
      setUsers(b.users);
      const saved = localStorage.getItem('kd-user');
      const u = b.users.find((x: any) => x.id === saved) ?? b.me;
      setUserId(u.id);
      setMe(u);
    });
  });

  createEffect(() => {
    const m = me();
    if (m) localStorage.setItem('kd-user', m.id);
  });

  function nav(path: string) {
    location.hash = path;
  }

  function switchUser(id: string) {
    const u = users().find((x) => x.id === id);
    if (!u) return;
    setUserId(id);
    setMe(u);
    location.reload();
  }

  return (
    <Show when={me()} fallback={<div class="center-load" style={{ height: '100vh' }}><div class="spinner" /></div>}>
      <Show when={route().kind === 'share'}>
        <SharePage token={(route() as any).token} />
      </Show>
      <Show when={route().kind === 'editor'}>
        <Editor
          me={me()}
          users={users()}
          onSwitchUser={switchUser}
          onOpenReview={() => nav('review')}
          onOpenVersions={() => nav('versions')}
        />
      </Show>
      <Show when={route().kind === 'versions'}>
        <VersionsPage me={me()} users={users()} onSwitchUser={switchUser} onBack={() => nav('')} />
      </Show>
      <Show when={route().kind === 'review'}>
        <ReviewPage me={me()} users={users()} onSwitchUser={switchUser} onBack={() => nav('')} />
      </Show>
    </Show>
  );
}

render(() => <App />, document.getElementById('root')!);
