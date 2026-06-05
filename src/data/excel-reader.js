/**
 * 从 products.xlsx 读取商品数据
 */
const XLSX = require('xlsx');
const path = require('path');
const logger = require('../helpers/logger');

/**
 * 读取 Excel 文件，返回原始行对象数组
 * @param {string} excelPath
 * @returns {Array<Record<string, string>>}
 */
function readProducts(excelPath) {
  if (!require('fs').existsSync(excelPath)) {
    throw new Error(`Excel file not found: ${excelPath}`);
  }

  logger.step(`Reading Excel: ${excelPath}`);
  const workbook = XLSX.readFile(excelPath);

  const result = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) continue;

    // 检测格式：竖排（字段/值对）还是横排（每行一个商品）
    const firstRow = rows[0];
    const keys = Object.keys(firstRow);
    const isVertical = keys.includes('字段') || keys.includes('示例');

    if (isVertical) {
      // === 竖排格式：字段名/值 配对 ===
      // 将多行聚合成一个商品对象
      const product = { _sheetName: sheetName };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const fieldName = String(row['字段'] || row[keys[0]] || '').trim();
        const value = String(row['示例'] || row[keys[1]] || '').trim();

        if (!fieldName || fieldName === '字段') continue;

        // 将字段名映射为驼峰式属性名
        product[fieldName] = value;
      }

      if (Object.keys(product).length > 1) {
        result.push(product);
      }
    } else {
      // === 横排格式：每行一个商品 ===
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const values = Object.values(row);

        if (values.every(v => !v || String(v).trim() === '')) continue;

        result.push({ ...row, _sheetName: sheetName, _rowIndex: i });
      }
    }
  }

  logger.info(`Read ${result.length} products from Excel`);
  return result;
}

module.exports = { readProducts };
