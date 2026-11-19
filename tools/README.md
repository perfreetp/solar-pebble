# tools/

开发期用的验证脚本。**不是**应用的一部分,只是我用来验证不变量的工具。

- `test.mjs` —— 24 项内核断言(确定性、镜像对称、overrides 保留、质检、导出格式)。`npm test`
- `e2e3.mjs` —— 编辑-重算保留、真实点击选翅室/拖斑点、确定性自检。需要 `npm run dev` 在 5173。
- `e2e-flow.mjs` —— 提交 4 个变体 → 批次 → 复核 → 造一个带阻断项的批次。
- `e2e-export.mjs` —— 打包 ZIP 并落到 `tools/out/`,用来核对文件结构。
- `e2e-keys.mjs` —— 键盘快捷键(含输入框内不误触)。
- `e2e-undo2.mjs` —— 撤销/重做按操作粒度回滚。
- `final-flow.mjs` —— 完整链路:手改 → 改参数重算 → 提交 → 复核 → 放行。
- `app-shot.mjs` / `prod-check.mjs` / `tools/prod*` —— 截图与生产构建冒烟。

Playwright 用的是本机 Chrome,不下载额外浏览器:

```bash
npm run dev &
node tools/e2e3.mjs
```
