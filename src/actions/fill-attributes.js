/**
 * 填写商品属性 —— 动态扫描页面真实字段，不再硬编码
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 扫描页面上所有属性字段并打印
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{label: string, required: boolean, inputType: string}>>}
 */
async function inspectAttributes(page) {
  logger.step('Scanning page attribute fields...');

  const fields = await page.evaluate(() => {
    const results = [];

    // 找到属性区域 —— 通常在 "商品属性" 标题之后
    const body = document.body.innerText;
    const attrIdx = body.indexOf('商品属性');
    if (attrIdx < 0) return results;

    // 扫描所有可见的 select input 和 text input
    const selects = document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]');
    selects.forEach(sel => {
      const parent = sel.closest('[class*="item"], [class*="row"], [class*="field"]') || sel.parentElement?.parentElement;
      const text = (parent?.innerText || sel.parentElement?.innerText || '').split('\n')[0].trim();
      const isRequired = (parent?.innerText || '').includes('*');
      if (text && text.length < 20) {
        results.push({ label: text, required: isRequired, inputType: 'select' });
      }
    });

    // 扫描 text inputs（品牌搜索等）
    const textInputs = document.querySelectorAll('input[type="text"], input:not([type])');
    textInputs.forEach(inp => {
      const placeholder = inp.placeholder || '';
      if (placeholder.includes('品牌')) {
        const parent = inp.closest('[class*="item"], [class*="row"]') || inp.parentElement;
        const text = (parent?.innerText || '').split('\n')[0].trim();
        results.push({ label: text || '品牌', required: true, inputType: 'text' });
      }
    });

    return results;
  });

  logger.info(`Found ${fields.length} attribute fields on page:`);
  fields.forEach(f => logger.info(`  [${f.required ? '*' : ' '}] ${f.label} (${f.inputType})`));

  await takeScreenshot(page, '06_attributes_inspect');
  return fields;
}

/**
 * 填写一个属性
 */
async function fillOneAttribute(page, field, value) {
  if (!value || String(value).trim() === '') return false;

  const v = String(value).trim();

  if (field.inputType === 'select') {
    // 找到对应的 select 并打开
    try {
      // 通过 label 文本定位 select
      const labelEl = page.locator(`text="${field.label}"`).first();
      if (await labelEl.count() === 0) {
        logger.warn(`  Label "${field.label}" not found on page, skipping`);
        return false;
      }

      // 找到附近的 select input
      const parent = labelEl.locator('..').locator('..');
      const select = parent.locator('[data-testid="beast-core-select-htmlInput"]').first();
      if (await select.count() === 0) {
        // 扩大搜索
        const allSelects = page.locator('[data-testid="beast-core-select-htmlInput"]');
        const count = await allSelects.count();
        for (let i = 0; i < count; i++) {
          const s = allSelects.nth(i);
          const box = await s.boundingBox();
          if (box) {
            await s.click();
            await page.waitForTimeout(300);
            break;
          }
        }
      } else {
        await select.click();
        await page.waitForTimeout(300);
      }

      // 找 option
      const option = page.getByRole('option', { name: v }).first();
      if (await option.count() > 0) {
        await option.click();
        await page.waitForTimeout(200);
        logger.info(`  ✓ "${field.label}" → "${v}"`);
        return true;
      }

      // 包含匹配
      const fuzzyOption = page.locator(`[role="option"]:has-text("${v}")`).first();
      if (await fuzzyOption.count() > 0) {
        await fuzzyOption.click();
        await page.waitForTimeout(200);
        logger.info(`  ✓ "${field.label}" → "${v}" (fuzzy)`);
        return true;
      }

      await page.keyboard.press('Escape');
      logger.warn(`  Option "${v}" not found for "${field.label}"`);
      return false;

    } catch (err) {
      logger.warn(`  Fill "${field.label}" error: ${err.message}`);
      return false;
    }
  }

  if (field.inputType === 'text') {
    try {
      const input = page.locator(`input[placeholder*="${field.label}"], input[placeholder*="品牌"]`).first();
      if (await input.count() > 0) {
        await input.fill(v);
        await page.waitForTimeout(300);
        logger.info(`  ✓ "${field.label}" → "${v}"`);
        return true;
      }
    } catch (err) {
      logger.warn(`  Text fill "${field.label}" error: ${err.message}`);
    }
    return false;
  }

  return false;
}

/**
 * 从 product._sourceRow 中解析 attributes_json
 * 格式: {"纸张类型":"铜版纸","适用场景":"办公"}
 */
function parseAttributesJson(product) {
  try {
    const raw = product._sourceRow || {};
    if (raw.attributes_json && typeof raw.attributes_json === 'string') {
      return JSON.parse(raw.attributes_json);
    }
    if (raw.attributes_json && typeof raw.attributes_json === 'object') {
      return raw.attributes_json;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * 主入口 —— 扫描真实字段并填写
 */
async function fillAttributes(page, product) {
  logger.step('=== Filling Attributes ===');

  // 滚动到属性区域
  await page.evaluate(() => {
    const body = document.body.innerText;
    const idx = body.indexOf('商品属性');
    if (idx > 0) {
      const el = [...document.querySelectorAll('*')]
        .find(e => e.innerText === '商品属性' && e.offsetHeight > 0);
      if (el) el.scrollIntoView({ block: 'center' });
    }
  });
  await page.waitForTimeout(500);

  // 扫描真实字段
  const fields = await inspectAttributes(page);

  if (fields.length === 0) {
    logger.warn('No attribute fields detected on page — this category may not require attributes');
    return;
  }

  // 优先使用 attributes_json
  const jsonAttrs = parseAttributesJson(product);
  if (jsonAttrs) {
    logger.info('Using attributes_json from Excel:', jsonAttrs);
    for (const [key, value] of Object.entries(jsonAttrs)) {
      const field = fields.find(f => f.label.includes(key) || key.includes(f.label));
      if (field) {
        await fillOneAttribute(page, field, String(value));
      } else {
        logger.warn(`  Attribute "${key}" not found on page, skipping`);
      }
    }
    await takeScreenshot(page, '07_attributes_filled');
    return;
  }

  // 回退：尝试填写可选的通用属性（从 fields 中选有值的）
  logger.info('No attributes_json — filling common optional fields if present...');

  const commonValues = {
    '是否支持定制': '支持定制',
    '适用场景': '通用',
    '是否带音乐': '否',
  };

  let filled = 0;
  for (const field of fields) {
    for (const [key, val] of Object.entries(commonValues)) {
      if (field.label.includes(key) || key.includes(field.label)) {
        const ok = await fillOneAttribute(page, field, val);
        if (ok) filled++;
        break;
      }
    }
  }

  logger.info(`Filled ${filled} / ${fields.length} attributes`);
  await takeScreenshot(page, '07_attributes_filled');
}

module.exports = { fillAttributes, inspectAttributes };
