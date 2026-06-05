/**
 * 填写商品属性 —— 从 Excel attributes 表读取，动态匹配页面字段
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 扫描页面真实属性字段
 */
async function inspectAttributes(page) {
  const fields = await page.evaluate(() => {
    const results = [];
    const selects = document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]');
    selects.forEach(sel => {
      const parent = sel.closest('[class*="item"], [class*="row"], [class*="field"]') || sel.parentElement?.parentElement;
      const text = (parent?.innerText || sel.parentElement?.innerText || '').split('\n')[0].replace(/\*/g, '').trim();
      const isRequired = (parent?.innerText || '').includes('*');
      if (text && text.length < 20) {
        results.push({ label: text, required: isRequired, inputType: 'select' });
      }
    });
    const textInputs = document.querySelectorAll('input[type="text"], input:not([type])');
    textInputs.forEach(inp => {
      const placeholder = inp.placeholder || '';
      if (placeholder.includes('品牌') || placeholder.includes('搜索') || placeholder.includes('输入')) {
        const parent = inp.closest('[class*="item"], [class*="row"]') || inp.parentElement;
        const text = (parent?.innerText || '').split('\n')[0].replace(/\*/g, '').trim();
        results.push({ label: text || placeholder, required: true, inputType: 'text' });
      }
    });
    return results;
  });

  logger.info(`Page has ${fields.length} attribute fields:`);
  fields.forEach(f => logger.debug(`  [${f.required ? '*' : ' '}] "${f.label}" (${f.inputType})`));

  await takeScreenshot(page, '06_attributes_inspect');
  return fields;
}

/**
 * 填写一个 select 属性
 */
async function fillSelectAttribute(page, field, value) {
  if (!value || String(value).trim() === '') return false;
  const v = String(value).trim();

  try {
    // 通过 label 文本找 select
    const labelEl = page.locator(`text="${field.label}"`).first();
    if (await labelEl.count() === 0) return false;

    const parent = labelEl.locator('..').locator('..');
    const select = parent.locator('[data-testid="beast-core-select-htmlInput"]').first();
    let el = null;
    if (await select.count() > 0) {
      el = select;
    } else {
      // 找最近的 select
      const all = page.locator('[data-testid="beast-core-select-htmlInput"]');
      const cnt = await all.count();
      for (let i = 0; i < cnt; i++) {
        const box = await all.nth(i).boundingBox();
        if (box) { el = all.nth(i); break; }
      }
    }
    if (!el) return false;

    await el.click();
    await page.waitForTimeout(300);

    // 精确匹配
    const opt = page.getByRole('option', { name: v }).first();
    if (await opt.count() > 0) {
      await opt.click();
      logger.info(`  ✓ "${field.label}" → "${v}"`);
      return true;
    }

    // 包含匹配
    const fuzzy = page.locator(`[role="option"]:has-text("${v}")`).first();
    if (await fuzzy.count() > 0) {
      await fuzzy.click();
      logger.info(`  ✓ "${field.label}" → "${v}" (fuzzy)`);
      return true;
    }

    await page.keyboard.press('Escape');
    logger.warn(`  ✗ "${field.label}" — option "${v}" not found`);
    return false;
  } catch (err) {
    logger.warn(`  ✗ "${field.label}" error: ${err.message}`);
    return false;
  }
}

/**
 * 填写一个 text 属性
 */
async function fillTextAttribute(page, field, value) {
  try {
    const input = page.locator(`input[placeholder*="${field.label}"], input[placeholder*="品牌"], input[placeholder*="搜索"]`).first();
    if (await input.count() > 0) {
      await input.fill(String(value).trim());
      logger.info(`  ✓ "${field.label}" → "${value}"`);
      return true;
    }
  } catch (err) {
    logger.warn(`  ✗ "${field.label}" text error: ${err.message}`);
  }
  return false;
}

/**
 * 主入口 —— 按 Excel attributes 表逐项填写
 */
async function fillAttributes(page, product) {
  logger.step('=== Filling Attributes ===');

  const attrs = product.attributes || [];
  if (attrs.length === 0) {
    logger.info('No attributes in Excel — skipping');
    return;
  }

  // 滚动到属性区域
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(e => e.innerText === '商品属性' && e.offsetHeight > 0);
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  // 扫描页面真实字段
  const pageFields = await inspectAttributes(page);

  if (pageFields.length === 0) {
    logger.warn('No attribute fields detected on page — this category may not require attributes');
    return;
  }

  let filled = 0;
  let skipped = 0;

  for (const attr of attrs) {
    // 在页面字段中找匹配
    const match = pageFields.find(f =>
      f.label.includes(attr.name) || attr.name.includes(f.label) ||
      f.label === attr.name
    );

    if (!match) {
      logger.warn(`  ⚠ "${attr.name}" not found on page — skipping`);
      skipped++;
      continue;
    }

    let ok = false;
    if (match.inputType === 'select') {
      ok = await fillSelectAttribute(page, match, attr.value);
    } else {
      ok = await fillTextAttribute(page, match, attr.value);
    }

    if (ok) filled++;
    else skipped++;

    await page.waitForTimeout(200);
  }

  await takeScreenshot(page, '07_attributes_filled');
  logger.info(`Attributes: ${filled} filled, ${skipped} skipped`);
}

module.exports = { fillAttributes, inspectAttributes };
