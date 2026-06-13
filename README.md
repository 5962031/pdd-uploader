# my test ❌❌❌

mytest工具。从 Excel 读取商品数据，用 Playwright 驱动浏览器自动填写发布表单，停在提交前等待人工确认。

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

推荐使用中文模板：`docs/products_中文模板.xlsx`

`D:\pddtest\资料表\products.xlsx`（3个核心工作表）：

| 工作表 | 别名 | 用途 |
|--------|------|------|
| 商品表 | products | 商品基础信息 |
| 属性表 | attributes | 商品属性 |
| SKU表 | sku | SKU 明细 |

### 商品表字段（支持中/英文双表头）

| 中文表头 | 英文表头 | 说明 |
|---------|---------|------|
| 商品ID | product_id | 三表关联唯一键 |
| 商品模板 | template_id | 不干胶标签/食品快消/日用品/通用模板/汽车用品 |
| 商品标题 | title | 最长30汉字 |
| 类目路径 | category_path | 如: 数码电器>...>不干胶标签 |
| 图片文件夹 | asset_dir | 对应 assets\ 下的文件夹名，留空=商品ID |
| 主图 | main_images | "主图"=读主图\目录, 或文件名列表 |
| 详情图 | detail_image | "详情图"=读详情图\目录 |
| 规格1名称/选项 | sku_1_name/values | 如: 款式=红色;蓝色 |
| 规格2名称/选项 | sku_2_name/values | 如: 容量=50张;100张 |
| 运费模板 | freight_template | 默认模板 |
| 发布模式 | publish_mode | 草稿(默认)/提交上架 |

### 属性表字段

| 中文表头 | 说明 |
|---------|------|
| 商品ID | 关联商品表 |
| 属性名 | 页面属性名 |
| 属性值 | 要填的值 |

### SKU表字段

| 中文表头 | 说明 |
|---------|------|
| 商品ID | 关联商品表 |
| (动态规格列) | 由商品表的规格名称决定 |
| 库存 | 库存数 |
| 拼单价 | 拼单价格 |
| 单买价 | 单独购买价 |
| SKU预览图 | 文件名, 如 red.png |

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
