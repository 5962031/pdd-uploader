/**
 * 将 Excel 原始行 → 类型化的 Product 对象
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../helpers/logger');

/**
 * @typedef {Object} SpecDimension
 * @property {string} name - e.g. "款式"
 * @property {string[]} values - e.g. ["红色", "蓝色"]
 */

/**
 * @typedef {Object} SkuRow
 * @property {string[]} specs - e.g. ["红色", "整包50张"]
 * @property {string} groupPrice - 拼单价
 * @property {string} singlePrice - 单买价
 * @property {string} stock - 库存
 */

/**
 * @typedef {Object} Product
 * @property {string} productId
 * @property {string} title
 * @property {string[]} mainImages - 绝对路径
 * @property {string} detailImage - 绝对路径
 * @property {SpecDimension[]} skuDimensions
 * @property {SkuRow[]} skuRows
 * @property {string} categoryPath
 * @property {string} freightTemplate
 */

/**
 * 解析 Excel 商品 ID（如 label_001），提取产品图片目录名
 */
function parseProductId(id) {
  return String(id || '').trim();
}

/**
 * 查找产品对应的图片目录
 * 优先级: assets/{productId}/ > 标签/
 */
function findImageDir(productId) {
  // 先尝试 assets/productId/
  const assetDir = path.join(config.paths.assets, productId);
  if (fs.existsSync(assetDir)) return assetDir;

  // 回退到标签/ 目录
  if (fs.existsSync(config.paths.labels)) return config.paths.labels;

  return null;
}

/**
 * 根据通配符模式匹配图片文件
 * e.g. "main*.png" → ["主图1.png", "主图2.png", ...]
 */
function matchImages(imageDir, pattern) {
  if (!imageDir || !fs.existsSync(imageDir)) return [];

  // 支持逗号/分号分隔的多个模式
  const patterns = pattern.split(/[,;，；]/).map(s => s.trim()).filter(Boolean);

  const allFiles = fs.readdirSync(imageDir);
  const matched = [];

  for (let pat of patterns) {
    // 如果是路径格式 (如 "assets/label_001/main1.png")，只取文件名
    const basename = path.basename(pat);
    const searchName = basename || pat;

    // 精确匹配（按文件名）
    if (allFiles.includes(searchName)) {
      matched.push(path.join(imageDir, searchName));
      continue;
    }

    // 精确匹配（按完整路径）
    if (allFiles.includes(pat)) {
      matched.push(path.join(imageDir, pat));
      continue;
    }

    // 大小写不敏感匹配
    const lowerName = searchName.toLowerCase();
    const caseMatch = allFiles.find(f => f.toLowerCase() === lowerName);
    if (caseMatch) {
      matched.push(path.join(imageDir, caseMatch));
      continue;
    }

    // 通配符匹配
    if (searchName.includes('*')) {
      const regex = new RegExp('^' + searchName.replace(/\*/g, '.*') + '$', 'i');
      const found = allFiles
        .filter(f => regex.test(f))
        .sort()
        .map(f => path.join(imageDir, f));
      matched.push(...found);
    }
  }

  return matched;
}

/**
 * 解析规格值列表
 * e.g. "红色;蓝色;绿色" → ["红色", "蓝色", "绿色"]
 * 支持 ; 或 换行 作分隔符
 */
function parseSpecValues(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[;；\n]/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * 解析价格列表，返回 { groupPrices: string[], singlePrices: string[] }
 * Excel 格式: "14,9,24" (拼单价) + 可能另有单买价列
 * 如果没有单独的单买价列，则单买价 = 拼单价 + 1
 */
function parsePrices(groupPriceRaw, singlePriceRaw) {
  const groups = String(groupPriceRaw || '')
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean);

  let singles;
  if (singlePriceRaw) {
    singles = String(singlePriceRaw)
      .split(/[,，]/)
      .map(s => s.trim())
      .filter(Boolean);
  } else {
    // 单买价 = 拼单价 + 1
    singles = groups.map(g => String(Number(g) + 1));
  }

  return { groups, singles };
}

/**
 * 主映射函数：将 Excel 行 → Product 对象
 * @param {Record<string, string>} rawRow
 * @returns {Product}
 */
function mapProduct(rawRow) {
  // Excel 的行是 key-value 对（字段名 → 值）
  // 有两种格式：竖排（A列是字段名，B列是值）或横排
  const row = normalizeRow(rawRow);

  const productId = parseProductId(row.product_id);
  const imageDir = findImageDir(productId);

  if (!imageDir) {
    logger.warn(`No image directory found for product "${productId}", using labels/`);
  }

  // 解析图片
  const mainImages = row.main_images
    ? matchImages(imageDir || config.paths.labels, row.main_images)
    : [];

  const detailImage = row.detail_image
    ? matchImages(imageDir || config.paths.labels, row.detail_image)[0] || ''
    : '';

  // 解析 SKU 规格
  const skuDim1 = {
    name: row.sku_1_name || '款式',
    values: parseSpecValues(row.sku_1_values),
  };
  const skuDim2 = {
    name: row.sku_2_name || '容量',
    values: parseSpecValues(row.sku_2_values),
  };
  const skuDimensions = [skuDim1, skuDim2].filter(d => d.values.length > 0);

  // 解析价格
  const { groups: groupPrices, singles: singlePrices } = parsePrices(
    row.price || row.group_price,
    row.single_price
  );

  // 生成 SKU 行（笛卡尔积）
  const skuRows = [];
  if (skuDimensions.length === 2) {
    let priceIdx = 0;
    for (const v1 of skuDim1.values) {
      for (const v2 of skuDim2.values) {
        skuRows.push({
          specs: [v1, v2],
          groupPrice: groupPrices[priceIdx] || groupPrices[0] || '9.9',
          singlePrice: singlePrices[priceIdx] || singlePrices[0] || '10.9',
          stock: row.stock || '9999',
        });
        priceIdx++;
      }
    }
  } else {
    // 只有一个规格维度
    for (let i = 0; i < (skuDimensions[0]?.values.length || 1); i++) {
      skuRows.push({
        specs: skuDimensions[0] ? [skuDimensions[0].values[i]] : [],
        groupPrice: groupPrices[i] || groupPrices[0] || '9.9',
        singlePrice: singlePrices[i] || singlePrices[0] || '10.9',
        stock: row.stock || '9999',
      });
    }
  }

  const product = {
    productId,
    title: row.title || '',
    mainImages,
    detailImage,
    skuDimensions,
    skuRows,
    categoryPath: row.category_path || '',
    freightTemplate: row.freight_template || '默认模板',
    _sourceRow: row,
  };

  logger.info(`Mapped product: ${productId}`, {
    title: product.title.substring(0, 40),
    images: mainImages.length,
    skuRows: skuRows.length,
    dims: skuDimensions.map(d => `${d.name}(${d.values.length})`).join(', '),
  });

  return product;
}

/**
 * 将竖排格式（字段名/值对）转换为普通对象
 */
function normalizeRow(rawRow) {
  // 直接取所有键值对
  const entries = Object.entries(rawRow)
    .filter(([k]) => !k.startsWith('_')); // 过滤内部字段

  const obj = {};
  for (const [key, value] of entries) {
    obj[String(key).trim()] = String(value || '').trim();
  }

  return obj;
}

module.exports = { mapProduct, findImageDir, matchImages, parseSpecValues };
