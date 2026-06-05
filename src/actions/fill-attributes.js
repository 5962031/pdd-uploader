/**
 * 填写商品属性 —— 全量扫描可点击控件 + 多候选 + 坐标点击
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

async function scanAllControls(page) {
  const ctrls = await page.evaluate(() => {
    const results = [];
    // 扫所有可能是下拉框的元素
    const all = document.querySelectorAll('input, div, span, button');
    all.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width < 15 || r.height < 8) return;
      const text = (el.innerText || el.textContent || '').trim().replace(/\n/g, '');
      const ph = el.getAttribute('placeholder') || '';
      const cls = (el.className?.toString() || '').substring(0, 50);

      // 匹配：placeholder=请选择 或 文本=请选择 或 class含select/Select/beast
      const isTarget =
        ph === '请选择' ||
        text === '请选择' ||
        /select|Select|beast/.test(cls) ||
        (el.tagName === 'INPUT' && el.getAttribute('data-testid')?.includes('select'));

      if (isTarget) {
        // 找真正可点击的外层（div 自身可点击, input 可能不可见）
        let clickable = el;
        if (el.tagName === 'INPUT') {
          // 尝试用父级 div 作为点击目标
          let p = el.parentElement;
          for (let depth = 0; depth < 3 && p; depth++) {
            const pCls = (p.className?.toString() || '');
            if (pCls.includes('select') || pCls.includes('Select') || pCls.includes('beast')) {
              clickable = p; break;
            }
            p = p.parentElement;
          }
        }
        const cr = clickable.getBoundingClientRect();
        results.push({
          idx: results.length, tag: el.tagName, cls,
          text: text.substring(0, 20), placeholder: ph,
          x: cr.x, y: cr.y, w: cr.width, h: cr.height,
          cx: cr.x + cr.width / 2, cy: cr.y + cr.height / 2,
          visible: cr.width > 10 && cr.height > 5,
        });
      }
    });
    // 品牌输入框
    const brand = document.querySelector('input[placeholder*="品牌"]');
    if (brand) {
      const r = brand.getBoundingClientRect();
      results.push({
        idx: -1, tag: 'INPUT', cls: 'brand', text: '', placeholder: '品牌搜索',
        x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2,
        visible: true, isBrand: true,
      });
    }
    return results;
  });

  // 打印每个控件
  ctrls.forEach(c => {
    logger.debug(`  ctrl#${c.idx} ${c.tag} "${c.text}" "${c.placeholder}" cls="${c.cls.substring(0,30)}" @(${c.x.toFixed(0)},${c.y.toFixed(0)}) ${c.w.toFixed(0)}x${c.h.toFixed(0)} v=${c.visible}${c.isBrand?' [BRAND]':''}`);
  });

  return ctrls;
}

async function findLabelBox(page, attrName) {
  try {
    const el = page.locator(`text="${attrName}"`).first();
    if (await el.count() === 0) return null;
    const box = await el.boundingBox();
    return box ? { label: attrName, x: box.x, y: box.y, w: box.width, h: box.height, cy: box.y + box.height / 2 } : null;
  } catch { return null; }
}

/**
 * 找候选控件列表（按距离排序，最多3个）
 */
function findCandidates(label, controls) {
  const candidates = [];
  for (const c of controls) {
    if (c.isBrand) {
      if (label.label === '品牌') candidates.push({ ctrl: c, score: 0 });
      continue;
    }
    const dy = Math.abs(c.cy - label.cy);
    const dx = c.x - (label.x + label.w);
    if (dy < 90) { // 放宽 y 容差
      candidates.push({ ctrl: c, score: dy + Math.abs(dx) * 0.3 });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, 3).map(c => c.ctrl);
}

async function clickAndSelect(page, ctrl, value) {
  const v = String(value).trim();
  // 坐标点击
  await page.mouse.click(ctrl.cx, ctrl.cy);
  await page.waitForTimeout(500);

  // 打印选项
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')].map(o => o.innerText.trim()).filter(Boolean)
  );
  logger.debug(`  Options: ${JSON.stringify(opts.slice(0, 20))}`);

  if (opts.length === 0) return { ok: false, reason: 'no dropdown appeared' };

  const exact = page.getByRole('option', { name: v }).first();
  if (await exact.count() > 0) { await exact.click(); return { ok: true, reason: '' }; }

  const fuzzy = page.locator(`[role="option"]:has-text("${v}")`).first();
  if (await fuzzy.count() > 0) { await fuzzy.click(); return { ok: true, reason: 'fuzzy' }; }

  await page.keyboard.press('Escape');
  return { ok: false, reason: `"${v}" not in ${opts.join(', ')}` };
}

