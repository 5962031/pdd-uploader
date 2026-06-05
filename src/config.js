/**
 * 中央配置文件 —— 所有路径、URL、选择器、超时时间在此集中管理
 *
 * 敏感路径通过环境变量配置，默认值仅作示例。
 * 在项目根目录创建 .env.local 文件来覆盖：
 *   PDD_ROOT=D:\\your-path
 *   PDD_CHROME_USER_DATA=C:\\Users\\xxx\\chrome-debug-profile
 */
const path = require('path');

const ROOT = process.env.PDD_ROOT || 'D:\\pddtest';
const CHROME_USER_DATA = process.env.PDD_CHROME_USER_DATA || 'C:\\Users\\YOUR_USERNAME\\chrome-debug-profile';

module.exports = {
  // ============================================================
  // 浏览器配置
  // ============================================================
  chrome: {
    exePath: process.env.PDD_CHROME_EXE || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    cdpPort: parseInt(process.env.PDD_CDP_PORT || '9222', 10),
    userDataDir: CHROME_USER_DATA,
    // 使用系统已安装的 Chrome，不下载 Playwright 自带浏览器
    channel: 'chrome',
  },

  // ============================================================
  // 路径配置
  // ============================================================
  paths: {
    root: ROOT,
    state: path.join(ROOT, 'pdd-uploader', 'state', 'pdd-auth.json'),
    excel: path.join(ROOT, '资料表', 'products.xlsx'),
    assets: path.join(ROOT, 'assets'),
    labels: path.join(ROOT, '标签'),
    screenshots: path.join(ROOT, 'pdd-uploader', 'logs', 'screenshots'),
  },

  // ============================================================
  // MMS 商家后台 URL
  // ============================================================
  urls: {
    mmsLogin: 'https://mms.pinduoduo.com/login',
    mmsHome: 'https://mms.pinduoduo.com/home',
    goodsList: 'https://mms.pinduoduo.com/goods/goods_list',
    goodsCategory: 'https://mms.pinduoduo.com/goods/category',
    goodsPublish: 'https://mms.pinduoduo.com/goods/goods_add/index',
  },

  // ============================================================
  // 支持的商品类目（先只支持一个）
  // ============================================================
  category: {
    path: [
      '数码电器',
      '文具电教/文化用品/商务用品',
      '纸张本册',
      '不干胶标签',
    ],
    leafName: '不干胶标签',
  },

  // ============================================================
  // 表单选择器 —— 集中管理，按需修改
  // ============================================================
  selectors: {
    // --- 分类页 ---
    category: {
      recentUsed: 'text=最近使用的分类',
      confirmBtn: 'button:has-text("确认发布该类商品")',
      searchBox: 'input[placeholder*="搜索分类"]',
    },

    // --- 基本信息 ---
    basicInfo: {
      title: 'textarea[placeholder*="标题"], input[placeholder*="标题"]',
      titleRole: 'textbox[name*="标题"]',
      mainImageUpload: 'input[type=file]',
      mainImageArea: 'text=上传图片',
      sidebarBasicInfo: 'text=基本信息',
    },

    // --- 商品属性 (通过label文字定位最近的select) ---
    attributes: {
      // key: label文本, value: { type: 'select'|'text', value: '要填的值' }
      // 这些会在运行时根据 product 数据动态填充
    },

    // --- 规格与库存 ---
    spec: {
      addSpecBtn: 'button:has-text("添加规格类型")',
      specTypeInput: (n) => `textbox[name="规格类型${n}"]`,
      customSpecInput: (name) => `textbox[name="自定义${name}"]`,
      sidebarSpecStock: 'text=规格与库存',
    },

    // --- SKU 表格 ---
    skuTable: {
      rows: 'tr',
      rowFilter: '已启用',
      emptyInput: 'input[placeholder="请输入"]',
      batchStock: 'textbox[name="库存"]',
      batchGroupPrice: 'textbox[name="拼单价"]',
      batchSinglePrice: 'textbox[name="单买价"]',
      batchSetBtn: 'button:has-text("批量设置")',
      fullscreenEdit: 'text=全屏编辑',
    },

    // --- 底部按钮 ---
    footer: {
      saveDraft: 'button:has-text("保存草稿")',
      submit: 'button:has-text("提交并上架")',
      errorPrompts: '[data-tracking-click-viewid="error_prompts"]',
    },

    // --- 侧边栏导航 ---
    sidebar: {
      specStock: 'text=规格与库存',
      servicePromise: 'text=服务与承诺',
    },
  },

  // ============================================================
  // 超时时间 (毫秒)
  // ============================================================
  timeouts: {
    default: 10000,
    short: 3000,
    upload: 30000,
    login: 120000,
    pageLoad: 15000,
    reactRerender: 500,
    skuRowFill: 80,
  },

  // ============================================================
  // PDD MMS 表单自定义 test-id 前缀
  // ============================================================
  testIds: {
    selectInput: 'beast-core-select-htmlInput',
    selectHighlight: 'beast-core-select-highlight',
    input: 'beast-core-input-htmlInput',
    button: 'beast-core-button',
  },
};
