# Project Status — pdd-uploader

> 最后更新: 2026-06-05

## 当前阶段

**端到端就绪** — .env.local 已配置、dotenv 已集成、运行手册已编写。
等待首次 label_001 端到端测试。

## .env.local 支持

✅ 已安装 `dotenv`，在 `src/index.js` 最开头加载：

```js
require('dotenv').config({ path: '.env.local' });
```

`.env.local` 包含以下本地路径（不提交 Git）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PDD_ROOT` | 项目根目录 | `D:\pddtest` |
| `PDD_CHROME_USER_DATA` | Chrome 用户数据目录 | `C:\Users\22303\chrome-debug-profile` |
| `PDD_CHROME_EXE` | Chrome 可执行文件 | 系统默认路径 |
| `PDD_CDP_PORT` | CDP 调试端口 | `9222` |

## 已完成 ✅

| 模块 | 状态 |
|------|:--:|
| 浏览器启动（CDP + Channel） | ✅ |
| 登录态保存/恢复 | ✅ |
| Excel 读取（竖排/横排自动检测） | ✅ |
| 商品数据映射 + 图片匹配 | ✅ |
| 字段校验（标题/图片/SKU） | ✅ |
| 类目映射表（7个类目已注册） | ✅ |
| 分类选择（最近使用 + 搜索回退） | ✅ |
| 基本信息填写（标题 + 主图上传） | ✅ |
| 属性选择（图案/风格/场景/定制/工艺） | ✅ |
| SKU 规格设置 | ✅ |
| SKU 价格表填充（fill + JS fallback） | ✅ |
| 发布守护（停住不提交） | ✅ |
| 批量模式（--batch 人工确认） | ✅ |
| 干跑模式（--dry-run 只校验） | ✅ |
| .env.local 加载 | ✅ |
| 安全审计 + .gitignore | ✅ |
| 运行手册（docs/RUNBOOK.md） | ✅ |

## 最近修复

### 2026-06-05: 登录等待 bug (#1)

**问题**: `npm run run:label` 运行时 CDP 连接成功，但登录步骤瞬间失败报 `Login timeout`。

**根因**: `src/browser/session.js` 中 `waitForLogin()` 使用了：
```js
page.waitForURL(url => !url.includes('/login'))
```
Playwright 传给回调的是 `URL` 对象而非字符串，`.includes()` 返回了异常，catch 块又吞掉了真实错误。

**修复**:
- 改用 `page.waitForFunction(() => !window.location.href.includes('/login'))` —— 在浏览器上下文直接判断 `location.href`，不依赖 Playwright 传参类型
- catch 块打印真实错误类型、消息、当前 URL
- 增加二次检查（race condition 兜底）
- 轮询间隔设为 2 秒（减少 CPU 占用）

### 2026-06-05: 类目选择卡住 (#2)

**问题**: 登录成功后进入分类页，`selectCategory()` 无法完成类目选择。"最近使用的分类" 不可见时回退逻辑失效，确认按钮文本匹配过于严格（只匹配"确认发布该类商品"）。

**修复** (`src/pages/category-page.js`):

1. **调试输出** — `debugPageState()` 打印当前 URL、所有按钮文本、含关键词的元素
2. **逐级点击** — 按 `category_path` 逐级点击类目树，每级截图
3. **多文本匹配** — 兼容 "确认发布该类/此商品"、"发布该类商品"、"确认"、"下一步"
4. **人工辅助模式** — 自动失败后提示用户手动选类目，按 Enter 继续
5. **JS 回退点击** — Playwright click 失败后用 `page.evaluate` 直接找元素点击

### 2026-06-05: 类目选择修复 (#3)

**问题 1**: JS fallback 的 `clickByText()` 无论是否找到元素都返回 true，导致日志显示 "✓ Clicked 不干胶标签" 但实际选中的是 "贺卡/明信片"。

**问题 2**: `findConfirmButton()` 匹配了 "发布新商品"（导航栏按钮），而不是底部蓝色 "确认发布该类商品"。

**问题 3**: `debugPageState()` 的 buttons slice 只有 15 个，底部确认按钮未被打印。

**修复**:
1. `clickByText()` 现在返回 `true/false`，`page.evaluate` 必须找到元素并点击才返回非 false 值
2. `findConfirmButton()` 现在使用白名单 + 黑名单：
   - 白名单: "确认发布该类商品", "确认发布此类商品", "确认发布这类商品", "确认发布"
   - 黑名单（禁止匹配）: "发布新商品", "发布机会商品", "发布同款", "发布相似品"
3. `debugPageState()` buttons slice 改为 80，并单独打印含 "确认" 的元素
4. 新增 `readSelectedCategory()` — 点击完类目后读取页面"已选分类"文本
5. 最终校验：只有已选分类包含目标叶子名称时才点确认，否则进入 `manualAssist()`

### 2026-06-05: 分类页页面锁定 + manual assist 误读 goods_list (#4)

**问题**: manual assist 后脚本仍操作 `goods_list` 页面而非 `/goods/category`。"发布新商品" 在新标签页打开分类页，但 page 引用未切换。

**修复**:
1. `selectCategory()` 签名改为 `(context, page, categoryPath)`，传入 context 以查找页面
2. `ensureCategoryPage()` — 在 `context.pages()` 中查找 `/goods/category` 并 `bringToFront()`
3. `readSelectedCategory()` — 改用 `document.body.innerText` 匹配，不依赖 CSS selector
4. 类目校验用 `body.innerText.includes(expectedLeaf)` 宽松匹配
5. `findConfirmButton()` — `getByText(ct, { exact: true })` 精确匹配，扫描 span/div 非 button 元素
6. `manualAssist()` — `bringToFront()` → 读 body → 验证 → 点确认
7. `index.js` 调用处改为 `selectCategory(page.context(), page, categoryPath)`

### 2026-06-05: 最近使用分类误判为已选 (#5)

**问题**: `readCategoryState()` 用 `body.innerText` 全页面匹配，把顶部"最近使用的分类：… > 不干胶标签"误判为底部"已选分类"。实际类目树未被点击。

**修复**:
1. 废弃 `readSelectedCategory()`，新增 `readCategoryState()` — 分别返回 `recentPath` 和 `selectedPath`
2. `selectedPath` 只从页面底部 "已选分类" 标签后面提取
3. `recentPath` 仅日志参考，**不作为已选依据**
4. 新增 `isCategoryCorrect()` 只检查底部 `selectedPath`
5. 逐级点击后重新用 `readCategoryState()` 验证
6. manual assist 后同样重新读取底部已选分类

### 2026-06-05: 属性字段动态识别 + SKU 按行序填充 (#6)

**属性问题**: 硬编码的 "图案/风格/适用场景" 等标签在当前类目不干胶标签页面中不存在，全部 WARN。

**属性修复** (`fill-attributes.js`):
1. `inspectAttributes()` — 扫描页面上所有真实属性字段（select + text input）
2. 优先使用 Excel `attributes_json` 字段（JSON格式），按真实字段名匹配填写
3. 找不到的属性只 WARN，不影响后续流程

**SKU问题**: 2/9 行填了（22%），合并单元格导致后续行不重复显示 "款式" 文本，文本匹配失败。

**SKU修复** (`fill-sku-table.js`):
1. `allSamePrice()` — 检测是否所有行价格一致 → 自动切换批量模式
2. `batchFillSkuTable()` — 统一填所有行，不依赖文本匹配
3. 逐行模式改为按行序匹配（行1→SKU1, 行2→SKU2...），不读文本
4. `inspectSkuTable()` — 打印每行文本+input数量+值，方便调试
5. JS fallback — fill() 失败后用原生 setter 兜底
6. 填完后校验：stock/group/single 不为空

### 2026-06-05: 3工作表 Excel 架构重构 (#7)

**改动范围**：`excel-reader.js`、`product-mapper.js`、`fill-attributes.js`、`fill-sku-table.js`、`index.js`

**新 Excel 结构**（3个工作表）：

| 工作表 | 用途 | 格式 |
|--------|------|------|
| `products` | 商品基础信息 | 竖排 字段/值 |
| `attributes` | 商品属性 | product_id / 属性名 / 属性值 |
| `sku` | SKU价格库存 | product_id / 规格列 / 库存 / 拼单价 / 单买价 / 规格编码 / SKU预览图 |

**关键变更**：
- 属性不再硬编码 → 从 `attributes` 工作表逐项读取填写
- SKU 价格不再统一填 → 每行独立 库存/拼单价/单买价/预览图
- `readWorkbook()` 替代 `readProducts()`，返回 `{ products, attributes, sku }`
- `mapProduct()` 接收3参数：`(productRow, attrSheet, skuSheet)`
- `extractDimensions()` 自动从 sku 工作表提取规格维度（款式/容量等）
- `batchMode()` 传递 `workbook` 对象

### 2026-06-05: 属性定位修复 + SKU预览图严格读取 (#8)

**属性修复**: `scanPageAttributeRows()` — 扫描页面所有属性行（含 select 和 text input 的 div 块），按 label 匹配。不再依赖 `text=` locator。

**SKU预览图修复**:
- `resolvePreviewPath()` — 严格从 `D:\pddtest\assets\{productId}\{previewFile}` 读取
- 图片缺失时只 WARN，不 fallback 到主图
- 每行打印款式/容量/价格/预览图路径/文件是否存在
- dry-run 增加 SKU 预览图检查

## 下一步：label_001 端到端测试

### 测试步骤

1. **启动 Chrome 调试模式**（参考 `docs/RUNBOOK.md` 第3步）
2. **在 Chrome 中登录拼多多商家后台**
3. **干跑校验**：
   ```powershell
   cd D:\pddtest\pdd-uploader
   npm run dry-run
   ```
   预期输出：`✅ label_001: 校验通过`
4. **真实填表**：
   ```powershell
   npm run run:label
   ```
   预期：自动填写"不干胶标签"商品，停在提交前
5. **人工检查**：查看浏览器中的表单，确认标题/图片/属性/SKU价格是否正确
6. **手动发布**：点击"提交并上架"

### 测试通过标准
- [ ] dry-run 输出 ✅
- [ ] 标题正确填入
- [ ] 主图上传成功
- [ ] 属性下拉全部选中
- [ ] SKU 表格全部9行有价格和库存
- [ ] 停在提交按钮前，未自动发布
- [ ] 截图保存在 logs/screenshots/

## 已知问题

1. SKU 预览图未自动上传（提交时会报错需手动补）
2. React fill() 偶发不生效（有 JS fallback）
3. 滑块验证需人工处理
4. 未做断点续传
