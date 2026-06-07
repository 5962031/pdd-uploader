/**
 * 属性填写 — 全量控件扫描 + 品牌严格 + 终检throw
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

const NO_FUZZY = ['是否支持定制', '是否带音乐', '是否进口', '是否预售', '是否含税'];
const isNoFuzzy = (name) => NO_FUZZY.some(f => name.includes(f) || f.includes(name));
const BRAND_OK = ['无品牌', '无品牌/无法注册商标', '无品牌/无注册商标', '无品牌/无需注册商标'];

// ═══════════════════════════════════════════════
// Label 扫描
// ═══════════════════════════════════════════════
async function scanAllLabels(page, attrNames) {
  const results = [];
  for (const name of attrNames) {
    try {
      const box = await page.evaluate((n) => {
        const clean = (t) => t.replace(/[\*重要：:\s]/g, '').trim();
        const all = document.querySelectorAll('div, span, label, p, td, th');
        for (const el of all) {
          const r = el.getBoundingClientRect();
          if (r.width < 6 || r.height < 5 || r.width > 400 || r.height > 80 || r.y < 100) continue;
          const t = (el.innerText || el.textContent || '').trim();
          if (t.length < 2 || t.length > 25) continue;
          if (t === n || clean(t) === n || (clean(t).includes(n) && t.length <= n.length + 6))
            return { x: r.x, y: r.y, w: r.width, h: r.height };
        }
        return null;
      }, name);
      if (box) results.push({ name, x: box.x, y: box.y, w: box.w, h: box.h, cy: box.y + box.h / 2 });
      else logger.info(`  label "${name}" NOT FOUND`);
    } catch {}
  }
  return results;
}

// ═══════════════════════════════════════════════
// Control 全量扫描（恢复Grid_col/IPT/ST/select等div组件）
// ═══════════════════════════════════════════════
async function scanAllControls(page) {
  return page.evaluate(() => {
    const results = [];
    const candidates = document.querySelectorAll(
      'input, div, span, [role="combobox"], [role="listbox"], [class*="select"], [class*="Select"], [class*="input"], [class*="Input"], [class*="ST_"], [class*="IPT_"], [class*="Grid_col"], [class*="beast"], [class*="picker"], [class*="Picker"]'
    );
    candidates.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 8 || r.y < 150 || r.y > 2000 || r.x < 50 || r.x > 1500) return;
      const text = (el.innerText || el.textContent || el.value || el.placeholder || '').trim().replace(/\n/g, ' ');
      const cls = (el.className?.toString() || '').substring(0, 50);
      const isSelectLike = text === '请选择'
        || /select|Select|picker|Picker|beast|Grid_col|IPT_|ST_/i.test(cls)
        || (el.tagName === 'INPUT' && (el.type === 'text' || !el.type) && (el.placeholder || '').includes('请'));
      if (isSelectLike) {
        results.push({
          idx: i, tag: el.tagName, cls,
          text: text.substring(0, 30),
          x: r.x, y: r.y, w: r.width, h: r.height,
          cx: r.x + r.width / 2, cy: r.y + r.height / 2,
        });
      }
    });
    // 去重
    const dedup = [];
    for (const c of results) {
      if (!dedup.find(d => Math.abs(d.x - c.x) < 10 && Math.abs(d.y - c.y) < 10)) dedup.push(c);
    }
    return dedup;
  });
}

// ═══════════════════════════════════════════════
// 坐标匹配
// ═══════════════════════════════════════════════
function matchControl(label, controls) {
  let best = null, bestS = Infinity;
  for (const c of controls) {
    const dy = Math.abs(c.cy - label.cy);
    const dx = c.x - (label.x + label.w);
    if (dy < 80 && dx > -20) { const s = dy + Math.abs(dx) * 0.3; if (s < bestS) { bestS = s; best = c; } }
  }
  if (!best) for (const c of controls) { const dy = Math.abs(c.cy - label.cy); if (dy < bestS) { bestS = dy; best = c; } }
  return best;
}

// ═══════════════════════════════════════════════
// 调试打印
// ═══════════════════════════════════════════════
function debugMatches(labels, controls) {
  logger.debug(`Controls: ${controls.length} total`);
  controls.forEach(c => logger.debug(`  ctrl#${c.idx} ${c.tag} "${c.text}" cls=${c.cls.substring(0,30)} @(${c.x.toFixed(0)},${c.y.toFixed(0)}) ${c.w.toFixed(0)}x${c.h.toFixed(0)}`));
  for (const l of labels) {
    const c = matchControl(l, controls);
    logger.debug(`  "${l.name}" @y=${l.cy.toFixed(0)} → ctrl#${c?.idx ?? 'NONE'} @(${c?.x?.toFixed(0)??'?'},${c?.y?.toFixed(0)??'?'})`);
  }
}

// ═══════════════════════════════════════════════
// 值操作
// ═══════════════════════════════════════════════
async function readCurrentValue(page, ctrl) {
  try {
    return await page.evaluate((cx, cy) => {
      for (const s of document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]')) {
        const r = s.getBoundingClientRect();
        if (Math.abs(r.y - cy) < 30 && Math.abs(r.x - cx) < 250) return (s.value || '').trim();
      }
      for (const d of document.querySelectorAll('div, span')) {
        const r = d.getBoundingClientRect();
        if (Math.abs(r.y - cy) < 25 && r.x > cx - 40 && r.x < cx + 300) {
          const t = (d.innerText || '').trim();
          if (t.length > 0 && t.length < 30 && t !== '请选择') return t;
        }
      }
      return '';
    }, ctrl.cx, ctrl.cy);
  } catch { return ''; }
}

/** 品牌严格选择 */
async function fillBrand(page, target) {
  const inp = page.locator('input[placeholder*="品牌"]').first();
  if (await inp.count() === 0) return { ok: false, reason: 'no brand input', current: '' };

  const cur = await inp.inputValue().catch(() => '');
  if (BRAND_OK.some(b => cur.includes(b) || b.includes(cur))) return { ok: true, reason: 'already_' + cur, current: cur };

  // 清除
  if (cur) { await inp.fill(''); await page.waitForTimeout(300); }
  // 搜索
  await inp.fill('无品牌');
  await page.waitForTimeout(800);

  let selected = null;
  for (const b of BRAND_OK) {
    const opt = page.getByRole('option', { name: b }).first();
    if (await opt.count() > 0) { await opt.click(); selected = b; await page.waitForTimeout(300); break; }
  }
  if (!selected) {
    const fz = page.locator('[role="option"]:has-text("无品牌")').first();
    if (await fz.count() > 0) { const ft = await fz.innerText(); if (BRAND_OK.some(b => ft.includes(b))) { await fz.click(); await page.waitForTimeout(300); } }
  }

  const actual = await inp.inputValue().catch(() => '');
  const ok = BRAND_OK.some(b => actual.includes(b) || b.includes(actual));
  return { ok, reason: ok ? 'brand_ok' : 'brand_wrong', current: actual };
}

