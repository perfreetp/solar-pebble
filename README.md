# 站房采样管线矢量编辑器

面向环境监测站房的采样管线走向 / 警示标识版面矢量编辑与工单协作系统。
React 18 + PixiJS 8（画布渲染与交互）+ Paper.js（路径布尔运算）+ Zustand（状态与历史）。

## 启动

```bash
npm install
npm run dev        # http://127.0.0.1:5180（端口占用时自动顺延）
npm run build      # 类型检查 + 生产构建
```

## 功能清单与实现位置

| 需求 | 实现 |
| --- | --- |
| 矩形 / 多边形 / 折线 / 钢笔路径工具 | `src/editor/PixiStage.ts`（钢笔为三次贝塞尔，拖出控制柄，回车/双击结束） |
| 并集 / 差集 / 交集 / 异或，结果仍可编辑 | `src/editor/boolean.ts`：Paper.js 做路径代数，结果抽稀回 `VecPath` 顶点多边形；开放路径按线宽转描边面参与运算 |
| 端点 / 中点 / 网格 / 边线吸附，阈值可调 | `src/editor/snapping.ts`，阈值在左侧工具面板滑块（2–30px，按缩放换算世界距离） |
| 成组整体变换 | store `groupSelection/applyWorldTransform`，组变换与图元局部变换矩阵分层，解组时烘焙回局部 |
| 撤销重做 50 步 | store 环形历史栈（`HISTORY_LIMIT=50`），Ctrl+Z / Ctrl+Y |
| 图层锁定 / 隐藏 | `LayerPanel.tsx`，锁定图层不可命中、隐藏图层不渲染且不导出 |
| 图例模板批量套线宽 / 填充 | `StylePanel.tsx`，模板带适用类型校验，多选一键套用 |
| 标尺 / 栅格可切换 | PixiStage 栅格层与标尺层，5 倍主刻度 |
| 管线压标识牌冲突标红 | `src/editor/conflict.ts`（点入面 + 压边容差 + 线段相交），画布红色光晕与顶部横幅提示 |
| 导出 SVG / 图层清单 | `src/editor/exportSvg.ts`，清单为含锁定/隐藏/冲突标记的 JSON |
| 前台接单 → 派工 → 绘制 → 提交质检 → 打回/通过 | `JobsBoard.tsx` / `QcView.tsx`，打回必须填写原因，状态机驱动看板列 |
| 完成量 / 返工率看板 | `JobsBoard.tsx` 统计区：返工率 = 打回次数 / 已派工单数 |

数据持久化在浏览器 `localStorage`（key：`station-editor-state-v1`），工单与图纸刷新不丢。

## 操作约定

- 选择工具：单击选中，Shift+单击加减选，拖动平移，角点缩放，顶部黄圆点旋转，粉色小点拖顶点
- 平移：平移工具 / 按住空格拖动 / 鼠标中键；滚轮以指针为锚缩放
- 折线、多边形、钢笔：单击加点，双击或 Enter 结束，Esc 取消
- 快捷键：Ctrl+Z 撤销、Ctrl+Y 重做、Ctrl+D 复制、Ctrl+G 成组、Delete 删除

## 测试

`.smoke/smoke.cjs` 是 Playwright 冒烟脚本（需本机有 playwright-core 与 Chromium），
覆盖首屏渲染、矩形/折线绘制、吸附阈值、布尔运算、SVG/清单下载、工单派工与质检流程，共 21 项断言。

## 目录

```
src/
  editor/      纯逻辑与画布引擎（类型、几何、布尔、吸附、冲突、导出、store、PixiStage）
  ui/          React 面板与三个主视图（编辑 / 工单看板 / 质检）
```
