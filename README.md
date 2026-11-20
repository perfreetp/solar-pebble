# 虫虫体素工坊 · Voxel Bug Studio

给儿童昆虫科普游戏做角色的体素建模工作台。技术栈 **Svelte 5 + Babylon.js 9 + Vite**,纯前端、零后端,版本与批注数据存 `localStorage`。

## 启动

```bash
npm install
npm run dev       # 开发服务器 http://localhost:5173
npm run build     # 生产构建 -> dist/
npm run preview   # 预览生产构建
npm test          # 纯逻辑冒烟测试(14 项)
npm run check     # svelte-check 静态检查
```

## 三个界面(顶部导航 / hash 路由)

| 界面 | 路由 | 职责 |
|---|---|---|
| 建模工作台 | `#editor` | 体素雕刻、分层、镜像、框选剪贴板、合并减面、导出 GLB、提交版本 |
| 版本审核 | `#review` | 版本列表、画面点选落点写批注、制作方逐条回复与标记处理 |
| 版本对比 | `#compare` | 任意两个版本并排双视口,绿/红高亮新增与删除差异 |

## 功能与实现对照

| 需求 | 实现 |
|---|---|
| 画笔 / 橡皮 / 填充 | `lib/voxel.js` 的 `paintVoxel` / `eraseVoxel` / `floodFill`(泛洪) |
| 独角仙/锹甲/蝴蝶造型 | `lib/templates.js` 程序化生成椭球身体、头角、大颚、翅斑等 |
| 分层编辑 + 锁定单层 | `layerLockEnabled` + `activeLayer`,落笔/擦/填充均按层过滤;支持隐藏层 |
| X 轴镜像落笔 | `mirror` 开启时同时写 `(x,y,z)` 与 `(-x,y,z)`,中轴自动去重 |
| 框选 / 复制粘贴 / 整体平移 | 选择工具拖框 AABB;`copyVoxels`/`pasteVoxels`/`translateVoxels`(越界冲突回退) |
| 连通团选中合并为一个网格 | `connectedComponent` 6-连通;`buildCulledMesh` 做内部面剔除合并 |
| 按比例减面 | 贪心共面合并 + Babylon `mesh.simplify` Quadric 简化,质量滑杆 25%~100% |
| 导出 GLB | `lib/exporter.js` 离屏场景生成,glTF 2.0 二进制,顶点色写 `COLOR_0`,带超时回退 |
| 正交 / 透视视角 | `ArcRotateCamera.mode` 切换 |
| 网格线隐藏 | 开关控制 `GridMaterial` 地面 |
| 最近用色取色板 | 每次落笔把颜色前置去重,保留最近 12 个 |
| 每次提交新版本 | `stores/versions.js` 深拷贝快照,持久化到 localStorage |
| 画面点选写批注 | 审核模式 DDA 射线落点,3D 图钉 + 右侧线程 |
| 逐条回复处理 | 制作方模式回复、标记已处理/重开 |
| 两版本并排比对 | 双独立引擎视口,`diffVoxels` 计算增/删/改色 |

## 关键技术点

- **自研 3D DDA 拾取**(`rayVoxelWalk`):不依赖物理射线碰撞,按格子步进求命中体素与相邻空气格,画笔/框选/批注落点共用。
- **ThinInstance 渲染**:整个体素堆一次绘制调用,每实例独立矩阵 + 顶点色;0 实例时禁用根方块避免原点残影。
- **面剔除 + 贪心减面**:只生成暴露面,再按朝向/层分组做共面矩形合并,减面绕序用法线手性校正保证不外反。
- **编辑手势分工**:左键负责落笔/框选,相机旋转交给右键与中键,避免拖动冲突。

## 目录结构

```
src/
  lib/
    voxel.js            # 纯逻辑:数据结构、拾取辅助、连通团、网格构建/减面、差异
    templates.js        # 三种昆虫模板
    voxelEngine.js      # Babylon 封装:渲染、DDA 拾取、框选/批注/差异标记
    exporter.js         # GLB 导出与减面
    stores/
      editor.svelte.js  # 编辑器状态(Svelte 5 runes,$state 深响应)
      versions.js       # 版本/批注 store(localStorage 持久化)
  components/VoxelViewport.svelte
  views/EditorView / ReviewView / CompareView .svelte
test/smoke.mjs
```

## 已知边界

- Quadric 简化在无 GPU 的无头/软件渲染环境可能不回调,导出器 8 秒超时后自动退回共面合并结果;真实浏览器正常。
- 单机 localStorage 存储,适合演示与本地创作;多人协作需接后端替换 `stores/versions.js`。
