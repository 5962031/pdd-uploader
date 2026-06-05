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
