/**
 * 属性填写 — 品牌严格选择 + 全部读回校验 + 失败throw
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

const NO_FUZZY = ['是否支持定制', '是否带音乐', '是否进口', '是否预售', '是否含税'];
const isNoFuzzy = (name) => NO_FUZZY.some(f => name.includes(f) || f.includes(name));
const BRAND_OK = ['无品牌', '无品牌/无法注册商标', '无品牌/无注册商标', '无品牌/无需注册商标'];

async function findLabelBox(page, attrName) {
  try {
    const exact = page.locator(`text="${attrName}"`).first();
    if (await exact.count() > 0) { const b = await exact.boundingBox(); if (b) return { ...b, label: attrName, cy: b.y + b.h / 2 }; }
    return await page.evaluate((n) => {
      const clean = (t) => t.replace(/[\*重要：:\s]/g, '').trim();
      const all = document.querySelectorAll('div, span, label, p, td, th');
      for (const el of all) { const r = el.getBoundingClientRect(); if (r.w < 6 || r.h < 5 || r.w > 400 || r.h > 80 || r.y < 100) continue; const t = (el.innerText || '').trim(); if (t.length < 2 || t.length > 25) continue; if (t === n || clean(t) === n || (clean(t).includes(n) && t.length <= n.length + 6)) return { x: r.x, y: r.y, w: r.w, h: r.h }; }
      return null;
    }, attrName).then(r => r ? { ...r, label: attrName, cy: r.y + r.h / 2 } : null);
  } catch { return null; }
}

async function scanControlBoxes(page) {
  return page.evaluate(() => {
    const r = [];
    document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]').forEach(el => { const b = el.getBoundingClientRect(); if (b.w > 15 && b.h > 5 && b.y > 150 && b.y < 2000 && b.x > 50 && b.x < 1500) r.push({ idx: r.length, tag: 'INPUT', x: b.x, y: b.y, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 }); });
    return r;
  });
}

function matchControl(label, controls) {
  let best = null, bestS = Infinity;
  for (const c of controls) { const dy = Math.abs(c.cy - label.cy); const dx = c.x - (label.x + label.w); if (dy < 80 && dx > -20) { const s = dy + Math.abs(dx) * 0.3; if (s < bestS) { bestS = s; best = c; } } }
  if (!best) for (const c of controls) { const dy = Math.abs(c.cy - label.cy); if (dy < bestS) { bestS = dy; best = c; } }
  return best;
}

/** 读回控件当前值 */
async function readCurrentValue(page, ctrl) {
  try {
    return await page.evaluate((cx, cy) => {
      for (const s of document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]')) { const r = s.getBoundingClientRect(); if (Math.abs(r.y - cy) < 30 && Math.abs(r.x - cx) < 250) return (s.value || '').trim(); }
      for (const d of document.querySelectorAll('div, span')) { const r = d.getBoundingClientRect(); if (Math.abs(r.y - cy) < 25 && r.x > cx - 40 && r.x < cx + 300) { const t = (d.innerText || '').trim(); if (t.length > 0 && t.length < 30 && t !== '请选择') return t; } }
      return '';
    }, ctrl.cx, ctrl.cy);
  } catch { return ''; }
}

/** 品牌字段特殊处理 */
async function fillBrand(page, target) {
  const BRAND_INPUT = page.locator('input[placeholder*="品牌"]').first();
  if (await BRAND_INPUT.count() === 0) return { ok: false, reason: 'no brand input', current: '' };

  const cur = await BRAND_INPUT.inputValue().catch(() => '');

  // 当前值已经 OK？
  if (BRAND_OK.some(b => cur.includes(b) || b.includes(cur))) return { ok: true, reason: 'already_' + cur, current: cur };

  // 当前不是目标 → 清除
  if (cur && !BRAND_OK.some(b => cur.includes(b))) {
    await BRAND_INPUT.fill('');
    await page.waitForTimeout(300);
  }

  // 搜索"无品牌"
  await BRAND_INPUT.fill('无品牌');
  await page.waitForTimeout(800);

  // 严格选择
  for (const b of BRAND_OK) {
    const opt = page.getByRole('option', { name: b }).first();
    if (await opt.count() > 0) { await opt.click(); await page.waitForTimeout(300); break; }
  }
  // 也尝试包含匹配
  const fuzzy = page.locator('[role="option"]:has-text("无品牌")').first();
  if (await fuzzy.count() > 0) {
    const ft = await fuzzy.innerText();
    if (BRAND_OK.some(b => ft.includes(b))) { await fuzzy.click(); await page.waitForTimeout(300); }
  }

  const actual = await BRAND_INPUT.inputValue().catch(() => '');
  const ok = BRAND_OK.some(b => actual.includes(b) || b.includes(actual));
  return { ok, reason: ok ? 'brand_ok' : 'brand_wrong', current: actual };
}

