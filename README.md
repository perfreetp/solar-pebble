# 翅脉矢量描图台(昆虫图鉴编辑部)

SolidJS + Canvas2D/OffscreenCanvas 构建的翅脉与斑纹矢量描图工作台。主画布通过
`transferControlToOffscreen()` 移交 **Web Worker 中的 OffscreenCanvas** 渲染,
主线程只负责交互与状态;标本底图同样由 **OffscreenCanvas 程序化生成**。

## 启动

```bash
npm install
npm run dev        # http://localhost:5180
npm run build      # 生产构建
npm run typecheck  # TS 严格模式类型检查
npm run test:unit  # 22 项几何/布尔/吸附/对齐/SVG 单元断言
npm run test:e2e   # 30 项 Playwright 四界面端到端断言(需先启动 dev,见下)
```

E2E 使用本机 Playwright 缓存的 headless Chromium:

```bash
npm run dev -- --port 5191 --strictPort
E2E_PORT=5191 npm run test:e2e
```

## 四个界面

| 界面 | 角色 | 能力 |
| --- | --- | --- |
| **描图台** | 插画师 | 钢笔绘脉/斑纹、节点与贝塞尔控制柄、吸附、布尔运算、镂空、图层、模板、撤销重做、提交 |
| **分类审校台** | 分类学审校 | 只读画布上拖出红/绿圈注、填写意见、通过/驳回(驳回必须先有圈注) |
| **后台管理** | 管理员 | 翅脉模板库 CRUD、导出预设 CRUD(颜色/线宽/分层/底图) |
| **产量统计** | 全部 | 每人每日完成图版数 KPI、Canvas 柱状图、14 天明细表 |

右上角可切换身份,导航按角色显隐。数据持久化在 `localStorage`(bitmap 不可序列化,自动剔除)。

## 描图台操作

- **钢笔(P)**:单击加点(自动平滑柄);`Shift` 单击加直线点;点首节点 / 双击 / 回车闭合;`Esc` 取消
- **选择(V)**:拖节点;拖控制柄调贝塞尔(`Shift` 断开对称柄,默认镜像联动);
  拖路径整体移动;`Shift` 点选多选;`Delete` 删除
- **吸附**:节点靠近其它节点、水平/垂直参考线时自动吸附并高亮,同时给出同 x/y 智能辅助线
- **参考线工具**:拖一下,按拖动方向生成水平或垂直参考线;右键参考线删除
- **布尔**:选中两条闭合路径 → 并集 ∪ / 差集 − / 交集 ∩(贝塞尔先展平,交 `polygon-clipping` 运算)
- **斑纹镂空**:选中闭合斑纹 → 「斑纹镂空」,翅脉展平后扩张为条带多边形做 difference,
  结果以 `holes` + SVG `fill-rule="evenodd"` 表达;全宽切割会正确分裂为多个多边形
- **对齐分布**:左对齐、水平/垂直居中、顶对齐、横/纵向等间距(分布需 ≥3 个选中)
- **图层**:锁定、隐藏、重命名、排序、复制、删除
- **模板**:把当前翅脉存为模板;仅同科标本可一键套用(新 id + 微偏移),再继续改
- **视图**:Ctrl/⌘+滚轮缩放,滚轮平移,空格临时平移;`Ctrl+Z` 撤销、`Ctrl+Y`/`Ctrl+Shift+Z` 重做
- **撤销重做**:每文档独立双栈,上限 **80 步**(要求 ≥50),拖拽交互自动合并为单步
- **导出**:分层 SVG(`layer-background` / `layer-pattern` / `layer-vein`,
  Inkscape `inkscape:groupmode="layer"` 命名图层,贝塞尔保留 `C` 命令,镂空 `evenodd`)

## 架构

```
src/
├── types.ts                  领域模型(PathData/Submission/Template/Preset…)
├── lib/
│   ├── geometry.ts           贝塞尔展平、命中距离、多边形面积、平移/包围盒
│   ├── boolean.ts            polygon-clipping 封装:布尔运算 + 翅脉条带镂空
│   ├── snap.ts               节点/参考线/智能投影吸附
│   ├── align.ts              对齐与等间距分布
│   ├── history.ts            80 步撤销重做栈(交互合并)
│   ├── hitTest.ts            控制柄/节点/描边/参考线命中测试
│   ├── pathFactory.ts        路径工厂与控制柄生成
│   ├── specimenImage.ts      OffscreenCanvas 程序化标本底图
│   └── svgExport.ts          分层 SVG 序列化与下载
├── workers/render.worker.ts OffscreenCanvas 渲染 Worker(网格/参考线/路径/控制柄/圈注)
├── store/
│   ├── docStore.ts           当前文档信号、编辑命令、选择、视图、提交
│   └── store.ts              模板/预设/审校/统计 + localStorage 持久化
├── components/               CanvasStage / Toolbar / LayerPanel
└── views/                    Studio / Review / Admin / Stats 四界面
```

渲染数据流:Solid 信号变更 → `CanvasStage` 的 `createEffect` 把整帧状态 `postMessage` 给
Worker → Worker 在 OffscreenCanvas 上重绘。位图(ImageBitmap)以结构化克隆传递。
