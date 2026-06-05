/**
 * 填写商品属性 —— 坐标匹配下拉框（支持左右两列布局）
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 扫描页面上所有属性名文本的 boundingBox
 * 使用 page.locator 逐个查找 Excel 中的属性名
 */
async function findLabelBox(page, attrName) {
  try {
    const el = page.locator(`text="${attrName}"`).first();
    if (await el.count() === 0) return null;
    const box = await el.boundingBox();
    if (!box) return null;
    return { label: attrName, x: box.x, y: box.y, w: box.width, h: box.height };
  } catch {
    return null;
  }
}

/**
 * 扫描所有下拉框的坐标
 */
async function scanAllSelectBoxes(page) {
  return page.evaluate(() => {
    const results = [];
    const selects = document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]');
    selects.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width > 20 && r.height > 10) {
        results.push({ idx: i, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    });
    // 品牌输入框
    const brand = document.querySelector('input[placeholder*="品牌"]');
    if (brand) {
      const r = brand.getBoundingClientRect();
      if (r.width > 20) results.push({ idx: -1, x: r.x, y: r.y, w: r.width, h: r.height, isBrand: true });
    }
    return results;
  });
}

/**
 * 找到与标签同行的下拉框（y 差 < 40px，x 在右侧或接近）
 */
function matchControl(labelBox, controls) {
  let best = null, bestDy = Infinity;
  const labelRight = labelBox.x + labelBox.w;
  const labelCY = labelBox.y + labelBox.h / 2;

  for (const c of controls) {
    const cCY = c.y + c.h / 2;
    const dy = Math.abs(cCY - labelCY);
    const dx = c.x - labelRight;

    // 同一行：y 差 < 40px，且控件在标签右侧（或非常接近 < -100）
    if (dy < 40 && dx > -100) {
      const score = dy + Math.max(0, -dx); // 鼓励右侧、惩罚左侧
      if (score < bestDy || !best) {
        bestDy = score;
        best = c;
      }
    }
  }

  return best;
}

/**
 * 填写一个 select 属性
 */
async function fillSelect(page, controlIdx, value) {
  const v = String(value).trim();
  const selects = page.locator('[data-testid="beast-core-select-htmlInput"]');
  const cnt = await selects.count();
  if (controlIdx >= cnt) return { ok: false, reason: `idx ${controlIdx} out of ${cnt}` };

  const sel = selects.nth(controlIdx);
  await sel.click();
  await page.waitForTimeout(400);

  // 打印可选项
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')].map(o => o.innerText.trim()).filter(Boolean)
  );
  logger.debug(`  Dropdown: ${JSON.stringify(opts.slice(0, 20))}`);

  // 精确
  const exact = page.getByRole('option', { name: v }).first();
  if (await exact.count() > 0) {
    await exact.click();
    return { ok: true, reason: '' };
  }
  // 包含
  const fuzzy = page.locator(`[role="option"]:has-text("${v}")`).first();
  if (await fuzzy.count() > 0) {
    await fuzzy.click();
    return { ok: true, reason: 'fuzzy' };
  }

  await page.keyboard.press('Escape');
  return { ok: false, reason: `"${v}" not found. Options: ${opts.slice(0, 15).join(', ')}` };
}

/**
 * 填写品牌
 */
async function fillBrand(page, value) {
  const v = String(value).trim();
  try {
    const inp = page.locator('input[placeholder*="品牌"]').first();
    if (await inp.count() === 0) return { ok: false, reason: 'no brand input' };
    await inp.fill(v);
    await page.waitForTimeout(600);
    // 点下拉结果
    const dd = page.locator(`[role="option"]:has-text("${v}")`).first();
    if (await dd.count() > 0) { await dd.click(); await page.waitForTimeout(300); }
    return { ok: true, reason: '' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * 主入口
 */
async function fillAttributes(page, product) {
  logger.step('=== Filling Attributes ===');

  const attrs = product.attributes || [];
  if (attrs.length === 0) { logger.info('No attributes — skip'); return; }

  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(e => e.innerText === '商品属性' && e.offsetHeight > 0);
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);
  await takeScreenshot(page, '06_attrs_before');

  const controls = await scanAllSelectBoxes(page);
  logger.info(`${controls.length} controls found`);

  let filled = 0, skipped = 0;

  for (const attr of attrs) {
    // 品牌特殊处理
    if (attr.name === '品牌') {
      const r = await fillBrand(page, attr.value);
      if (r.ok) { logger.info(`  ✓ "${attr.name}" → "${attr.value}"`); filled++; }
      else { logger.warn(`  ✗ "${attr.name}" FAILED: ${r.reason}`); skipped++; }
      await page.waitForTimeout(200);
      continue;
    }

    // 找属性名的 boundingBox
    const labelBox = await findLabelBox(page, attr.name);
    if (!labelBox) {
      logger.warn(`  ⚠ "${attr.name}" — label not visible on page`);
      skipped++;
      continue;
    }

    const ctrl = matchControl(labelBox, controls);
    if (!ctrl) {
      logger.warn(`  ⚠ "${attr.name}" — no matching control (label@${labelBox.y.toFixed(0)}, ${controls.length} controls)`);
      skipped++;
      continue;
    }

    logger.debug(`  "${attr.name}" label@y=${labelBox.y.toFixed(0)} → ctrl#${ctrl.idx}@y=${ctrl.y.toFixed(0)}`);

    if (ctrl.isBrand) {
      const r = await fillBrand(page, attr.value);
      if (r.ok) { filled++; logger.info(`  ✓ "${attr.name}" → "${attr.value}"`); }
      else { skipped++; logger.warn(`  ✗ "${attr.name}" FAILED`); }
    } else {
      const r = await fillSelect(page, ctrl.idx, attr.value);
      if (r.ok) { filled++; logger.info(`  ✓ "${attr.name}" → "${attr.value}"`); }
      else { skipped++; logger.warn(`  ✗ "${attr.name}" FAILED: ${r.reason}`); }
    }

    await page.waitForTimeout(200);
    await takeScreenshot(page, `06_attr_${attr.name.substring(0, 6)}`);
  }

  await takeScreenshot(page, '07_attrs_done');
  logger.info(`Attributes: ${filled}/${attrs.length} filled, ${skipped} skipped`);
}

module.exports = { fillAttributes };