/** 选择属性值 */
async function selectExact(page, ctrl, value) {
  // 多次尝试点击
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt === 0) await page.mouse.click(ctrl.cx, ctrl.cy);
    else if (attempt === 1) await page.mouse.click(ctrl.cx + ctrl.w / 2, ctrl.cy + ctrl.h / 2);
    else await page.mouse.click(ctrl.cx + ctrl.w - 5, ctrl.cy);
    await page.waitForTimeout(500);

    const opts = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map(o => o.innerText.trim()).filter(Boolean));
    if (opts.length > 0) {
      const v = String(value).trim();
      const vNorm = v.replace(/\s/g, '');

      // 精确
      const exact = page.getByRole('option', { name: v }).first();
      if (await exact.count() > 0) { await exact.click(); return { ok: true, reason: 'exact' }; }

      const exOpt = opts.find(o => o === v) || opts.find(o => o.replace(/\s/g, '') === vNorm);
      if (exOpt) { const el = page.getByRole('option', { name: exOpt }).first(); if (await el.count() > 0) { await el.click(); return { ok: true, reason: 'opts-exact' }; } }

      if (!isNoFuzzy('')) {
        const fz = page.locator(`[role="option"]:has-text("${v}")`).first();
        if (await fz.count() > 0) { await fz.click(); return { ok: true, reason: 'fuzzy' }; }
      }

      await page.keyboard.press('Escape');
      return { ok: false, reason: `not found`, opts };
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  return { ok: false, reason: 'no dropdown after 3 attempts' };
}

/** 单属性填+校验 */
async function fillOneAttr(page, attr, ctrl) {
  const v = String(attr.value).trim();
  if (!v) return { ok: false, reason: 'empty' };

  // 品牌特殊处理
  if (attr.name === '品牌') return fillBrand(page, v);

  // 读当前值
  const cur = await readCurrentValue(page, ctrl);
  if (cur && (cur === v || cur.replace(/\s/g, '') === v.replace(/\s/g, ''))) {
    return { ok: true, reason: 'already', current: cur };
  }

  // 选择
  let result = await selectExact(page, ctrl, v);
  await page.waitForTimeout(300);

  // 读回
  const actual = await readCurrentValue(page, ctrl);
  if (result.ok && actual && actual !== v && actual.replace(/\s/g, '') !== v.replace(/\s/g, '')) {
    // 选错了：重试
    await page.mouse.click(ctrl.cx, ctrl.cy);
    await page.waitForTimeout(400);
    const retry = page.getByRole('option', { name: v }).first();
    if (await retry.count() > 0) { await retry.click(); await page.waitForTimeout(300); }
    const actual2 = await readCurrentValue(page, ctrl);
    if (actual2 && actual2 !== v && actual2.replace(/\s/g, '') !== v.replace(/\s/g, '')) {
      return { ok: false, reason: `verify failed`, current: actual2 };
    }
  }

  return { ...result, current: actual };
}

/** 主入口 */
async function fillAttributes(page, product) {
  logger.step('=== Filling Attributes ===');
  const raw = product.attributes || [];
  if (raw.length === 0) { logger.info('No attributes'); return; }

  const seen = new Map(); for (const a of raw) seen.set(a.name, a);
  const attrs = [...seen.values()];

  logger.info(`Attributes for ${product.productId}:`);
  attrs.forEach(a => logger.info(`  ${a.name} = ${a.value}`));

  await page.evaluate(() => { const e = [...document.querySelectorAll('*')].find(el => el.innerText === '商品属性' && el.offsetHeight > 0); if (e) e.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(500);
  try { if ((await page.evaluate(() => document.body.innerText)).includes('一键复用')) { const no = page.locator('text=不使用').first(); if (await no.count() > 0) { await no.click(); await page.waitForTimeout(800); } } } catch {}
  await takeScreenshot(page, '06_attrs_before');

  const controls = await scanControlBoxes(page);
  const results = [];

  for (const attr of attrs) {
    // 品牌
    if (attr.name === '品牌') { const r = await fillBrand(page, attr.value); results.push({ ...attr, ...r }); continue; }

    const labelBox = await findLabelBox(page, attr.name);
    if (!labelBox) { logger.info(`  ⚠ "${attr.name}" label not on page`); results.push({ ...attr, ok: false, reason: 'label not found', current: '' }); continue; }

    const ctrl = matchControl(labelBox, controls);
    if (!ctrl) { logger.info(`  ⚠ "${attr.name}" no control`); results.push({ ...attr, ok: false, reason: 'no control', current: '' }); continue; }

    const r = await fillOneAttr(page, attr, ctrl);
    results.push({ ...attr, ...r });
    await page.waitForTimeout(200);
  }

  // 打印结果
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  logger.info(`Attributes: ${okCount} OK, ${failCount} FAILED (of ${attrs.length})`);

  if (failCount > 0) {
    const failed = results.filter(r => !r.ok).map(r => `  ✗ ${r.name}: target=${r.value} actual=${r.current || '?'}`);
    logger.error(`Attribute verification FAILED:\n${failed.join('\n')}`);
    await takeScreenshot(page, '07_attrs_failed');
    throw new Error(`Attribute verification failed: ${okCount}/${attrs.length} OK. Failed: ${results.filter(r => !r.ok).map(r => r.name).join(', ')}`);
  }

  await takeScreenshot(page, '07_attrs_done');
  logger.info(`All ${okCount} attributes OK ✓`);
}

module.exports = { fillAttributes };
