/**
 * 填写商品属性 —— Excel 优先 + 跳过已正确 + 精确匹配 + 读回校验
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

// 禁止模糊匹配的字段
const NO_FUZZY = ['是否支持定制', '是否带音乐', '是否进口', '是否预售', '是否含税'];
const isNoFuzzy = (name) => NO_FUZZY.some(f => name.includes(f) || f.includes(name));

/**
 * 在页面元素的 boundingBox 中找属性标签
 */
async function findLabelBox(page, attrName) {
  try {
    const exact = page.locator(`text="${attrName}"`).first();
    if (await exact.count() > 0) { const b = await exact.boundingBox(); if (b) return { ...b, label: attrName, cy: b.y + b.h / 2 }; }

    return await page.evaluate((name) => {
      const clean = (t) => t.replace(/[\*重要：:\s]/g, '').trim();
      const all = document.querySelectorAll('div, span, label, p, td, th');
      for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.w < 10 || r.h < 8) continue;
        const t = (el.innerText || '').trim();
        if (t.length < 2 || t.length > 30) continue;
        if (t === name || t.includes(name) || clean(t) === name || clean(t).includes(name)) return { x: r.x, y: r.y, w: r.w, h: r.h };
        if (t.replace(/\s+/g, '').includes(name.replace(/\s+/g, ''))) return { x: r.x, y: r.y, w: r.w, h: r.h };
      }
      return null;
    }, attrName).then(r => r ? { ...r, label: attrName, cy: r.y + r.h / 2 } : null);
  } catch { return null; }
}

/**
 * 扫描所有可点击的下拉控件坐标
 */
async function scanControlBoxes(page) {
  return page.evaluate(() => {
    const r = [];
    document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]').forEach((el, i) => {
      const b = el.getBoundingClientRect(); if (b.w > 15 && b.h > 5) r.push({ idx: i, tag: 'INPUT', x: b.x, y: b.y, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 });
    });
    document.querySelectorAll('div, span').forEach((el, i) => {
      const t = (el.innerText || '').trim();
      const c = (el.className?.toString() || '');
      if (t === '请选择' && /select|Select|beast/i.test(c)) { const b = el.getBoundingClientRect(); if (b.w > 15 && b.h > 5) r.push({ idx: i, tag: 'DIV', x: b.x, y: b.y, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 }); }
    });
    return r;
  });
}

/** 匹配属性标签最近的右侧控件 */
function matchControl(label, controls) {
  let best = null, bestS = Infinity;
  for (const c of controls) { const dy = Math.abs(c.cy - label.cy); const dx = c.x - (label.x + label.w); if (dy < 90 && dx > -60) { const s = dy + Math.abs(dx) * 0.4; if (s < bestS) { bestS = s; best = c; } } }
  return best;
}

/** 读回页面当前显示值（通过控件所在位置的文本） */
async function readCurrentValue(page, ctrl, attrName) {
  try {
    return await page.evaluate((cx, cy) => {
      // 先找 beast-core-select 的 value
      const ss = document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]');
      for (const s of ss) { const r = s.getBoundingClientRect(); if (Math.abs(r.y - cy) < 30 && Math.abs(r.x - cx) < 200) return s.value || ''; }
      // 再找附近 div/span 文本
      const ds = document.querySelectorAll('div, span');
      for (const d of ds) { const r = d.getBoundingClientRect(); if (Math.abs(r.y - cy) < 30 && r.x > cx - 60 && r.x < cx + 300) { const t = (d.innerText || '').trim(); if (t.length > 0 && t.length < 30 && t !== '请选择') return t; } }
      return '';
    }, ctrl.cx, ctrl.cy);
  } catch { return ''; }
}

/** 精确选择 */
async function selectExact(page, ctrl, value) {
  await page.mouse.click(ctrl.cx, ctrl.cy);
  await page.waitForTimeout(450);
  const opts = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map(o => o.innerText.trim()).filter(Boolean));
  if (opts.length === 0) { await page.keyboard.press('Escape'); return { ok: false, reason: 'no dropdown' }; }

  const v = String(value).trim(); const vNorm = v.replace(/\s/g, '');

  // 1. 精确匹配
  for (const strategy of ['exact', 'normalized', 'clean']) {
    const candidates = strategy === 'exact' ? [v] :
      strategy === 'normalized' ? opts.filter(o => o.replace(/\s/g, '') === vNorm) :
      opts.filter(o => o.replace(/[\s，,。.!！、/\\()（）【】\[\]]/g, '') === v.replace(/[\s，,。.!！、/\\()（）【】\[\]]/g, ''));
    const match = candidates.length === 1 ? candidates[0] : (candidates.find(o => o === v) || candidates[0]);
    if (match) {
      const el = page.getByRole('option', { name: match }).first();
      if (await el.count() > 0) { await el.click(); return { ok: true, reason: strategy }; }
    }
  }

  return { ok: false, reason: `not found. Options: ${opts.join(', ')}` };
}

