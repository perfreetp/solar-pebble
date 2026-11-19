import { createSignal, Show } from 'solid-js';
import StudioView from './views/StudioView';
import ReviewView from './views/ReviewView';
import AdminView from './views/AdminView';
import StatsView from './views/StatsView';
import { view, setView, currentUser, setCurrentUser, users } from './store/store';
import { loadSpecimen } from './store/docStore';
import { generateSpecimenBitmap } from './lib/specimenImage';

const NAV: { key: 'studio' | 'review' | 'admin' | 'stats'; label: string; roles: string[] }[] = [
  { key: 'studio', label: '描图台', roles: ['illustrator', 'admin'] },
  { key: 'review', label: '分类审校台', roles: ['reviewer', 'admin'] },
  { key: 'admin', label: '后台管理', roles: ['admin'] },
  { key: 'stats', label: '产量统计', roles: ['admin', 'reviewer', 'illustrator'] },
];

const ROLE_LABEL: Record<string, string> = {
  illustrator: '插画师', reviewer: '分类学审校', admin: '管理员',
};

export default function App() {
  const [booted, setBooted] = createSignal(false);

  // 首屏预生成一张标本底图,保证画布不是空的
  if (!booted()) {
    generateSpecimenBitmap(11, 0).then(bitmap => {
      loadSpecimen(
        { code: 'SP-0001', family: '凤蝶科 Papilionidae', species: '金凤蝶 Papilio machaon' },
        bitmap,
      );
      setBooted(true);
    });
  }

  const allowedNav = () => NAV.filter(n => n.roles.includes(currentUser().role));

  return (
    <div class="app">
      <header class="app-header">
        <div class="brand">
          <span class="logo">🪶</span>
          <div>
            <h1>翅脉矢量描图台</h1>
            <small>昆虫图鉴编辑部 · 翅脉与斑纹数字化工作台</small>
          </div>
        </div>
        <nav class="main-nav">
          {allowedNav().map(n => (
            <button classList={{ active: view() === n.key }} onClick={() => setView(n.key)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div class="user-box">
          <label>
            身份
            <select value={currentUser().name}
              onChange={e => setCurrentUser(users().find(u => u.name === e.currentTarget.value)!)}>
              {users().map(u => <option value={u.name}>{u.name}（{ROLE_LABEL[u.role]}）</option>)}
            </select>
          </label>
        </div>
      </header>

      <Show when={allowedNav().some(n => n.key === view())} fallback={
        <div class="placeholder">当前身份「{ROLE_LABEL[currentUser().role]}」无权访问该界面,请切换身份。</div>
      }>
        {view() === 'studio' && <StudioView />}
        {view() === 'review' && <ReviewView />}
        {view() === 'admin' && <AdminView />}
        {view() === 'stats' && <StatsView />}
      </Show>
    </div>
  );
}
