/** Click-to-cycle demo identity switcher. */
export function UserPill(props: { me: any; users: any[]; onSwitch: (id: string) => void }) {
  const next = () => {
    const i = props.users.findIndex((u) => u.id === props.me.id);
    const u = props.users[(i + 1) % props.users.length];
    props.onSwitch(u.id);
  };
  return (
    <div class="user-pill" title={`${props.me.org} · 点击切换演示身份`} onClick={next}>
      <span class={`user-avatar ${props.me.role === 'supervisor' ? 'sup' : ''}`}>{props.me.name.slice(0, 1)}</span>
      {props.me.name}
      <span style={{ color: 'var(--text-faint)', 'font-size': '10px' }}>
        {props.me.role === 'supervisor' ? '主管' : '工艺员'}
      </span>
      <span style={{ color: 'var(--text-faint)', 'font-size': '9px' }}>⇄</span>
    </div>
  );
}
