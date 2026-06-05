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

# 2. 配置环境变量（复制示例文件并修改）
cp .env.local.example .env.local

# 3. 准备商品数据
#    编辑 D:\pddtest\资料表\products.xlsx

# 4. 干跑校验（不开浏览器）
node src/index.js --dry-run

# 5. 正式运行（填完停住，不发布）
node src/index.js

# 6. 批量模式（逐个商品，人工确认）
node src/index.js --batch
```

## 项目结构

```
src/
├── index.js              # 主入口
├── config.js             # 集中配置
├── browser/              # 浏览器启动 + 登录态管理
├── data/                 # Excel读取 + 商品映射 + 校验 + 类目
├── pages/                # 分类选择 + 发布守护
├── actions/              # 表单填写（标题/图片/属性/规格/价格）
└── helpers/              # 日志/截图/JS点击回退
```

## 命令行参数

| 参数 | 说明 |
|------|------|
| `--dry-run` | 只校验数据，不开浏览器 |
| `--batch` | 批量模式，一个商品完成后等待确认 |
| `--publish` | 自动发布（慎用） |
| `--product=id` | 指定商品 ID |
| `--verbose` | 详细日志 |

## 安全提示

- `.env.local` 包含本地路径，已 gitignore
- `state/` 目录存登录 Cookie，已 gitignore
- 运行截图在 `logs/screenshots/`，已 gitignore
- 不要提交任何含登录态的文件

## License

MIT
