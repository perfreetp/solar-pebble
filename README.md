# 射击姿势 2D 角色骨骼动画编辑器

面向射击俱乐部教练制作射击姿势课件的 2D 骨骼动画编辑器。Vue 3 + Canvas2D + OffscreenCanvas 实现，
覆盖「分层部件导入 → 拖锚点绑骨 → 父子重挂 → 手柄摆姿势 → 数值微调 → 24fps 关键帧 → 三种插值/贝塞尔曲线
→ 预设复用 → 超限标红 → 离屏预览 → PNG 序列帧 + JSON 导出 → 派单流程与质量看板」全链路。

## 启动

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 生产构建
node scripts/smoke.mjs         # 引擎单元冒烟测试（15 项，纯 Node）
node scripts/headless-check.mjs # 无头 Chrome 端到端检查（13 项，需先 npm run dev）
```

## 功能与实现对照

| 需求 | 实现位置 |
| --- | --- |
| 分层部件图导入，拆成头/躯干/上臂/前臂/手/枪 | `src/engine/parts.js` 文件名关键字+左右识别；无素材时内置 9 个 ImageBitmap 占位部件 |
| 画布拖关节锚点绑骨 | `components/CanvasStage.vue` 绑骨模式，蓝点=关节锚点、橙方块=图片偏移手柄 |
| 父子关系调整与重挂 | `engine/skeleton.js#reparent` 防成环校验；`components/RigPanel.vue` 父节点下拉 |
| 拖手柄摆姿势 | 摆姿势模式旋转手柄，`renderer.js#pointerWorldAngle` 反求局部旋转 |
| 躯干前倾/持枪臂抬起/呼吸幅度数值微调 | `components/PosePanel.vue` + `stores/editor.js`，滑杆与数字输入双向联动 |
| 24fps 时间轴关键帧 | `engine/animation.js`，`Timeline.vue` 刻度/菱形关键帧/播放头 |
| 线性、缓入缓出、贝塞尔插值 | `engine/math.js#cubicBezier`（牛顿迭代+二分兜底），段级配置 |
| 曲线编辑器拖控制点 | `components/CurveEditor.vue`，可拖控制点+数值输入+5 种预设 |
| 姿势预设存段并套到别的动作段 | `engine/presets.js`（localStorage 持久化，帧号重基） |
| 关节超范围提示并标红 | `skeleton.js#findRangeViolations`，渲染器 `source-atop` 红色叠加+侧栏告警 |
| OffscreenCanvas 离屏渲染不掉帧 | `workers/preview.worker.js` Worker + OffscreenCanvas，不支持时主线程离屏回退 |
| 导出 PNG 序列帧 + 关键帧 JSON | `engine/export.js` 逐帧离屏渲染，JSZip 打包 `png/pose_XXXX.png` + `keyframes.json` |
| 派单：教练提交→管理员分派→制作提交→质检抽查/打回 | `stores/workflow.js` 状态机+角色权限，`pages/WorkflowPage.vue` |
| 返工次数记录 | 工单 `reworkCount`，打回时自增并写入流转日志 |
| 看板完成量与返工率 | `pages/DashboardPage.vue`，返工率=打回÷(完成+打回) |

## 架构

```
src/
├─ engine/            # 纯逻辑层，不依赖 Vue/DOM（parts 除外，用 ImageBitmap）
│  ├─ math.js         # 角度/插值/三次贝塞尔
│  ├─ skeleton.js     # 9 部件骨架、层级、活动范围、FK、重挂、超限
│  ├─ parts.js        # 部件导入识别、内置占位部件（ImageBitmap，可克隆进 Worker）
│  ├─ animation.js    # 24fps 时间轴、关键帧、段插值求值
│  ├─ renderer.js     # Canvas2D 场景绘制、覆盖层、命中检测
│  ├─ render-core.js  # 主线程/Worker/导出共用的渲染入口
│  ├─ presets.js      # 姿势预设
│  └─ export.js       # PNG 序列帧 + JSON 打包
├─ workers/preview.worker.js   # OffscreenCanvas 离屏渲染线程
├─ stores/            # Pinia：editor（工程）、workflow（派单）
├─ components/        # CanvasStage、RigPanel、PosePanel、Timeline、CurveEditor、PresetPanel、ExportPanel
└─ pages/             # WorkflowPage、EditorPage、PreviewPage、DashboardPage
```

### 绑骨模型要点

- **锚点即关节**：每个骨骼的 `anchor` 是父骨远端/本骨近端关节；图片通过 `pivot`（图内旋转中心）
  与 `offset`（沿骨线的局部偏移）对齐到关节，偏移随世界角旋转。
- **角度体系**：世界角 0° 指向右方、顺时针为正。世界角 = 父世界角 + `bindLocal`（绑定局部角）+ `localRot`（姿态旋转）。
  根（躯干）= `restAngle` + `localRot`。
- **美术朝向 bias**：竖直绘制的头/躯干 bias=90，水平绘制的四肢 bias=0，可在绑骨面板按素材调整。
- **关节范围**：每个骨骼带 `[min,max]` 局部旋转范围，可编辑；超限实时检测并标红。

### OffscreenCanvas 策略

支持时把可见 canvas `transferControlToOffscreen()` 移交 Worker，动画 rAF、时间轴求值、FK、绘制全部在工作线程；
部件统一为 `ImageBitmap`（结构化克隆友好），高频同步只发骨骼/时间轴，部件变更才发 bitmap。
浏览器不支持时自动回退到主线程离屏 canvas，功能一致。

## 数据持久化

- 工程骨架/时间轴：localStorage `spe_project_v1`（图片 bitmap 不可序列化，重载后用占位部件，可重新导入）
- 派单工单/预设：localStorage `spe_workflow_v1` / `spe_presets_v1`
- 导出的 `keyframes.json` 为完整工程描述，可在导出面板「导入工程 JSON」恢复
