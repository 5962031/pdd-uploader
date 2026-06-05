/**
 * 填写商品属性 —— 扫描所有可见控件（含 div 组件），坐标+鼠标点击
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 扫描页面上所有"请选择"类型的可点击控件（含 div/span，不限于 input）
 */
async function scanAllControls(page) {
  return page.evaluate(() => {
    const results = [];

    // 1. beast-core-select 的 input
    const beastInputs = document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]');
    beastInputs.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width > 10 && r.height > 5) {
        results.push({
          idx: i, tag: el.tagName, cls: el.className?.substring(0, 40) || '',
          placeholder: el.placeholder || '', text: (el.value || '').substring(0, 20),
          x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2,
        });
      }
    });

    // 2. 所有 div/span 文本为"请选择"的元素（PDD 自定义下拉组件外层）
    const allEls = document.querySelectorAll('div, span, button');
    allEls.forEach((el, i) => {
      const text = (el.innerText || el.textContent || '').trim().replace(/\n/g, ' ').substring(0, 20);
      const ph = el.getAttribute('placeholder') || '';
      const cls = (el.className?.toString() || '').substring(0, 40);
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 5) return;

      // 文本是"请选择"，或者有 select/Select/beast 相关 class
      if (text === '请选择' || ph === '请选择' ||
          cls.includes('select') || cls.includes('Select') || cls.includes('beast')) {
        // 避免重复（beast input 已经加过）
        const isDuplicate = results.some(ex =>
          Math.abs(ex.x - r.x) < 5 && Math.abs(ex.y - r.y) < 5);
        if (!isDuplicate) {
          results.push({
            idx: i, tag: el.tagName, cls, placeholder: ph, text,
            x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2,
          });
        }
      }
    });

    // 3. 品牌输入框
    const brand = document.querySelector('input[placeholder*="品牌"]');
    if (brand) {
      const r = brand.getBoundingClientRect();
      if (r.width > 10) {
        results.push({
          idx: -1, tag: 'INPUT', cls: 'brand', placeholder: '品牌搜索', text: '',
          x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2,
          isBrand: true,
        });
      }
    }

    return results;
  });
}

/**
 * 打印所有控件（调试用）
 */
function logControls(controls) {
  controls.forEach(c => {
    logger.debug(`  ctrl#${c.idx} ${c.tag} "${c.text}" "${c.placeholder}" cls="${c.cls}" @(${c.x.toFixed(0)},${c.y.toFixed(0)}) ${c.w.toFixed(0)}x${c.h.toFixed(0)}${c.isBrand ? ' [BRAND]' : ''}`);
  });
}

/**
 * 找属性名标签的 boundingBox
 */
async function findLabelBox(page, attrName) {
  try {
    const el = page.locator(`text="${attrName}"`).first();
    if (await el.count() === 0) return null;
    const box = await el.boundingBox();
    return box ? { label: attrName, x: box.x, y: box.y, w: box.width, h: box.height, cy: box.y + box.height / 2 } : null;
  } catch { return null; }
}

/**
 * 为属性标签匹配最近的控件（宽松规则）
 */
function matchControl(label, controls) {
  const labelCy = label.cy;
  let best = null, bestScore = Infinity;

  for (const c of controls) {
    if (c.isBrand) {
      if (label.label === '品牌') return c;
      continue;
    }

    const dy = Math.abs(c.cy - labelCy);
    const dx = c.x - (label.x + label.w);

    // y 差 < 120px（两列布局可能不在同一像素行）
    // x 差 > -100（控件在标签右侧不远处，或者左侧一点点）
    if (dy < 120 && dx > -100) {
      const score = dy * 1.0 + Math.abs(dx) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }

  return best;
}

/**
 * 用鼠标坐标点击控件
 */
async function clickControl(page, ctrl) {
  await page.mouse.click(ctrl.cx, ctrl.cy);
  await page.waitForTimeout(400);
}

/**
 * 选择下拉值
 */
async function selectOption(page, value) {
  const v = String(value).trim();
  // 打印可选项
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')].map(o => o.innerText.trim()).filter(Boolean)
  );
  logger.debug(`  Options: ${JSON.stringify(opts.slice(0, 20))}`);

  const exact = page.getByRole('option', { name: v }).first();
  if (await exact.count() > 0) { await exact.click(); return true; }

  const fuzzy = page.locator(`[role="option"]:has-text("${v}")`).first();
  if (await fuzzy.count() > 0) { await fuzzy.click(); return true; }

  await page.keyboard.press('Escape');
  logger.warn(`  Value "${v}" not in dropdown. Available: ${opts.join(', ')}`);
  return false;
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
    const dd = page.locator(`[role="option"]:has-text("${v}")`).first();
    if (await dd.count() > 0) { await dd.click(); await page.waitForTimeout(300); }
    return { ok: true, reason: '' };
  } catch (e) { return { ok: false, reason: e.message }; }
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

  const controls = await scanAllControls(page);
  logger.info(`Controls found: ${controls.length}`);
  logControls(controls);

  let filled = 0, skipped = 0;

  for (const attr of attrs) {
    if (attr.name === '品牌') {
      const r = await fillBrand(page, attr.value);
      if (r.ok) { logger.info(`  ✓ "${attr.name}" → "${attr.value}"`); filled++; }
      else { logger.warn(`  ✗ "${attr.name}" FAILED: ${r.reason}`); skipped++; }
      await page.waitForTimeout(200);
      continue;
    }

    const labelBox = await findLabelBox(page, attr.name);
    if (!labelBox) {
      logger.warn(`  ⚠ "${attr.name}" — label not found`);
      skipped++; continue;
    }

    const ctrl = matchControl(labelBox, controls);
    if (!ctrl) {
      logger.warn(`  ⚠ "${attr.name}" — no control (label@y=${labelBox.cy.toFixed(0)})`);
      skipped++; continue;
    }

    logger.info(`  "${attr.name}" label@y=${labelBox.cy.toFixed(0)} → ctrl#${ctrl.idx} ${ctrl.tag} @(${ctrl.x.toFixed(0)},${ctrl.y.toFixed(0)})`);

    await clickControl(page, ctrl);
    const ok = await selectOption(page, attr.value);
    if (ok) { logger.info(`  ✓ "${attr.name}" → "${attr.value}"`); filled++; }
    else { logger.warn(`  ✗ "${attr.name}" → "${attr.value}" FAILED`); skipped++; }

    await page.waitForTimeout(200);
    await takeScreenshot(page, `06_attr_${attr.name.substring(0, 6)}`);
  }

  await takeScreenshot(page, '07_attrs_done');
  logger.info(`Attributes: ${filled}/${attrs.length} filled, ${skipped} skipped`);
}

module.exports = { fillAttributes };
