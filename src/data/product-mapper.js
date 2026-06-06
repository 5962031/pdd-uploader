/**
 * 将 Excel 原始数据 → 类型化的 Product 对象（支持3工作表）
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../helpers/logger');

/**
 * 解析产品图片基础目录
 *
 * @param {string} productId - 程序内部编号
 * @param {string} assetDirOverride - products 表的 asset_dir 字段（优先）
 * @returns {{ imageDir: string, displayName: string }|null}
 */
function findImageDir(productId, assetDirOverride) {
  // 优先使用 asset_dir
  if (assetDirOverride && String(assetDirOverride).trim() !== '') {
    const raw = String(assetDirOverride).trim();
    // 绝对路径直接使用，相对路径拼到 assets/ 下
    const dir = path.isAbsolute(raw) ? raw : path.join(config.paths.assets, raw);
    if (fs.existsSync(dir)) {
      return { imageDir: dir, displayName: raw };
    }
    logger.warn(`  asset_dir "${raw}" not found (${dir}), falling back to product_id`);
  }

  // 回退到 product_id
  const productDir = path.join(config.paths.assets, productId);
  if (fs.existsSync(productDir)) {
    return { imageDir: productDir, displayName: productId };
  }

  // 最后回退到标签目录
  if (fs.existsSync(config.paths.labels)) {
    return { imageDir: config.paths.labels, displayName: 'labels' };
  }

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
  if (!imageDir) return '';
  // previewFile 可以为空字符串（触发自动选择），但 null/undefined 直接返回
  if (previewFile === null || previewFile === undefined) return '';

  const basename = path.basename(String(previewFile || ''));

  // 按优先级查找: SKU图/ → sku/ → 根目录
  const foldersToCheck = ['SKU图', 'sku'];
  logger.debug(`  resolveSkuPreview: imageDir="${imageDir}" basename="${basename}"`);

  for (const folderName of foldersToCheck) {
    const folderPath = path.join(imageDir, folderName);
    const subFile = path.join(folderPath, basename);

    // 精确文件名匹配
    if (basename && fs.existsSync(subFile)) {
      logger.info(`  SKU preview: ${folderName}/${basename} ✓`);
      return subFile;
    }
  }

  // 自动选择：basename为空时
  if (!basename || basename === 'SKU图' || basename === 'sku') {
    for (const folderName of foldersToCheck) {
      const folderPath = path.join(imageDir, folderName);
      if (!fs.existsSync(folderPath)) continue;
      const imgs = readFolderImages(folderPath);
      if (imgs.length === 1) {
        logger.info(`  SKU preview auto-selected: ${folderName}/${path.basename(imgs[0])} ✓`);
        return imgs[0];
      }
      if (imgs.length > 1) {
        logger.warn(`  ${folderName}/ has ${imgs.length} images — specify filename in sku sheet SKU预览图 column`);
      }
    }
  }

  // 回退到根目录
  const rootFile = path.join(imageDir, basename);
  if (basename && fs.existsSync(rootFile)) {
    logger.info(`  SKU preview: ${basename} ✓ (root)`);
    return rootFile;
  }

  if (!basename || basename === 'SKU图' || basename === 'sku') {
    // 根目录下找单张图
    const rootImgs = readFolderImages(imageDir);
    if (rootImgs.length === 1) {
      logger.info(`  SKU preview auto-selected from root: ${path.basename(rootImgs[0])} ✓`);
      return rootImgs[0];
    }
  }

  logger.warn(`  SKU preview not found for: ${basename || '(auto)'}`);
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
 * 从 products 表字段动态提取规格维度
 * 优先读取 sku_1_name/sku_1_values, sku_2_name/sku_2_values, sku_3_name/sku_3_values
 * 如果没有则从 sku 工作表自动推断（向后兼容）
 */
function extractDimensions(productRow, skuSheet, productId) {
  const dims = [];
  const sources = [];

  // 动态读取 products 表的 sku_N_name / sku_N_values
  // 严格匹配 sku_N_name 字段（排除 sku_N_values 和其他类似字段）
  for (let n = 1; n <= 3; n++) {
    const nameKey = `sku_${n}_name`;
    const valuesKey = `sku_${n}_values`;
    const name = productRow[nameKey];
    const valuesRaw = productRow[valuesKey];
    // 只有当 name 字段存在且非空才算
    if (name && String(name).trim() !== '' && nameKey in productRow) {
      const values = String(valuesRaw || '')
        .split(/[;；]/).map(s => s.trim()).filter(Boolean);
      if (values.length > 0) {
        dims.push({ name: String(name).trim(), values });
        sources.push('products_sheet');
      }
    }
  }
  // 清除任何意外被当作维度的 values 字符串
  const valueLike = /^[一-鿿\w]+(?:[;；][一-鿿\w]+)+$/;
  const filtered = dims.filter(d => !valueLike.test(d.name) || d.name.length < 10);
  if (filtered.length !== dims.length) {
    logger.warn(`  Filtered ${dims.length - filtered.length} false dimension(s)`);
  }

  // 如果 products 表有定义，直接返回
  dims.length = 0; dims.push(...filtered);
  if (dims.length > 0) {
    logger.info(`  SKU dims from products sheet: ${dims.map(d => d.name + '(' + d.values.length + ')').join(', ')}`);
    return dims;
  }

  // 向后兼容：从 sku 工作表自动推断
  const skuRows = (skuSheet || []).filter(r =>
    String(r.product_id || '').trim() === productId
  );
  if (skuRows.length === 0) return [];

  const sampleRow = skuRows[0];
  const skipKeys = new Set([
    'product_id', '库存', '拼单价', '单买价', '规格编码', 'sku预览图',
    'stock', 'group_price', 'single_price', 'spec_code', 'preview',
    '重量', '条码', '备注', 'weight', 'barcode', 'remark',
  ]);

  for (const key of Object.keys(sampleRow)) {
    const lower = key.toLowerCase().trim();
    if (skipKeys.has(key) || skipKeys.has(lower)) continue;
    const values = [];
    const seen = new Set();
    for (const row of skuRows) {
      const v = String(row[key] || '').trim();
      if (v && !seen.has(v)) { seen.add(v); values.push(v); }
    }
    if (values.length > 0) dims.push({ name: key, values });
  }

  logger.info(`  SKU dims from sku sheet: ${dims.map(d => d.name + '(' + d.values.length + ')').join(', ')}`);
  return dims;
}

/**
 * 从 sku 工作表提取 SKU 行数据
 * @param {string[]} dimNames - 规格列名列表
 */
function extractSkuRows(skuSheet, productId, imageDir, dimNames) {
  const rows = (skuSheet || []).filter(r =>
    String(r.product_id || '').trim() === productId
  );
  if (rows.length === 0) return [];
  if (!dimNames || dimNames.length === 0) return [];

  return rows.map(row => {
    const specs = dimNames.map(n => String(row[n] || '').trim());
    const stock = String(row['库存'] || row['stock'] || '999');
    const groupPrice = String(row['拼单价'] || row['group_price'] || '9.9');
    const singlePrice = String(row['单买价'] || row['single_price'] || '10.9');
    const specCode = String(row['规格编码'] || row['spec_code'] || '');
    const previewFile = String(row['SKU预览图'] || row['preview'] || row['SKU图'] || row['SKU图片'] || row['预览图'] || '');
    logger.debug(`  SKU raw preview fields: SKU预览图="${row['SKU预览图']}", preview="${row['preview']}", resolved="${previewFile}"`);
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
  const assetDirOverride = String(productRow.asset_dir || '').trim();
  const imgDirResult = findImageDir(productId, assetDirOverride);
  const imageDir = imgDirResult?.imageDir || null;
  const resolvedAssetName = imgDirResult?.displayName || productId;

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

  // SKU 规格维度（优先从 products 表字段，其次从 sku 表推断）
  const skuDimensions = extractDimensions(productRow, skuSheet || [], productId);

  // SKU 行
  const skuRows = extractSkuRows(skuSheet || [], productId, imageDir,
    skuDimensions.map(d => d.name));

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
    assetDir: assetDirOverride,
    resolvedAssetName,
    _source: { productRow, attrSheet, skuSheet },
  };

  logger.info(`Mapped: ${productId} | asset=${resolvedAssetName} | ${mainImages.length} imgs | ${attributes.length} attrs | ${skuRows.length} SKUs`);
  return product;
}

module.exports = { mapProduct, findImageDir, matchImages, readFolderImages, resolveSkuPreviewPath, extractDimensions, extractSkuRows };