/** 选择属性值（多点击位置尝试） */
async function selectExact(page, ctrl, value, attrName) {
  const v = String(value).trim();
  const forbidFuzzy = isNoFuzzy(attrName);

  for (let attempt = 0; attempt < 3; attempt++) {
    let cx = ctrl.cx, cy = ctrl.cy;
    if (attempt === 1) { cx = ctrl.x + ctrl.w / 2; cy = ctrl.y + ctrl.h / 2; }
    else if (attempt === 2) { cx = ctrl.x + ctrl.w - 10; cy = ctrl.y + ctrl.h / 2; }

    await page.mouse.click(cx, cy);
    await page.waitForTimeout(500);

    const opts = await page.evaluate(() =>
      [...document.querySelectorAll('[role="option"]')].map(o => o.innerText.trim()).filter(Boolean)
    );
    if (opts.length === 0) continue;

    // 1. exact
    const exact = page.getByRole('option', { name: v }).first();
    if (await exact.count() > 0) { await exact.click(); return { ok: true, reason: 'exact' }; }

    // 2. normalized
    const vNorm = v.replace(/\s/g, '');
    const exOpt = opts.find(o => o === v) || opts.find(o => o.replace(/\s/g, '') === vNorm);
    if (exOpt) { const el = page.getByRole('option', { name: exOpt }).first(); if (await el.count() > 0) { await el.click(); return { ok: true, reason: 'opts-exact' }; } }

    // 3. fuzzy (非是否类)
    if (!forbidFuzzy) {
      const fz = page.locator(`[role="option"]:has-text("${v}")`).first();
      if (await fz.count() > 0) { const ft = await fz.innerText(); if (ft.length < v.length + 10) { await fz.click(); return { ok: true, reason: 'fuzzy' }; } }
    }

    await page.keyboard.press('Escape');
    if (attempt === 2) return { ok: false, reason: `"${v}" not found`, opts };
  }
  return { ok: false, reason: 'no dropdown' };
}

