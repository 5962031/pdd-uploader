/**
 * 类目映射表 —— 从 Excel category_path 或关键词匹配到完整类目路径
 *
 * 格式: "不干胶标签" → ["数码电器", "文具电教/文化用品/商务用品", "纸张本册", "不干胶标签"]
 */
const logger = require('../helpers/logger');

/**
 * 已知类目映射（从后台确认过的）
 * key: 类目叶子名或关键词
 * value: 完整的一级→二级→三级→叶子 路径数组
 */
const CATEGORY_MAP = {
  '不干胶标签': ['数码电器', '文具电教/文化用品/商务用品', '纸张本册', '不干胶标签'],
  '便利贴': ['数码电器', '文具电教/文化用品/商务用品', '纸张本册', '不干胶标签'],
  '贴纸': ['数码电器', '文具电教/文化用品/商务用品', '纸张本册', '不干胶标签'],

  '贺卡/明信片': ['数码电器', '文具电教/文化用品/商务用品', '印刷制品', '贺卡/明信片'],
  '明信片': ['数码电器', '文具电教/文化用品/商务用品', '印刷制品', '贺卡/明信片'],
  '贺卡': ['数码电器', '文具电教/文化用品/商务用品', '印刷制品', '贺卡/明信片'],
  '小卡': ['数码电器', '文具电教/文化用品/商务用品', '印刷制品', '贺卡/明信片'],
  '拍立得': ['数码电器', '文具电教/文化用品/商务用品', '印刷制品', '贺卡/明信片'],

  '书签': ['数码电器', '文具电教/文化用品/商务用品', '纸张本册', '书签'],
  '定制书签': ['数码电器', '文具电教/文化用品/商务用品', '纸张本册', '书签'],

  '大方卡': ['家居生活', '个性定制/DIY', '创意礼品', '定制卡片'],
  '方卡': ['家居生活', '个性定制/DIY', '创意礼品', '定制卡片'],

  '标签': ['数码电器', '文具电教/文化用品/商务用品', '纸张本册', '不干胶标签'],
};

/**
 * 根据商品数据解析类目路径
 * 优先级: category_path字段 > 标题关键词匹配 > 默认
 *
 * @param {import('./product-mapper').Product} product
 * @returns {string[]} 类目路径数组
 */
function resolveCategoryPath(product) {
  // 1. 如果有 category_path 字段且非空，直接解析
  if (product.categoryPath && product.categoryPath.trim() !== '') {
    const path = product.categoryPath
      .split(/[>＞]/)
      .map(s => s.trim())
      .filter(Boolean);

    if (path.length >= 2) {
      logger.info(`Category from Excel: ${path.join(' > ')}`);
      return path;
    }
  }

  // 2. 根据标题关键词匹配
  const title = product.title || '';
  for (const [keyword, catPath] of Object.entries(CATEGORY_MAP)) {
    if (title.includes(keyword)) {
      logger.info(`Category matched by keyword "${keyword}": ${catPath.join(' > ')}`);
      return [...catPath]; // 返回副本
    }
  }

  // 3. 默认类目
  logger.warn(`No category found for "${product.productId}", using default`);
  return ['数码电器', '文具电教/文化用品/商务用品', '纸张本册', '不干胶标签'];
}

/**
 * 添加新的类目映射
 */
function addCategoryMapping(keyword, pathArray) {
  CATEGORY_MAP[keyword] = pathArray;
  logger.info(`Added category mapping: "${keyword}" → ${pathArray.join(' > ')}`);
}

/**
 * 列出已注册的类目
 */
function listCategories() {
  return Object.entries(CATEGORY_MAP).map(([k, v]) => ({
    keyword: k,
    path: v.join(' > '),
  }));
}

module.exports = { resolveCategoryPath, addCategoryMapping, listCategories, CATEGORY_MAP };
