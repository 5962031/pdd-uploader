/**
 * 填写商品属性 —— 基于坐标匹配下拉框
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 扫描页面上所有属性名标签的坐标
 */
async function scanLabelBoxes(page) {
  const labels = await page.evaluate(() => {
    const results = [];
    // 属性名常见标签：短文本（2-10字），在属性区域内
    const all = document.querySelectorAll('div, span, label');
    for (const el of all) {
      const text = (el.innerText || el.textContent || '').trim();
      if (text.length < 2 || text.length > 15) continue;
      if (/^[\d.,%¥\s*]+$/.test(text)) continue;
      if (['品牌','产地','形状','纸张类型','包装方式','是否支持定制','是否带音乐',
           '适用场景','风格','图案','重要款式','重要产品类型','重要印后工艺',
           '花型','器型','口味','色号','适用人群'].includes(text)) {
        const rect = el.getBoundingClientRect();
        results.push({ label: text, x: rect.x, y: rect.y, w: rect.width, h: rect.height });
      }
    }
    return results;
  });

  // 去重（取第一个出现的坐标）
  const seen = new Set();
  return labels.filter(l => {
    if (seen.has(l.label)) return false;
    seen.add(l.label);
    return true;
  });
}

/**
 * 扫描页面上所有下拉框的坐标
 */
async function scanControlBoxes(page) {
  return page.evaluate(() => {
    const results = [];
    const selects = document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]');
    selects.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        results.push({ idx: i, x: rect.x, y: rect.y, w: rect.width, h: rect.height, type: 'select' });
      }
    });
    const textInputs = document.querySelectorAll('input[type="text"], input:not([type])');
    textInputs.forEach((el, i) => {
      const ph = el.placeholder || '';
      if (ph.includes('品牌') || ph.includes('搜索')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          results.push({ idx: i, x: rect.x, y: rect.y, w: rect.width, h: rect.height, type: 'text' });
        }
      }
    });
    return results;
  });
}

/**
 * 找到与标签同一行的控件（y 接近，x 在右侧）
 */
function findMatchingControl(labelBox, controls) {
  let best = null;
  let bestDist = Infinity;

  for (const ctrl of controls) {
    const dy = Math.abs(ctrl.y - labelBox.y);
    const dx = ctrl.x - (labelBox.x + labelBox.w);

    // 必须在同一行（y 差 < 30px）且在右侧或很接近
    if (dy < 30 && dx > -50) {
      const dist = dy + Math.abs(dx);
      if (dist < bestDist) {
        bestDist = dist;
        best = ctrl;
      }
    }
  }

  return best;
}

/**
 * 填写一个选择属性
 */
async function fillOneSelect(page, controlIdx, value) {
  const v = String(value).trim();
  if (!v) return { ok: false, reason: 'empty value' };

  try {
    const allSelects = page.locator('[data-testid="beast-core-select-htmlInput"]');
    const cnt = await allSelects.count();
    if (controlIdx >= cnt) return { ok: false, reason: `idx ${controlIdx} >= ${cnt}` };

    const sel = allSelects.nth(controlIdx);
    await sel.click();
    await page.waitForTimeout(300);

    // 打印所有可选项
    const options = await page.evaluate(() => {
      return [...document.querySelectorAll('[role="option"]')]
        .map(o => (o.innerText || '').trim()).filter(Boolean);
    });
    logger.debug(`  Dropdown options: ${JSON.stringify(options.slice(0, 15))}`);

    // 精确匹配
    const opt = page.getByRole('option', { name: v }).first();
    if (await opt.count() > 0) {
      await opt.click();
      return { ok: true, reason: '' };
    }

    // 包含匹配
    const fuzzy = page.locator(`[role="option"]:has-text("${v}")`).first();
    if (await fuzzy.count() > 0) {
      await fuzzy.click();
      return { ok: true, reason: 'fuzzy' };
    }

    await page.keyboard.press('Escape');
    return { ok: false, reason: `"${v}" not in dropdown. Options: ${options.slice(0, 10).join(', ')}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * 填写一个文本属性
 */
async function fillOneText(page, value) {
  const v = String(value).trim();
  if (!v) return { ok: false, reason: 'empty' };
  try {
    const inp = page.locator('input[placeholder*="品牌"]').first();
    if (await inp.count() === 0) return { ok: false, reason: 'brand input not found' };
    await inp.fill(v);
    await page.waitForTimeout(500);
    const dd = page.locator('[role="option"]:has-text("' + v + '")').first();
    if (await dd.count() > 0) { await dd.click(); await page.waitForTimeout(300); }
    return { ok: true, reason: '' };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * 主入口
 */
async function fillAttributes(page, product) {
  logger.step('=== Filling Attributes ===');

  const attrs = product.attributes || [];
  if (attrs.length === 0) {
    logger.info('No attributes — skipping');
    return;
  }

  // 滚动到属性区
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(e =>
      e.innerText === '商品属性' && e.offsetHeight > 0);
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  // 扫描标签和控件坐标
  const labels = await scanLabelBoxes(page);
  const controls = await scanControlBoxes(page);
  logger.info(`${labels.length} labels, ${controls.length} controls found`);

  if (controls.length === 0) {
    logger.warn('No attribute controls detected — skipping');
    return;
  }

  let filled = 0;
  let skipped = 0;

  for (const attr of attrs) {
    // 找匹配的标签
    const label = labels.find(l =>
      l.label === attr.name ||
      l.label.includes(attr.name) ||
      attr.name.includes(l.label)
    );

    if (!label) {
      logger.warn(`  ⚠ "${attr.name}" — label not found on page (available: ${labels.map(l => l.label).join(', ')})`);
      skipped++;
      continue;
    }

    const ctrl = findMatchingControl(label, controls);
    if (!ctrl) {
      logger.warn(`  ⚠ "${attr.name}" — no control found near label (label at y=${label.y.toFixed(0)})`);
      skipped++;
      continue;
    }

    logger.debug(`  "${attr.name}" → label@(${label.x.toFixed(0)},${label.y.toFixed(0)}) ctrl@(${ctrl.x.toFixed(0)},${ctrl.y.toFixed(0)})`);

    let result;

    if (ctrl.type === 'text') {
      result = await fillOneText(page, attr.value);
    } else {
      result = await fillOneSelect(page, ctrl.idx, attr.value);
    }

    if (result.ok) {
      logger.info(`  ✓ "${attr.name}" → "${attr.value}"`);
      filled++;
    } else {
      logger.warn(`  ✗ "${attr.name}" → "${attr.value}" FAILED: ${result.reason}`);
      skipped++;
    }

    await page.waitForTimeout(200);
  }

  await takeScreenshot(page, '07_attributes_filled');
  logger.info(`Attributes: ${filled} filled, ${skipped} skipped / ${attrs.length} total`);
}

module.exports = { fillAttributes, scanLabelBoxes, scanControlBoxes };
