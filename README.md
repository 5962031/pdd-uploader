# pdd-uploader

拼多多商家后台商品发布自动化工具。从 Excel 读取商品数据，用 Playwright 驱动浏览器自动填写发布表单，停在提交前等待人工确认。

## 环境要求

- Node.js >= 18
- Google Chrome（系统已安装）
- 拼多多商家后台账号

## 快速开始

```bash
# 1. 安装依赖（不下载 Playwright 自带浏览器）
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install

# 2. 配置环境变量
cp .env.local.example .env.local

# 3. 启动 Chrome 调试模式
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\Users\你的用户名\chrome-debug-profile"

# 4. 干跑校验
npm run dry-run

# 5. 单商品运行
npm run run:label
```

## 命令

| 命令 | 说明 |
|------|------|
| `npm run dry-run` | 全部商品干跑校验 |
| `npm run run:label` | 运行 label_001 |
| `npm run batch:draft` | 批量草稿（全部商品，逐个确认） |
| `node src/index.js --product=label_002` | 指定商品 |
| `node src/index.js --batch-draft --only=id1,id2` | 只跑指定商品 |
| `node src/index.js --batch-draft --from=id` | 从某商品开始 |
| `node src/index.js --dry-run --only=id1,id2` | 干跑筛选 |

## Excel 工作表

`D:\pddtest\资料表\products.xlsx`（3个工作表）：

| 工作表 | 用途 |
|--------|------|
| `products` | 商品基础信息（product_id, title, category_path, asset_dir, main_images, detail_image, sku_1_name/values...） |
| `attributes` | 商品属性（product_id, 属性名, 属性值） |
| `sku` | SKU 明细（product_id, 规格列..., 库存, 拼单价, 单买价, 规格编码, SKU预览图） |

## 图片目录规则

```
D:\pddtest\assets\{asset_dir} 或 {product_id}\
├── 主图\  (或 main\)       → main_images: "主图" 或 "main"
├── 详情图\ (或 detail\)     → detail_image: "详情图" 或 "detail"
└── SKU图\  (或 sku\)       → SKU预览图: "文件名.png" 或留空自动取第一张
```

- `asset_dir` 字段可自定义图片文件夹名（支持中文名和绝对路径）
- 留空时默认使用 `product_id`
- 支持向后兼容：具体文件名列表 `main1.png;main2.png`

## SKU 规格维度

products 表支持动态规格（1-3 个维度）：

```
sku_1_name = 款式
sku_1_values = 黄色
sku_2_name = 容量
sku_2_values = 整卷--1000贴;两卷--2000贴;5卷--5000贴
```

## 安全提示

- `.env.local` 包含本地路径，已 gitignore
- `state/` 目录存登录 Cookie，已 gitignore
- 运行截图在 `logs/screenshots/`，已 gitignore

## License

MIT
