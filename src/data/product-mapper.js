/**
 * 将 Excel 原始数据 → 类型化的 Product 对象（支持3工作表）
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../helpers/logger');

/**
 * 解析产品图片基础目录
 */
function findImageDir(productId) {
  const assetDir = path.join(config.paths.assets, productId);
  if (fs.existsSync(assetDir)) return assetDir;
  if (fs.existsSync(config.paths.labels)) return config.paths.labels;
  return null;
}

/**
 * 读取子目录下所有图片文件（按文件名排序）
 */
function readFolderImages(folderPath) {
  if (!folderPath || !fs.existsSync(folderPath)) return [];
  try {
    const files = fs.readdirSync(folderPath)
      .filter(f => /\.(png|jpe?g|gif|webp|bmp)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return files.map(f => path.join(folderPath, f));
  } catch { return []; }
}

/**
 * 匹配图片文件
 *
 * 支持三种模式:
 *   1. "main"  → 读取 {imageDir}/main/ 下全部图片
 *   2. "detail" → 读取 {imageDir}/detail/ 下全部图片
 *   3. 具体文件名/通配符 → 在 imageDir 根目录匹配（向后兼容）
 */
function matchImages(imageDir, pattern) {
  if (!imageDir || !fs.existsSync(imageDir)) return [];

  const rawPatterns = String(pattern || '').split(/[;,，；]/).map(s => s.trim()).filter(Boolean);
  if (rawPatterns.length === 0) return [];

  const matched = [];

  for (const pat of rawPatterns) {
    // ---- 模式: 子文件夹关键词（英文 + 中文，优先匹配不合并） ----
    let targetFolder = null;
    const p = pat.toLowerCase();
    if (p === 'main' || p === 'main/' || pat === '主图') {
      // 优先匹配用户写的名称，找不到再试另一个
      const preferred = pat === '主图' ? '主图' : 'main';
      const fallback = pat === '主图' ? 'main' : '主图';
      for (const fn of [preferred, fallback]) {
        const dir = path.join(imageDir, fn);
        const imgs = readFolderImages(dir);
        if (imgs.length > 0) {
          logger.info(`  ${fn}/ → ${imgs.length} images: ${imgs.map(f => path.basename(f)).join(', ')}`);
          matched.push(...imgs);
          targetFolder = fn;
          break;  // 找到一个就停，不合并
        }
      }
      if (!targetFolder) logger.warn(`  main/主图 folders empty or not found under ${imageDir}`);
      continue;
    }

    if (p === 'detail' || p === 'detail/' || pat === '详情图') {
      const preferred = pat === '详情图' ? '详情图' : 'detail';
      const fallback = pat === '详情图' ? 'detail' : '详情图';
      for (const fn of [preferred, fallback]) {
        const dir = path.join(imageDir, fn);
        const imgs = readFolderImages(dir);
        if (imgs.length > 0) {
          logger.info(`  ${fn}/ → ${imgs.length} images: ${imgs.map(f => path.basename(f)).join(', ')}`);
          matched.push(...imgs);
          targetFolder = fn;
          break;
        }
      }
      if (!targetFolder) logger.warn(`  detail/详情图 folders empty or not found under ${imageDir}`);
      continue;
    }

    // ---- 模式: 具体文件名/通配符（向后兼容） ----
    const allFiles = fs.readdirSync(imageDir);
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
 * 解析 SKU 预览图的完整路径
 *   1. 先查 {imageDir}/sku/{filename}
 *   2. 再查 {imageDir}/{filename}（向后兼容根目录）
 */
function resolveSkuPreviewPath(imageDir, previewFile) {
  if (!previewFile || !imageDir) return '';

  const basename = path.basename(String(previewFile));
  if (!basename) return '';

  // 按优先级查找: SKU图/ → sku/ → 根目录
  for (const folderName of ['SKU图', 'sku']) {
    const subFile = path.join(imageDir, folderName, basename);
    if (fs.existsSync(subFile)) {
      logger.info(`  SKU preview: ${folderName}/${basename} ✓`);
      return subFile;
    }
  }

  // 回退到根目录
  const rootFile = path.join(imageDir, basename);
  if (fs.existsSync(rootFile)) {
    logger.info(`  SKU preview: ${basename} ✓ (root)`);
    return rootFile;
  }

  logger.warn(`  SKU preview not found: SKU图/${basename}, sku/${basename}, or ${basename}`);
  return '';
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

    const previewPath = resolveSkuPreviewPath(imageDir, previewFile);

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

module.exports = { mapProduct, findImageDir, matchImages, readFolderImages, resolveSkuPreviewPath, extractDimensions, extractSkuRows };
