/**
 * 将 Excel 原始数据 → 类型化的 Product 对象（支持3工作表）
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../helpers/logger');

/**
 * 解析产品图片目录
 */
function findImageDir(productId) {
  const assetDir = path.join(config.paths.assets, productId);
  if (fs.existsSync(assetDir)) return assetDir;
  if (fs.existsSync(config.paths.labels)) return config.paths.labels;
  return null;
}

/**
 * 匹配图片文件
 */
function matchImages(imageDir, pattern) {
  if (!imageDir || !fs.existsSync(imageDir)) return [];

  const patterns = String(pattern || '').split(/[;,，；]/).map(s => s.trim()).filter(Boolean);
  if (patterns.length === 0) return [];

  const allFiles = fs.readdirSync(imageDir);
  const matched = [];

  for (let pat of patterns) {
    const basename = path.basename(pat);
    const searchName = basename || pat;

    if (allFiles.includes(searchName)) {
      matched.push(path.join(imageDir, searchName));
      continue;
    }

    const lowerName = searchName.toLowerCase();
    const caseMatch = allFiles.find(f => f.toLowerCase() === lowerName);
    if (caseMatch) {
      matched.push(path.join(imageDir, caseMatch));
      continue;
    }

    if (searchName.includes('*')) {
      const regex = new RegExp('^' + searchName.replace(/\*/g, '.*') + '$', 'i');
      allFiles.filter(f => regex.test(f)).sort().forEach(f => matched.push(path.join(imageDir, f)));
    }
  }

  return matched;
}

/**
 * @typedef {Object} Product
 * @property {string} productId
 * @property {string} title
 * @property {string[]} mainImages
 * @property {string} detailImage
 * @property {Array<{name:string, label:string, value:string}>} attributes
 * @property {Array<{name:string, values:string[]}>} skuDimensions
 * @property {Array<{specs:string[], stock:string, groupPrice:string, singlePrice:string, specCode:string, previewImage:string}>} skuRows
 * @property {string} categoryPath
 * @property {string} freightTemplate
 * @property {Object} _source
 */

/**
 * 从 products 工作表提取规格维度（去重排序，按 sku 表出现顺序）
 */
function extractDimensions(skuSheet, productId) {
  const skuRows = skuSheet.filter(r =>
    String(r.product_id || '').trim() === productId
  );
  if (skuRows.length === 0) return [];

  const dims = [];
  const sampleRow = skuRows[0];
  const keys = Object.keys(sampleRow);

  // 识别规格列（非 product_id / 库存 / 价格 / 编码 / 预览图）
  const skipKeys = new Set([
    'product_id', '库存', '拼单价', '单买价', '规格编码', 'sku预览图',
    'stock', 'group_price', 'single_price', 'spec_code', 'preview',
  ]);

  for (const key of keys) {
    const lower = key.toLowerCase().trim();
    if (skipKeys.has(key) || skipKeys.has(lower)) continue;

    const values = [];
    const seen = new Set();
    for (const row of skuRows) {
      const v = String(row[key] || '').trim();
      if (v && !seen.has(v)) {
        seen.add(v);
        values.push(v);
      }
    }

    if (values.length > 0) {
      dims.push({ name: key, values });
    }
  }

  return dims;
}

/**
 * 从 sku 工作表提取 SKU 行数据
 */
function extractSkuRows(skuSheet, productId, imageDir) {
  const rows = skuSheet.filter(r =>
    String(r.product_id || '').trim() === productId
  );
  if (rows.length === 0) return [];

  const dims = extractDimensions(skuSheet, productId);
  const dimNames = dims.map(d => d.name);

  return rows.map(row => {
    const specs = dimNames.map(n => String(row[n] || '').trim());
    const stock = String(row['库存'] || row['stock'] || '999');
    const groupPrice = String(row['拼单价'] || row['group_price'] || '9.9');
    const singlePrice = String(row['单买价'] || row['single_price'] || '10.9');
    const specCode = String(row['规格编码'] || row['spec_code'] || '');
    const previewFile = String(row['SKU预览图'] || row['preview'] || '');

    // 解析预览图路径
    let previewPath = '';
    if (previewFile && imageDir) {
      const full = path.join(imageDir, path.basename(previewFile));
      previewPath = fs.existsSync(full) ? full : '';
    }

    return { specs, stock, groupPrice, singlePrice, specCode, previewImage: previewPath };
  });
}

/**
 * 主映射函数
 * @param {Object} productRow - products 工作表的行
 * @param {Array} attrSheet - attributes 工作表
 * @param {Array} skuSheet - sku 工作表
 */
function mapProduct(productRow, attrSheet, skuSheet) {
  const productId = String(productRow.product_id || '').trim();
  const imageDir = findImageDir(productId);

  // 图片
  const mainImages = productRow.main_images
    ? matchImages(imageDir || config.paths.labels, productRow.main_images)
    : [];
  const detailImage = productRow.detail_image
    ? matchImages(imageDir || config.paths.labels, productRow.detail_image)[0] || ''
    : '';

  // 属性
  const attributes = (attrSheet || [])
    .filter(r => String(r.product_id || '').trim() === productId)
    .map(r => ({
      name: String(r['属性名'] || r['属性名称'] || '').trim(),
      value: String(r['属性值'] || '').trim(),
    }))
    .filter(a => a.name && a.value);

  // SKU 规格维度
  const skuDimensions = extractDimensions(skuSheet || [], productId);

  // SKU 行
  const skuRows = extractSkuRows(skuSheet || [], productId, imageDir);

  const product = {
    productId,
    title: productRow.title || '',
    mainImages,
    detailImage,
    attributes,
    skuDimensions,
    skuRows,
    categoryPath: productRow.category_path || '',
    freightTemplate: productRow.freight_template || '默认模板',
    _source: { productRow, attrSheet, skuSheet },
  };

  logger.info(`Mapped: ${productId} | ${mainImages.length} imgs | ${attributes.length} attrs | ${skuRows.length} SKUs`);
  return product;
}

module.exports = { mapProduct, findImageDir, matchImages, extractDimensions, extractSkuRows };