/**
 * 检测并关闭"一键复用/不使用"推荐弹窗
 */
async function dismissAutoRecommend(page) {
  try {
    const txt = await page.evaluate(() => document.body.innerText);
    if (txt.includes('已自动匹配到相似商品属性') || txt.includes('一键复用')) {
      logger.info('Auto-recommend popup detected — clicking "不使用"');
      const noBtn = page.locator('text=不使用').first();
      if (await noBtn.count() > 0) {
        await noBtn.click();
        await page.waitForTimeout(800);
        logger.info('  Dismissed ✓');
        return;
      }
      // JS 回退
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button, span, div')];
        const no = btns.find(b => b.innerText.trim() === '不使用');
        if (no) no.click();
      });
      await page.waitForTimeout(800);
      logger.info('  Dismissed (JS fallback) ✓');
    }
  } catch (e) {
    logger.debug(`  dismissAutoRecommend: ${e.message}`);
  }
}

async function fillBrand(page, value) {
  const v = String(value).trim();
  try {
    const inp = page.locator('input[placeholder*="品牌"]').first();
    if (await inp.count() === 0) return { ok: false, reason: 'no brand input' };
    await inp.fill(v); await page.waitForTimeout(600);
    const dd = page.locator(`[role="option"]:has-text("${v}")`).first();
    if (await dd.count() > 0) { await dd.click(); await page.waitForTimeout(300); }
    return { ok: true, reason: '' };
  } catch (e) { return { ok: false, reason: e.message }; }
}

async function fillAttributes(page, product) {
  logger.step('=== Filling Attributes ===');
  const attrs = product.attributes || [];
  if (attrs.length === 0) { logger.info('No attributes'); return; }

  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(e => e.innerText === '商品属性' && e.offsetHeight > 0);
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  // 处理"一键复用"推荐弹窗
  await dismissAutoRecommend(page);

  await takeScreenshot(page, '06_attrs_before');

  const controls = await scanAllControls(page);
  logger.info(`${controls.length} controls found`);

  let filled = 0, skipped = 0;

  for (const attr of attrs) {
    if (attr.name === '品牌') {
      const r = await fillBrand(page, attr.value);
      if (r.ok) { logger.info(`  ✓ "${attr.name}" → "${attr.value}"`); filled++; }
      else { logger.warn(`  ✗ "${attr.name}": ${r.reason}`); skipped++; }
      await page.waitForTimeout(200);
      continue;
    }

    const labelBox = await findLabelBox(page, attr.name);
    if (!labelBox) { logger.warn(`  ⚠ "${attr.name}" label not found`); skipped++; continue; }

    const candidates = findCandidates(labelBox, controls);
    if (candidates.length === 0) {
      logger.warn(`  ⚠ "${attr.name}" no controls near label@y=${labelBox.cy.toFixed(0)}`);
      skipped++; continue;
    }

    logger.debug(`  "${attr.name}" label@y=${labelBox.cy.toFixed(0)}: ${candidates.length} candidates`);
    let done = false;

    for (let ci = 0; ci < candidates.length && !done; ci++) {
      const c = candidates[ci];
      logger.debug(`    try#${ci + 1} ctrl#${c.idx} ${c.tag} @(${c.x.toFixed(0)},${c.y.toFixed(0)})`);
      const r = await clickAndSelect(page, c, attr.value);
      if (r.ok) {
        logger.info(`  ✓ "${attr.name}" → "${attr.value}"`);
        filled++;
        done = true;
      } else if (ci < candidates.length - 1) {
        logger.debug(`    failed (${r.reason}), trying next candidate...`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }
    }

    if (!done) { logger.warn(`  ✗ "${attr.name}" → "${attr.value}" (tried ${candidates.length} candidates, all failed)`); skipped++; }

    await page.waitForTimeout(200);
    await takeScreenshot(page, `06_attr_${attr.name.substring(0, 6)}`);
  }

  await takeScreenshot(page, '07_attrs_done');
  logger.info(`Attributes: ${filled}/${attrs.length} filled, ${skipped} skipped`);
}

module.exports = { fillAttributes };
