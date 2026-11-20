// 版本与批注 store:每次提交生成新版本,审核人点选位置写批注,制作方逐条回复
import { cloneVoxels, diffVoxels } from '../voxel.js';
import { rhinoBeetle } from '../templates.js';

const LS_KEY = 'voxel-bug-studio:versions:v1';

function uid() {
  return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Map 序列化还原
    for (const v of data.versions) {
      v.voxels = new Map(Object.entries(v.voxels).map(([k, c]) => [k, { ...parseK(k), c }]));
      v.annotations = v.annotations || [];
    }
    return data;
  } catch (e) {
    console.warn('版本数据读取失败,重置', e);
    return null;
  }
}

function parseK(k) {
  const [x, y, z] = k.split(',').map(Number);
  return { x, y, z };
}

function persist(data) {
  const dump = {
    versions: data.versions.map(v => ({
      ...v,
      voxels: Object.fromEntries([...v.voxels].map(([k, val]) => [k, val.c]))
    }))
  };
  localStorage.setItem(LS_KEY, JSON.stringify(dump));
}

function seed() {
  const voxels = rhinoBeetle();
  const now = Date.now();
  return {
    versions: [{
      id: uid(),
      no: 1,
      name: '独角仙 初稿',
      createdAt: now,
      note: '基于独角仙模板生成的第一版,等待审核。',
      voxels,
      annotations: [
        {
          id: uid(),
          pos: { x: 0, y: 5, z: -11 },
          author: '审核员·蜻蜓老师',
          text: '头角末端可以再翘一点,小朋友更容易认出这是独角仙。',
          createdAt: now + 1000,
          resolved: false,
          replies: [
            {
              id: uid(),
              author: '制作方·小甲',
              text: '收到,下一版把头角抬高半格并加长分叉。',
              createdAt: now + 2000
            }
          ]
        }
      ]
    }]
  };
}

function createVersionStore() {
  let data = load() || seed();
  persist(data);
  const listeners = new Set();

  function emit() {
    persist(data);
    // 不可变更新:新顶层对象 + 新数组,保证 Svelte $state 能感知变化
    data = { versions: [...data.versions] };
    for (const fn of listeners) fn(data);
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      fn(data);
      return () => listeners.delete(fn);
    },
    get data() { return data; },
    /** 提交新版本 */
    submit(voxels, name, note) {
      const no = data.versions.length + 1;
      const version = {
        id: uid(),
        no,
        name: name || `版本 ${no}`,
        note: note || '',
        createdAt: Date.now(),
        voxels: cloneVoxels(voxels),
        annotations: []
      };
      data = { ...data, versions: [...data.versions, version] };
      emit();
      return version;
    },
    /** 在某版本上新增批注(画面点选位置) */
    addAnnotation(versionId, pos, author, text) {
      const v = data.versions.find(x => x.id === versionId);
      if (!v) return;
      v.annotations.push({
        id: uid(),
        pos: { ...pos },
        author: author || '审核员',
        text,
        createdAt: Date.now(),
        resolved: false,
        replies: []
      });
      emit();
    },
    /** 制作方回复一条批注 */
    replyAnnotation(versionId, annotationId, author, text) {
      const v = data.versions.find(x => x.id === versionId);
      const a = v?.annotations.find(x => x.id === annotationId);
      if (!a) return;
      a.replies.push({ id: uid(), author: author || '制作方', text, createdAt: Date.now() });
      emit();
    },
    toggleResolved(versionId, annotationId) {
      const v = data.versions.find(x => x.id === versionId);
      const a = v?.annotations.find(x => x.id === annotationId);
      if (!a) return;
      a.resolved = !a.resolved;
      emit();
    },
    /** 两个版本的差异 */
    diff(versionIdA, versionIdB) {
      const a = data.versions.find(v => v.id === versionIdA);
      const b = data.versions.find(v => v.id === versionIdB);
      if (!a || !b) return null;
      return diffVoxels(a.voxels, b.voxels);
    },
    getVersion(id) {
      return data.versions.find(v => v.id === id);
    },
    reset() {
      data = seed();
      emit();
    }
  };
}

export const versions = createVersionStore();
