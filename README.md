# 生态展箱三维布置编辑器

自然博物馆昆虫展陈组使用的生态展箱造景设计与工单协作系统。
原生 TypeScript + Web Components（Custom Elements + Shadow DOM）+ three.js，零 UI 框架。

## 启动

```bash
npm install
npm run dev        # 开发，默认 http://127.0.0.1:5173
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览生产构建
```

## 四个界面

| 界面 | 路由 | 功能 |
| --- | --- | --- |
| 三维布置编辑 | `#/editor` | 构件库拖拽、射线拾取、变换手柄、碰撞拦截、贴面落位、框选对齐、俯视图、物料清单 |
| 前台接单 / 派工 | `#/orders` | 录入展陈需求并对当前场景快照下单，分派给师傅 |
| 师傅工作台 / 质检 | `#/workshop` | 师傅提交完工/返工重提；质检抽查合格入库或填写意见打回 |
| 完成看板 | `#/board` | 工单总量、完成率、返工率、各师傅完成情况、返工明细 |

## 三维编辑器操作

- **拖入构件**：从左侧构件库按住拖到视口；落在展箱外或与相邻构件碰撞时预览变红并拒绝落下
- **拾取选择**：单击选中（Shift 加选），空白处拖拽矩形框选
- **变换手柄**：W 平移 / E 旋转 / R 缩放；拖动中一旦与相邻构件穿插或超出展箱，构件立即变红，松手自动回滚
- **贴面落位**：松手时按吸附步长取整，并自动把底面贴到台面或下层构件顶面
- **批量操作**：框选多个构件后可整体平移/旋转，或一键左对齐、X 向等距排布
- **视图**：俯视图为正交相机，自动显示各展箱占位轮廓与尺寸标签；网格间距、平移步长、角度步长均可调

## 碰撞与贴面规则

- 构件用旋转后的世界 AABB 做穿插检测（`src/geometry.ts`）
- 构件只能落在所属展箱范围内，底面不得低于台面
- 展箱之间地面投影不可重叠；移动/旋转展箱时箱内构件整体跟随
- 展箱禁止缩放（避免箱内构件穿模）

## 工单状态机

```
待分派 pending → 制作中 assigned → 待质检 submitted
                     ↑                  ├─ 合格 → 已完成 done
                     └──── 打回 rejected ┘（师傅返工后重新提交）
```

数据通过 localStorage 持久化（键 `ecovivarium-editor-state-v1`），刷新不丢失。

## 测试

无头 Chrome（需本机 Chrome，使用 SwiftShader 软件 WebGL）：

```bash
# 1. 启动 dev server
npm run dev
# 2. 另开终端：启动带 CDP 的无头 Chrome
chrome --headless=new --no-sandbox --use-angle=swiftshader \
       --enable-unsafe-swiftshader --remote-debugging-port=9222 about:blank
# 3. 运行端到端断言（几何/碰撞/贴面/吸附/对齐 + 工单全流程 + 看板统计）
node scripts/e2e.cjs
# 4. 真实指针事件测试（射线拾取、框选、删除）
node scripts/pick-test.mjs
```

## 目录结构

```
src/
  types.ts            领域模型
  catalog.ts          构件库目录、师傅、持久化、id
  geometry.ts         AABB 碰撞、越界、吸附、贴面、对齐/等距
  store.ts            全局状态、选择集、工单状态机与看板统计
  drag-bus.ts         构件库拖拽类型中转
  three/
    meshes.ts         六类构件的程序化几何
    editor.ts         渲染引擎：拾取、TransformControls、碰撞拦截、框选、俯视图
  components/         四个 Web Components 界面 + 外壳 + 共享样式
```
