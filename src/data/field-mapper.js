/**
 * 字段别名映射 —— 中文表头 → 内部英文字段
 * 支持中文/英文双向，旧表头向后兼容
 */
const logger = require('../helpers/logger');

// ═══════════════════════════════════════════════
// 工作表名别名
// ═══════════════════════════════════════════════
const SHEET_ALIASES = {
  '商品表': 'products',
  '商品主表': 'products',
  'products': 'products',

  '属性表': 'attributes',
  '商品属性': 'attributes',
  'attributes': 'attributes',

  'sku表': 'sku',
  '规格价格表': 'sku',
  'sku': 'sku',
};

// ═══════════════════════════════════════════════
// 商品表字段别名 → product_id
// ═══════════════════════════════════════════════
const PRODUCT_FIELD_MAP = {
  '商品id': 'product_id',
  '商品编号': 'product_id',
  'product_id': 'product_id',

  '商品模板': 'template_id',
  '模板': 'template_id',
  '模板id': 'template_id',
  'template_id': 'template_id',
  'template': 'template_id',

  '商品标题': 'title',
  '标题': 'title',
  'title': 'title',

  '参考链接': 'reference_url',
  '同类链接': 'reference_url',
  'reference_url': 'reference_url',

  '类目路径': 'category_path',
  '商品类目': 'category_path',
  'category_path': 'category_path',

  '图片文件夹': 'asset_dir',
  '图片目录': 'asset_dir',
  '素材文件夹': 'asset_dir',
  'asset_dir': 'asset_dir',

  '主图': 'main_images',
  '主图目录': 'main_images',
  'main_images': 'main_images',

  '详情图': 'detail_image',
  '详情图目录': 'detail_image',
  'detail_image': 'detail_image',

  'sku图目录': 'sku_images',
  'sku图片目录': 'sku_images',
  'sku_images': 'sku_images',

  '规格1名称': 'sku_1_name', '规格1选项': 'sku_1_values',
  'sku_1_name': 'sku_1_name', 'sku_1_values': 'sku_1_values',

  '规格2名称': 'sku_2_name', '规格2选项': 'sku_2_values',
  'sku_2_name': 'sku_2_name', 'sku_2_values': 'sku_2_values',

  '规格3名称': 'sku_3_name', '规格3选项': 'sku_3_values',
  'sku_3_name': 'sku_3_name', 'sku_3_values': 'sku_3_values',

  '运费模板': 'freight_template',
  'freight_template': 'freight_template',

  '发布模式': 'publish_mode',
  'publish_mode': 'publish_mode',

  '备注': 'remark',
  'remark': 'remark',
};

// ═══════════════════════════════════════════════
// 属性表字段别名
// ═══════════════════════════════════════════════
const ATTR_FIELD_MAP = {
  '商品id': 'product_id',
  '商品编号': 'product_id',
  'product_id': 'product_id',
  // 属性名/属性值保持中文
};

// ═══════════════════════════════════════════════
// SKU表字段别名
// ═══════════════════════════════════════════════
const SKU_FIELD_MAP = {
  '商品id': 'product_id',
  '商品编号': 'product_id',
  'product_id': 'product_id',

  '库存': '库存', '拼单价': '拼单价', '单买价': '单买价',
  '规格编码': '规格编码',
  'sku预览图': 'SKU预览图', 'sku图片': 'SKU预览图', '预览图': 'SKU预览图',
  'SKU预览图': 'SKU预览图',
  '重量': '重量', '条码': '条码', '备注': '备注',

  'stock': '库存', 'group_price': '拼单价', 'single_price': '单买价',
  'spec_code': '规格编码', 'preview': 'SKU预览图',
  'weight': '重量', 'barcode': '条码', 'remark': '备注',
};

// ═══════════════════════════════════════════════
// template_id 中文值映射
// ═══════════════════════════════════════════════
const TEMPLATE_VALUE_MAP = {
  '不干胶标签': 'print_label',
  '标签贴纸': 'print_label',
  'print_label': 'print_label',

  '食品快消': 'food_snack',
  '食品': 'food_snack',
  'food_snack': 'food_snack',

  '日用品': 'daily_goods',
  'daily_goods': 'daily_goods',

  '通用模板': 'generic',
  '通用': 'generic',
  'generic': 'generic',

  '汽车用品': 'car_accessory',
  '汽车外饰': 'car_accessory',
  'car_accessory': 'car_accessory',
};

// ═══════════════════════════════════════════════
// publish_mode 中文值映射
// ═══════════════════════════════════════════════
const PUBLISH_MODE_MAP = {
  '草稿': 'draft',
  '保存草稿': 'draft',
  'draft': 'draft',
  '发布': 'submit',
  '提交上架': 'submit',
  'submit': 'submit',
};

// ═══════════════════════════════════════════════
// 应用函数
// ═══════════════════════════════════════════════

/**
 * 解析工作表名
 */
function resolveSheetName(name) {
  // 精确匹配
  if (SHEET_ALIASES[name]) return SHEET_ALIASES[name];
  // 去空格后匹配
  const trimmed = name.trim();
  if (SHEET_ALIASES[trimmed]) return SHEET_ALIASES[trimmed];
  // 中文关键词模糊匹配
  const lower = trimmed.toLowerCase();
  if (lower.includes('商品') && (lower.includes('表') || lower.includes('主'))) return 'products';
  if (lower.includes('属性')) return 'attributes';
  if (lower.includes('sku') || lower.includes('规格') || lower.includes('价格表')) return 'sku';
  // 英文兼容
  if (lower === 'products') return 'products';
  if (lower === 'attributes') return 'attributes';
  if (lower === 'sku') return 'sku';
  return name;
}

/**
 * 将一行数据的字段名映射为内部英文字段
 * @param {Object} row - { '商品ID': 'xxx', '商品标题': 'yyy' }
 * @param {string} sheetType - 'products' | 'attributes' | 'sku'
 * @returns {Object} - { product_id: 'xxx', title: 'yyy' }
 */
function translateRow(row, sheetType) {
  const map = sheetType === 'products' ? PRODUCT_FIELD_MAP
    : sheetType === 'attributes' ? ATTR_FIELD_MAP
    : sheetType === 'sku' ? SKU_FIELD_MAP : {};

  const translated = {};
  for (const [key, value] of Object.entries(row)) {
    const internalKey = map[key.toLowerCase()] || map[key] || key;
    translated[internalKey] = value;
  }

  // 特殊处理：template_id 中文值 → 英文值
  if (translated.template_id && TEMPLATE_VALUE_MAP[translated.template_id]) {
    translated.template_id = TEMPLATE_VALUE_MAP[translated.template_id];
  }

  // 特殊处理：publish_mode 中文值 → 英文值
  if (translated.publish_mode && PUBLISH_MODE_MAP[translated.publish_mode]) {
    translated.publish_mode = PUBLISH_MODE_MAP[translated.publish_mode];
  }

  return translated;
}

/**
 * 将整个工作表的数据进行字段翻译
 */
function translateSheet(rows, sheetName) {
  const resolvedName = resolveSheetName(sheetName);
  if (!rows || rows.length === 0) return [];
  return rows.map(row => translateRow(row, resolvedName));
}

module.exports = { translateSheet, translateRow, resolveSheetName, SHEET_ALIASES };
