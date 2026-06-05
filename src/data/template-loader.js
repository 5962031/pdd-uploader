/**
 * 模板加载器 —— 根据 template_id 读取模板，合并 Excel 数据
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../helpers/logger');

const TEMPLATES_DIR = path.join(config.paths.root, 'pdd-uploader', 'templates');

/** 缓存已加载的模板 */
const templateCache = {};

/**
 * 加载指定模板
 */
function loadTemplate(templateId) {
  const id = templateId || 'generic';
  if (templateCache[id]) return templateCache[id];

  const filePath = path.join(TEMPLATES_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) {
    logger.warn(`Template "${id}" not found, falling back to generic`);
    return loadTemplate('generic');
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const template = JSON.parse(raw);
    templateCache[id] = template;
    logger.info(`Template loaded: ${template.template_name} (${id})`);
    return template;
  } catch (err) {
    logger.error(`Failed to load template "${id}": ${err.message}`);
    return id === 'generic' ? null : loadTemplate('generic');
  }
}

/**
 * 从 Excel products 行获取 template_id
 */
function getTemplateId(productRow) {
  return productRow.template_id || productRow.template || 'generic';
}

/**
 * 合并模板默认属性与 Excel attributes
 * Excel 优先级高于模板默认值
 *
 * @param {Object} template
 * @param {Array} excelAttributes - [{ name, value }]
 * @returns {Array} 合并后的属性列表
 */
function mergeAttributes(template, excelAttributes) {
  if (!template) return excelAttributes || [];

  const templateAttrs = (template.required_attributes || [])
    .concat(template.optional_attributes || []);

  if (templateAttrs.length === 0) return excelAttributes || [];

  // 以 Excel 为准建立索引
  const excelMap = {};
  for (const a of (excelAttributes || [])) {
    excelMap[a.name] = a.value;
  }

  // 合并：Excel 有值用 Excel，否则用模板默认值
  const merged = templateAttrs.map(ta => ({
    name: ta.name,
    value: excelMap[ta.name] !== undefined && excelMap[ta.name] !== ''
      ? excelMap[ta.name]
      : (ta.default || ''),
  }));

  // 加上 Excel 中独有的属性（不在模板里的）
  for (const a of (excelAttributes || [])) {
    if (!templateAttrs.find(ta => ta.name === a.name)) {
      merged.push(a);
    }
  }

  return merged.filter(a => a.name);
}

/**
 * 解析类目路径：Excel 优先，否则用模板
 */
function resolveCategoryPath(productRow, template) {
  if (productRow.category_path && productRow.category_path.trim() !== '') {
    return productRow.category_path;
  }
  if (template && template.category_path) {
    return template.category_path;
  }
  return '数码电器>文具电教/文化用品/商务用品>纸张本册>不干胶标签';
}

/**
 * 主入口：加载模板并应用到产品
 *
 * @param {Object} productRow - products 工作表的行
 * @param {Array} excelAttributes
 * @returns {{ template, attributes, categoryPath, templateId }}
 */
function applyTemplate(productRow, excelAttributes) {
  const templateId = getTemplateId(productRow);
  const template = loadTemplate(templateId);

  const attributes = mergeAttributes(template, excelAttributes);
  const categoryPath = resolveCategoryPath(productRow, template);

  return {
    template,
    templateId,
    attributes,
    categoryPath,
    templateName: template?.template_name || '通用模板',
  };
}

/**
 * 列出所有可用模板
 */
function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf-8'));
        return { id: t.template_id, name: t.template_name, desc: t.description };
      } catch { return null; }
    })
    .filter(Boolean);
}

module.exports = { loadTemplate, getTemplateId, mergeAttributes, resolveCategoryPath, applyTemplate, listTemplates };
