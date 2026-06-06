/**
 * 从 products.xlsx 读取3个工作表：products / attributes / sku
 */
const XLSX = require('xlsx');
const logger = require('../helpers/logger');
const { resolveSheetName, translateSheet } = require('./field-mapper');

/**
 * 读取竖排格式（字段/值对）的工作表
 */
function readVerticalSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (rows.length === 0) return [];

  const firstKey = Object.keys(rows[0])[0];
  // 检测竖排格式
  const isVertical = firstKey === '字段' || rows[0][firstKey] === 'product_id' || Object.keys(rows[0]).length === 2;

  if (isVertical && Object.keys(rows[0]).length === 2) {
    const product = {};
    for (const row of rows) {
      const keys = Object.keys(row);
      const fieldName = String(row[keys[0]] || '').trim();
      const value = String(row[keys[1]] || '').trim();
      if (fieldName && fieldName !== '字段') {
        product[fieldName] = value;
      }
    }
    return [product];
  }

  return rows;
}

/**
 * 读取横排格式工作表
 */
function readHorizontalSheet(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

/**
 * 主入口
 * @returns {{ products: Array, attributes: Array, sku: Array }}
 */
function readWorkbook(excelPath) {
  if (!require('fs').existsSync(excelPath)) {
    throw new Error(`Excel file not found: ${excelPath}`);
  }

  logger.step(`Reading Excel: ${excelPath}`);
  const workbook = XLSX.readFile(excelPath);

  const result = {
    products: [],
    attributes: [],
    sku: [],
  };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const resolved = resolveSheetName(sheetName);

    if (resolved === 'products') {
      result.products = translateSheet(readVerticalSheet(sheet), 'products');
      logger.info(`  products (${sheetName}): ${result.products.length} row(s)`);
    } else if (resolved === 'attributes') {
      result.attributes = translateSheet(readHorizontalSheet(sheet), 'attributes');
      logger.info(`  attributes (${sheetName}): ${result.attributes.length} row(s)`);
    } else if (resolved === 'sku') {
      result.sku = translateSheet(readHorizontalSheet(sheet), 'sku');
      logger.info(`  sku (${sheetName}): ${result.sku.length} row(s)`);
    } else {
      // 未知工作表，尝试读取
      const rows = translateSheet(readHorizontalSheet(sheet), sheetName);
      if (rows.length > 0) {
        result[resolved] = rows;
        logger.info(`  ${sheetName}: ${rows.length} row(s)`);
      }
    }
  }

  return result;
}

module.exports = { readWorkbook };