/** 填写一个属性 */
async function fillOneAttr(page, attr, ctrl) {
  const v = String(attr.value).trim(); if (!v) return { ok: false, reason: 'empty' };

  // 先读当前值
  const cur = await readCurrentValue(page, ctrl, attr.name);
  if (cur && (cur === v || cur.replace(/\s/g, '') === v.replace(/\s/g, ''))) {
    return { ok: true, reason: 'already_' + cur, current: cur };
  }

  // 选择
  let result = await selectExact(page, ctrl, v);

  if (!result.ok && !isNoFuzzy(attr.name)) {
    // 非是否类：允许最后一次模糊尝试
    await page.mouse.click(ctrl.cx, ctrl.cy);
    await page.waitForTimeout(400);
    const fuzzy = page.locator(`[role="option"]:has-text("${v}")`).first();
    if (await fuzzy.count() > 0) { const ft = await fuzzy.innerText(); if (ft.length < v.length + 8) { await fuzzy.click(); result = { ok: true, reason: 'fuzzy-text-is' }; } }
    await page.keyboard.press('Escape');
  }

  // 回退验证
  await page.waitForTimeout(300);
  const actual = await readCurrentValue(page, ctrl, attr.name);

  if (result.ok && actual && actual !== v && actual.replace(/\s/g, '') !== v.replace(/\s/g, '')) {
    // 填错了，重试一次
    logger.warn(`    verify FAILED: actual="${actual}" expected="${v}" — retrying`);
    await page.mouse.click(ctrl.cx, ctrl.cy);
    await page.waitForTimeout(400);
    const exactRetry = page.getByRole('option', { name: v }).first();
    if (await exactRetry.count() > 0) { await exactRetry.click(); await page.waitForTimeout(300); } else { await page.keyboard.press('Escape'); }
    const actual2 = await readCurrentValue(page, ctrl, attr.name);
    if (actual2 && actual2 !== v && actual2.replace(/\s/g, '') !== v.replace(/\s/g, '')) {
      await page.keyboard.press('Escape');
      return { ok: false, reason: `verify FAILED: expected="${v}" actual="${actual2}"`, current: actual2 };
    }
  }

  return { ...result, current: actual };
}

/** 主入口 */
async function fillAttributes(page, product) {
  logger.step('=== Filling Attributes ===');
  const attrs = product.attributes || [];
  if (attrs.length === 0) { logger.info('No attributes'); return; }

  // 去重：product_id + 属性名，保留最后一个
  const seen = new Map();
  for (const a of attrs) { seen.set(a.name, a); }
  const uniqueAttrs = [...seen.values()];

  logger.info(`Attributes to fill for ${product.productId}:`);
  uniqueAttrs.forEach(a => logger.info(`  ${a.name} = ${a.value}`));

  await page.evaluate(() => { const e = [...document.querySelectorAll('*')].find(el => el.innerText === '商品属性' && el.offsetHeight > 0); if (e) e.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(500);

  // 关闭"一键复用"
  try { const txt = await page.evaluate(() => document.body.innerText); if (txt.includes('一键复用')) { const no = page.locator('text=不使用').first(); if (await no.count() > 0) { await no.click(); await page.waitForTimeout(800); } } } catch {}
  await takeScreenshot(page, '06_attrs_before');

  const controls = await scanControlBoxes(page);
  const filledSet = new Set();
  let filled = 0, skipped = 0, already = 0;

  for (const attr of uniqueAttrs) {
    if (filledSet.has(attr.name)) continue;
    filledSet.add(attr.name);

    const labelBox = await findLabelBox(page, attr.name);
    if (!labelBox) { logger.info(`  ⚠ "${attr.name}" — not on page, skip`); skipped++; continue; }

    const ctrl = matchControl(labelBox, controls);
    if (!ctrl) { logger.info(`  ⚠ "${attr.name}" — no control, skip`); skipped++; continue; }

    const r = await fillOneAttr(page, attr, ctrl);

    if (r.reason?.startsWith('already')) {
      logger.info(`  ✓ "${attr.name}" = "${r.current}" (already OK, skip)`);
      already++;
    } else if (r.ok) {
      logger.info(`  ✓ "${attr.name}" → "${attr.value}"${r.current ? ' verify: ' + r.current : ''} [${r.reason}]`);
      filled++;
    } else {
      logger.warn(`  ✗ "${attr.name}" → "${attr.value}" FAILED: ${r.reason}${r.current ? ' (current: ' + r.current + ')' : ''}`);
      skipped++;
    }
    await page.waitForTimeout(200);
  }

  await takeScreenshot(page, '07_attrs_done');
  logger.info(`Attributes: ${filled} filled, ${already} already-OK, ${skipped} skipped/not-on-page`);
}

module.exports = { fillAttributes };
