# Runbook — Windows 运行手册

## 前置条件

- Windows 10/11
- Node.js >= 18（已安装 `node -v` 确认）
- Google Chrome 已安装
- 拼多多商家后台账号

## 1. 安装

```powershell
cd D:\pddtest\pdd-uploader

# 安装依赖（跳过下载 Playwright 自带浏览器）
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm install
```

## 2. 配置 .env.local

```powershell
# .env.local 已创建在项目根目录，编辑它：
notepad .env.local
```

```ini
# 内容示例 —— 改成你的实际路径：
PDD_ROOT=D:\\pddtest
PDD_CHROME_USER_DATA=C:\\Users\\你的用户名\\chrome-debug-profile
PDD_CHROME_EXE=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe
PDD_CDP_PORT=9222
```

**注意**：`.env.local` 已在 `.gitignore` 中，不会上传到 GitHub。

## 3. 启动 Chrome 调试模式

**每次运行前**，先启动带调试端口的 Chrome：

```powershell
# 方式一：Win+R 运行
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\Users\你的用户名\chrome-debug-profile"
```

**方式二**：第一次手动打开 Chrome，在地址栏输入 `chrome://inspect/#remote-debugging`，勾选 "Allow remote debugging"。

Chrome 启动后，在浏览器里登录拼多多商家后台（`mms.pinduoduo.com`），完成扫码登录。以后登录态会自动保存到 `chrome-debug-profile` 中。

## 4. 准备商品数据

编辑 `D:\pddtest\资料表\products.xlsx`，确保：
- 字段名和值配对正确
- 图片路径指向存在的文件
- SKU 价格、规格值已填写

## 5. 执行命令

**在项目根目录 `D:\pddtest\pdd-uploader` 下执行：**

```powershell
# 干跑校验 —— 只检查数据是否正确，不开浏览器
npm run dry-run

# 如果有错，修正 Excel 后再次 dry-run，直到通过

# 正式运行 —— 单个商品（第一个），填完停住不发布
npm run run

# 指定商品运行
npm run run:label

# 批量模式 —— 逐个商品，每个填完后按 Enter 继续
npm run batch

# 自动发布（填完直接提交上架，慎用）
npm run publish
```

## 6. 运行时检查

脚本运行过程中会：
- 在 `logs/screenshots/` 中保存每一步的截图
- 在控制台输出结构化日志
- **最终停在"提交并上架"按钮前** —— 你需要人工确认表单内容后再手动点击发布

## 7. 遇到滑块验证怎么办

拼多多会随机弹出安全验证（滑块/拼图），脚本无法自动处理。

**处理方式**：
- 浏览器窗口是可见的，**手动完成滑块验证**
- 验证通过后脚本会自动继续
- 不需要重启

## 8. 常见问题

### Q: "CDP attach failed"
打开 Chrome 时没加 `--remote-debugging-port=9222` 参数。关闭所有 Chrome 窗口后按第3步重新启动。

### Q: "Session expired, need re-login"
登录态过期。在 Chrome 窗口重新登录拼多多商家后台即可。

### Q: "Title input not found"
页面没有加载到发布表单。检查：
1. 是否登录了商家后台
2. 类目选择是否成功（查看截图 `03_category_page`）
3. 网络是否正常

### Q: "Spec type not found in dropdown options"
规格下拉中找不到 Excel 指定的规格名。检查 Excel 中的规格名称是否与 PDD 后台显示的选项一致（常见选项：款式、材质、容量、尺寸、颜色、套餐、成份等）。

### Q: SKU 价格没填上
PDD 表单使用 React，偶尔 `fill()` 不生效。脚本会尝试 JS 回退方式填入。如果仍然失败，查看截图 `09_sku_table` 手动补填。

## 9. 目录结构速查

| 目录/文件 | 用途 |
|-----------|------|
| `.env.local` | 本地配置（不提交 Git） |
| `state/` | 登录 Cookie（不提交 Git） |
| `logs/screenshots/` | 运行截图（不提交 Git） |
| `docs/RUNBOOK.md` | 本手册 |
| `PROJECT_STATUS.md` | 项目进度 |
| `src/index.js` | 主入口 |
| `src/data/` | Excel读取、商品映射、校验、类目 |
| `src/actions/` | 表单填写各模块 |
