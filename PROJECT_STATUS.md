# Project Status — pdd-uploader

> 最后更新: 2026-06-05

## 当前阶段

**V1 稳定基线 — label_001 端到端已跑通 ✅**

## V1 已完成的完整流程

```
Excel 3工作表(products/attributes/sku)
  → 数据校验 (--dry-run)
  → CDP 连接 Chrome
  → 登录态自动恢复
  → 分类选择 (逐级点击 + 手动辅助)
  → 标题填写
  → 主图上传
  → 属性填写 (坐标匹配 + 精确匹配 + 无反义误选)
  → SKU 规格创建
  → SKU 价格库存填写 (按行序 + JS fallback)
  → SKU 预览图上传 (逐行 + filechooser)
  → 保存草稿 / 停在发布前
  → 不自动提交上架 ✅
```

## 运行命令

```powershell
# 干跑校验（不开浏览器，只检查 Excel 数据完整性）
npm run dry-run

# 正式运行 label_001（填完停住，不发布）
npm run run:label

# 批量模式（逐个商品，人工按 Enter 确认）
npm run batch

# 快速调试（截图当前页面）
npm run inspect
```

## 技术栈

| 层 | 方案 |
|----|------|
| 浏览器自动化 | Playwright 1.60 + 系统 Chrome (channel: 'chrome') |
| 数据源 | Excel 3工作表 (xlsx 库) |
| 配置管理 | dotenv + .env.local (敏感路径不入 Git) |
| 登录态 | Playwright cookies → state/pdd-auth.json |
| 截图 | 每步骤自动截图 → logs/screenshots/ |
| 容错 | 找不到字段 WARN 不中断 + JS fallback + manual assist |

## 已验证通过的测试点

- [x] 分类选择：逐级点击 数码电器 → 文具电教 → 纸张本册 → 不干胶标签
- [x] 一键复用弹窗：检测并点击"不使用"
- [x] 标题填写：30汉字限制校验
- [x] 主图上传：setInputFiles 一次多文件
- [x] 属性填写：品牌/是否支持定制/产地/纸张类型/形状/包装方式 6/6 成功
- [x] 属性精确匹配：不支持定制 ≠ 支持定制（NO_FUZZY 黑名单）
- [x] SKU 规格：款式×3 + 容量×3 = 9 组合
- [x] SKU 价格：9行逐行填写（虚拟滚动表格适配）
- [x] SKU 预览图：mix.png 行1-3, red.png 行4-6, blue.png 行7-9
- [x] 发布守护：停在提交前，不自动发布

## 项目结构

```
pdd-uploader/
├── src/
│   ├── index.js              # 主入口 (--dry-run / --batch / --publish)
│   ├── config.js             # 集中配置 (env var 读取)
│   ├── browser/
│   │   ├── launcher.js       # CDP 连接 + channel 启动
│   │   └── session.js        # 登录态保存/恢复/等待
│   ├── data/
│   │   ├── excel-reader.js   # 3工作表读取
│   │   ├── product-mapper.js # 数据映射 + SKU 维度提取
│   │   ├── validator.js      # 字段校验
│   │   └── category-map.js   # 类目关键词→路径映射
│   ├── pages/
│   │   ├── category-page.js  # 分类选择
│   │   └── submit-guard.js   # 发布守护
│   ├── actions/
│   │   ├── fill-basic-info.js # 标题 + 主图
│   │   ├── fill-attributes.js # 属性 (坐标匹配 + 精确选值)
│   │   ├── fill-specs.js     # SKU 规格创建
│   │   └── fill-sku-table.js # SKU 价格 + 预览图
│   └── helpers/              # 日志/截图/JS点击
├── docs/RUNBOOK.md           # Windows 运行手册
├── scripts/create-template.js # Excel 模板生成
├── .env.local.example         # 配置示例
├── .env.local                 # 本地配置 (gitignored)
├── state/pdd-auth.json        # 登录态 (gitignored)
├── logs/screenshots/          # 运行截图 (gitignored)
└── PROJECT_STATUS.md          # 本文件
```

### 2026-06-05: 中文图片目录支持 (#14)

**新增**: `主图` / `详情图` / `SKU图` 中文文件夹名别名。

| Excel 写法 | 优先查找 | 回退查找 | 向后兼容 |
|-----------|---------|---------|---------|
| `主图` | `主图/` | `main/` | ✅ |
| `main` | `main/` | `主图/` | ✅ |
| `详情图` | `详情图/` | `detail/` | ✅ |
| `detail` | `detail/` | `详情图/` | ✅ |
| `mix.png` (SKU) | `SKU图/mix.png` | `sku/mix.png` → 根目录 | ✅ |

### 2026-06-05: 图片子目录识别 (#13)

**新增功能**: `matchImages()` 和 `resolveSkuPreviewPath()` 支持三种模式:

| 模式 | Excel 写法 | 解析逻辑 |
|------|-----------|---------|
| 主图子目录 | `main` | 读取 `{product_id}/main/` 下全部图片，按文件名排序 |
| 详情图子目录 | `detail` | 读取 `{product_id}/detail/` 下全部图片 |
| SKU 预览图 | `mix.png` | 先查 `{product_id}/sku/mix.png`，再回退根目录 |
| 向后兼容 | `main1.png;main2.png` | 在根目录匹配具体文件名 |

**目录结构示例**:
```
assets/label_002/
├── main/         # 主图 (main_images: "main")
│   ├── 1.png
│   ├── 2.png
│   └── 3.png
├── detail/       # 详情图 (detail_image: "detail")
│   └── 1.jpg
└── sku/          # SKU 预览图
    ├── mix.png
    ├── red.png
    └── blue.png
```

### 2026-06-05: 多品类模板系统 V1.2 (#15)

**新增**: `templates/` 目录 + `template-loader.js`

| 模板 | 文件 | 类目 | 必填属性 |
|------|------|------|---------|
| 不干胶标签 | `print_label.json` | 数码电器>文具电教>纸张本册 | 品牌/定制/产地/纸张/形状/包装 6项 |
| 食品快消品 | `food_snack.json` | 食品保健>零食/坚果 | 品牌/产地/保质期/SC编号/净含量等 8项 |
| 日用品 | `daily_goods.json` | 居家日用>收纳整理 | 品牌/产地/材质/规格等 6项 |
| 通用模板 | `generic.json` | (需 Excel 指定) | 品牌/产地 |

**合并规则**: Excel `attributes` 表 > 模板默认值 > 空

**类目来源优先级**: Excel `category_path` > 模板 `category_path` > 默认

## 已知限制

1. 仅测试了 label_001（不干胶标签）一个商品
2. SKU 预览图仅支持 3 款式图片共享模式
3. 详情图/详情描述未对接 Excel
4. 滑块验证需人工处理
5. 无断点续跑（中途失败需重新开始）

## 下一阶段规划

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P1 | 多商品批量上架 | 从 products sheet 读多行，逐个自动上架 |
| P1 | 多品类模板 | 书签、拍立得小卡、方卡等品类映射 |
| P2 | 详情图/描述 | 从 Excel 读详情图路径并上传 |
| P2 | 自动保存草稿列表 | 记录每次保存的商品 ID 和时间 |
| P3 | 失败断点续跑 | 从上次中断的商品继续 |
| P3 | 可视化配置 | Web UI 编辑 Excel 和预览 |
| P4 | 自动发布 | --publish 模式（需充分测试审核风险） |
