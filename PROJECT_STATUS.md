# Project Status — pdd-uploader

> 最后更新: 2026-06-05

## 当前阶段

**Phase 1 完成** — 单商品自动填表 + 干跑校验模式已跑通。

## 已完成 ✅

| 模块 | 文件 | 状态 |
|------|------|------|
| 浏览器启动 | `src/browser/launcher.js` | CDP 连接 + Channel 模式双策略 |
| 登录态管理 | `src/browser/session.js` | 保存/恢复 storageState，过期自动重登 |
| Excel 读取 | `src/data/excel-reader.js` | 支持竖排（字段/值）和横排两种格式 |
| 商品映射 | `src/data/product-mapper.js` | 图片匹配、SKU 笛卡尔积生成 |
| 字段校验 | `src/data/validator.js` | 标题30汉字、主图数量/大小、SKU价格合法性 |
| 类目映射 | `src/data/category-map.js` | 关键词→完整类目路径，已注册7个类目 |
| 分类选择 | `src/pages/category-page.js` | 最近使用一键选 + 搜索回退 |
| 基本信息 | `src/actions/fill-basic-info.js` | 标题 + 主图上传 |
| 属性填写 | `src/actions/fill-attributes.js` | 图案/风格/场景/定制/工艺下拉 |
| SKU 规格 | `src/actions/fill-specs.js` | 款式+容量维度设置 |
| SKU 价格 | `src/actions/fill-sku-table.js` | 逐行填库存/拼单价/单买价，含 React fallback |
| 发布守护 | `src/pages/submit-guard.js` | 停在提交前，可选保存草稿 |
| 批量模式 | `src/index.js` | `--batch` 逐个处理，人工按回车确认 |
| 干跑校验 | `src/index.js` | `--dry-run` 只校验数据，不开浏览器 |

## 未完成 / 待改进 ⚠️

- [ ] **真实上架测试**: 只做了 1 个商品（露品汇小卡）的手动上架测试，自动化流程尚未端到端跑通（需要登录态 + Chrome 调试模式）
- [ ] **SKU 预览图上传**: 当前未自动上传每个 SKU 的预览图（规格图），提交时会报错
- [ ] **商品详情描述**: 未自动生成/填写图文详情
- [ ] **报错恢复**: 中途报错后需要手动重新开始，没有断点续传
- [ ] **日志持久化**: `logs/*.log` 已加入 .gitignore，但运行时日志只追加不轮转
- [ ] **多账号支持**: 目前只支持一个 Chrome profile

## 已知问题

1. **React 表单 fill() 偶发不生效**: 某些 SKU 价格用 `fill()` 填入后 React 不识别，需要 JS fallback（`fix-all-rows.js` 模式）。已写进 `fill-sku-table.js` 但未充分测试。
2. **安全验证页面**: PDD 有时弹出滑块验证（`psnl_verification.html`），需要人工介入。
3. **分类页 "最近使用的分类"**: 首次使用或清空后不存在，需搜索回退。已实现。
4. **SKU 表格虚拟滚动**: 超过 30 行的 SKU 表格只渲染可见行，需要滚动触发渲染。

## 下一步计划

1. **端到端测试**: 用真实 Chrome + 登录态完整跑一次 label_001 上架
2. **补 SKU 预览图**: 自动给每个 SKU 行上传同一张小图作为预览
3. **补详情图/描述**: 上传详情图片到图文编辑区
4. **第 2 个商品测试**: 上架 bookmarks_001（定制书签）
5. **第 3 个商品测试**: 上架 polaroid_001（拍立得小卡）
6. **稳定后考虑**: 自动发布 `--publish`、更多类目映射