/** 单个属性填+校验 */
async function fillOneAttr(page, attr, ctrl) {
  const v = String(attr.value).trim();
  if (!v) return { ok: false, reason: 'empty' };

  if (attr.name === '品牌') return fillBrand(page, v);

  const cur = await readCurrentValue(page, ctrl);
  if (cur && (cur === v || cur.replace(/\s/g, '') === v.replace(/\s/g, '')))
    return { ok: true, reason: 'already', current: cur };

  let result = await selectExact(page, ctrl, v, attr.name);
  await page.waitForTimeout(300);

  const actual = await readCurrentValue(page, ctrl);
  if (result.ok && actual && actual !== v && actual.replace(/\s/g, '') !== v.replace(/\s/g, '')) {
    // 重试
    await page.mouse.click(ctrl.cx + ctrl.w - 10, ctrl.cy + ctrl.h / 2);
    await page.waitForTimeout(400);
    const retry = page.getByRole('option', { name: v }).first();
    if (await retry.count() > 0) { await retry.click(); await page.waitForTimeout(300); }
    const actual2 = await readCurrentValue(page, ctrl);
    if (actual2 && actual2 !== v && actual2.replace(/\s/g, '') !== v.replace(/\s/g, ''))
      return { ok: false, reason: 'verify failed', current: actual2 };
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

  const labels = await scanAllLabels(page, attrs.map(a => a.name));
  const controls = await scanAllControls(page);
  debugMatches(labels, controls);

  const results = [];
  for (const attr of attrs) {
    if (attr.name === '品牌') { const r = await fillBrand(page, attr.value); results.push({ ...attr, ...r }); continue; }

    const label = labels.find(l => l.name === attr.name);
    if (!label) { logger.info(`  ⚠ "${attr.name}" label not on page`); results.push({ ...attr, ok: false, reason: 'no label', current: '' }); continue; }

    const ctrl = matchControl(label, controls);
    if (!ctrl) {
      logger.warn(`  ⚠ "${attr.name}" label@y=${label.cy.toFixed(0)} no matching control`);
      await takeScreenshot(page, `06_${attr.name}_noctrl`);
      results.push({ ...attr, ok: false, reason: 'no control', current: '' }); continue;
    }

    const r = await fillOneAttr(page, attr, ctrl);
    results.push({ ...attr, ...r });
    await page.waitForTimeout(200);
  }

  const okCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  logger.info(`Attributes: ${okCount} OK, ${failCount} FAILED (of ${attrs.length})`);

  if (failCount > 0) {
    const failed = results.filter(r => !r.ok).map(r => `  ✗ ${r.name}: target=${r.value} actual=${r.current || '?'} reason=${r.reason}`);
    logger.error(`Attribute FAILED:\n${failed.join('\n')}`);
    await takeScreenshot(page, '07_attrs_failed');
    throw new Error(`Attributes: ${okCount}/${attrs.length} OK. Failed: ${results.filter(r => !r.ok).map(r => r.name).join(', ')}`);
  }

  await takeScreenshot(page, '07_attrs_done');
  logger.info(`All ${okCount} attributes OK ✓`);
}

module.exports = { fillAttributes };
