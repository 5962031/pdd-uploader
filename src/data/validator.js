/**
 * 商品字段校验 —— 上架前验证数据完整性
 */
const logger = require('../helpers/logger');

/**
 * @typedef {Object} ValidationError
 * @property {string} field - 字段名
 * @property {string} message - 错误描述
 * @property {'error'|'warn'} level - 严重程度
 */

/**
 * 校验标题
 */
function validateTitle(title) {
  const errors = [];
  if (!title || String(title).trim() === '') {
    errors.push({ field: 'title', message: '标题不能为空', level: 'error' });
    return errors;
  }
  const t = String(title).trim();
  // 汉字算1个，英文/数字算0.5个 → 近似：汉字+英文
  const cnChars = (t.match(/[一-鿿　-〿＀-￯]/g) || []).length;
  const enChars = t.replace(/[一-鿿　-〿＀-￯]/g, '').length;
  const estimatedLength = cnChars + Math.ceil(enChars / 2);

  if (estimatedLength > 60) {
    errors.push({ field: 'title', message: `标题超长（约${estimatedLength}字符，限制60字符/30汉字）`, level: 'warn' });
  }
  if (cnChars > 30) {
    errors.push({ field: 'title', message: `汉字数超30（当前${cnChars}字）`, level: 'error' });
  }
  return errors;
}

/**
 * 校验主图
 */
function validateMainImages(mainImages) {
  const errors = [];
  if (!mainImages || mainImages.length === 0) {
    errors.push({ field: 'main_images', message: '主图不能为空，至少需要1张', level: 'error' });
  } else if (mainImages.length < 3) {
    errors.push({ field: 'main_images', message: `建议至少3张主图（当前${mainImages.length}张）`, level: 'warn' });
  }
  if (mainImages && mainImages.length > 10) {
    errors.push({ field: 'main_images', message: `主图最多10张（当前${mainImages.length}张）`, level: 'error' });
  }

  // 检查文件大小
  if (mainImages) {
    const fs = require('fs');
    const path = require('path');
    for (const img of mainImages) {
      if (!fs.existsSync(img)) {
        errors.push({ field: 'main_images', message: `图片不存在: ${path.basename(img)}`, level: 'error' });
      } else {
        const stat = fs.statSync(img);
        if (stat.size > 3 * 1024 * 1024) {
          errors.push({ field: 'main_images', message: `${path.basename(img)} 超过3MB限制`, level: 'warn' });
        }
      }
    }
  }
  return errors;
}

/**
 * 校验 SKU 规格
 */
function validateSkuDimensions(dimensions) {
  const errors = [];
  if (!dimensions || dimensions.length === 0) {
    errors.push({ field: 'skuDimensions', message: 'SKU规格不能为空', level: 'error' });
  }
  if (dimensions) {
    for (const dim of dimensions) {
      if (!dim.values || dim.values.length === 0) {
        errors.push({ field: 'skuDimensions', message: `规格"${dim.name}"没有值`, level: 'error' });
      }
    }
  }
  return errors;
}

/**
 * 校验 SKU 价格
 */
function validateSkuRows(skuRows) {
  const errors = [];
  if (!skuRows || skuRows.length === 0) {
    errors.push({ field: 'skuRows', message: 'SKU价格行为空', level: 'error' });
    return errors;
  }

  for (let i = 0; i < skuRows.length; i++) {
    const row = skuRows[i];
    if (!row.groupPrice || isNaN(Number(row.groupPrice)) || Number(row.groupPrice) <= 0) {
      errors.push({ field: 'skuRows', message: `SKU行${i + 1} 拼单价无效: "${row.groupPrice}"`, level: 'error' });
    }
    if (!row.singlePrice || isNaN(Number(row.singlePrice)) || Number(row.singlePrice) <= 0) {
      errors.push({ field: 'skuRows', message: `SKU行${i + 1} 单买价无效: "${row.singlePrice}"`, level: 'error' });
    }
    if (!row.stock || isNaN(Number(row.stock)) || Number(row.stock) <= 0) {
      errors.push({ field: 'skuRows', message: `SKU行${i + 1} 库存无效: "${row.stock}"`, level: 'warn' });
    }
    // 单买价应 >= 拼单价（warn，不阻止）
    if (Number(row.singlePrice) < Number(row.groupPrice)) {
      errors.push({ field: 'skuRows', message: `SKU行${i + 1} 单买价${row.singlePrice}低于拼单价${row.groupPrice}（可能数据列错位）`, level: 'warn' });
    }
  }

  return errors;
}

/**
 * 校验完整 Product 对象
 * @param {import('./product-mapper').Product} product
 * @returns {{ errors: ValidationError[], warnings: ValidationError[], valid: boolean }}
 */
function validateProduct(product) {
  const all = [
    ...validateTitle(product.title),
    ...validateMainImages(product.mainImages),
    ...validateSkuDimensions(product.skuDimensions),
    ...validateSkuRows(product.skuRows),
  ];

  // 校验详情图
  if (!product.detailImage) {
    all.push({ field: 'detail_image', message: '详情图未设置（可选）', level: 'warn' });
  } else if (!require('fs').existsSync(product.detailImage)) {
    all.push({ field: 'detail_image', message: `详情图不存在: ${product.detailImage}`, level: 'warn' });
  }

  const errors = all.filter(e => e.level === 'error');
  const warnings = all.filter(e => e.level === 'warn');

  if (warnings.length > 0) {
    logger.warn(`Validation: ${warnings.length} warning(s)`);
    warnings.forEach(w => logger.warn(`  [${w.field}] ${w.message}`));
  }

  return {
    errors,
    warnings,
    valid: errors.length === 0,
  };
}

module.exports = { validateProduct, validateTitle, validateMainImages, validateSkuDimensions, validateSkuRows };
