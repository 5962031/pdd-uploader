/**
 * 填写商品属性 — 全量控件扫描 + 坐标匹配 + 跳过已正确 + 精确选值 + 读回校验
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

const NO_FUZZY = ['是否支持定制', '是否带音乐', '是否进口', '是否预售', '是否含税'];
const isNoFuzzy = (name) => NO_FUZZY.some(f => name.includes(f) || f.includes(name));

// ═══════════════════════════════════════════════
// 扫描
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
          if (r.width < 8 || r.height < 6) continue;
          const t = (el.innerText || el.textContent || '').trim();
          if (t.length < 2 || t.length > 30) continue;
          if (t === n || t.includes(n) || clean(t) === n || clean(t).includes(n) || t.replace(/\s+/g, '').includes(n.replace(/\s+/g, '')))
            return { x: r.x, y: r.y, w: r.width, h: r.height };
        }
        return null;
      }, name);
      if (box) {
        results.push({ name, x: box.x, y: box.y, w: box.w, h: box.h, cy: box.y + box.h / 2 });
        logger.debug(`  label "${name}" @(${box.x.toFixed(0)},${box.y.toFixed(0)})`);
      } else {
        logger.info(`  label "${name}" NOT FOUND on page`);
      }
    } catch {}
  }
  return results;
}

async function scanAllControls(page) {
  return page.evaluate(() => {
    const results = [];
    // 扫一切可能是下拉框/选择器的东西
    const candidates = document.querySelectorAll(
      'input, div, span, button, [role="combobox"], [role="listbox"], [class*="select"], [class*="Select"], [class*="input"], [class*="Input"], [class*="ST_"], [class*="IPT_"], [class*="beast"], [class*="picker"], [class*="Picker"]'
    );
    candidates.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 8) return;
      const text = (el.innerText || el.textContent || el.value || el.placeholder || '').trim().replace(/\n/g, ' ');
      const cls = (el.className?.toString() || '').substring(0, 40);
      // 关键词：请选择、select相关class、可点击的下拉区域
      const isSelectLike = text === '请选择' ||
        /select|Select|picker|Picker/i.test(cls) ||
        (el.tagName === 'INPUT' && (el.type === 'text' || !el.type));
      if (isSelectLike || text === '请选择' || r.width > 80) {
        results.push({
          idx: i, tag: el.tagName, cls,
          text: text.substring(0, 30),
          placeholder: (el.placeholder || '').substring(0, 30),
          x: r.x, y: r.y, w: r.width, h: r.height,
          cx: r.x + r.width / 2, cy: r.y + r.height / 2,
        });
      }
    });
    // 去重（相近坐标只保留一个）
    const deduped = [];
    for (const c of results) {
      const dup = deduped.find(d => Math.abs(d.x - c.x) < 10 && Math.abs(d.y - c.y) < 10);
      if (!dup) deduped.push(c);
    }
    return deduped;
  });
}

// ═══════════════════════════════════════════════
// 匹配
// ═══════════════════════════════════════════════

function matchControl(label, controls) {
  let best = null, bestScore = Infinity;
  for (const c of controls) {
    const dy = Math.abs(c.cy - label.cy);
    const dx = c.x - (label.x + label.w);
    // 同行的控件: y容差80px，x在label右侧(允许多列布局)
    if (dy < 80 && dx > -20) {
      const score = dy + Math.abs(dx) * 0.3;
      if (score < bestScore) { bestScore = score; best = c; }
    }
  }
  // 如果没找到右侧的，放宽条件找最近的
  if (!best) {
    for (const c of controls) {
      const dy = Math.abs(c.cy - label.cy);
      if (dy < 80) {
        if (dy < bestScore) { bestScore = dy; best = c; }
      }
    }
  }
  return best;
}

function printMatches(labels, controls) {
  logger.debug(`  Controls found: ${controls.length}`);
  controls.slice(0, 12).forEach(c => {
    logger.debug(`    ctrl#${c.idx} ${c.tag} "${c.text}" "${c.placeholder}" cls="${c.cls.substring(0,25)}" @(${c.x.toFixed(0)},${c.y.toFixed(0)})`);
  });
  for (const l of labels) {
    const c = matchControl(l, controls);
    logger.debug(`  "${l.name}" @y=${l.cy.toFixed(0)} → ctrl#${c?.idx ?? 'NONE'} @(${c?.x?.toFixed(0) ?? '?'},${c?.y?.toFixed(0) ?? '?'})`);
  }
}

// ═══════════════════════════════════════════════
// 值操作
// ═══════════════════════════════════════════════

async function readCurrentValue(page, ctrl) {
  try {
    return await page.evaluate((cx, cy) => {
      // beast-core-select 当前值
      for (const s of document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]')) {
        const r = s.getBoundingClientRect();
        if (Math.abs(r.y - cy) < 30 && Math.abs(r.x - cx) < 250) return s.value || '';
      }
      // 附近div/span文本
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

async function selectExact(page, ctrl, value) {
  await page.mouse.click(ctrl.cx, ctrl.cy);
  await page.waitForTimeout(500);

  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')].map(o => o.innerText.trim()).filter(Boolean)
  );
  if (opts.length === 0) { await page.keyboard.press('Escape'); return { ok: false, reason: 'no dropdown', opts: [] }; }

  const v = String(value).trim();
  const vNorm = v.replace(/\s/g, '');
  const vClean = v.replace(/[\s，,。.!！、/\\()（）【】\[\]]/g, '');

  // 1. getByRole exact
  const exact = page.getByRole('option', { name: v }).first();
  if (await exact.count() > 0) { await exact.click(); return { ok: true, reason: 'exact' }; }

  // 2. 从 opts 列表找精确匹配
  const exOpt = opts.find(o => o === v) || opts.find(o => o.replace(/\s/g, '') === vNorm) || opts.find(o => o.replace(/[\s，,。.!！、/\\()（）【】\[\]]/g, '') === vClean);
  if (exOpt) {
    const el = page.getByRole('option', { name: exOpt }).first();
    if (await el.count() > 0) { await el.click(); return { ok: true, reason: 'opts-exact' }; }
  }

  return { ok: false, reason: 'not found', opts };
}

// ═══════════════════════════════════════════════
// 单个属性
// ═══════════════════════════════════════════════

async function fillOneAttr(page, attr, ctrl) {
  const v = String(attr.value).trim();
  if (!v) return { ok: false, reason: 'empty value' };

  // 读当前值
  const cur = await readCurrentValue(page, ctrl);
  if (cur) {
    const cNorm = cur.replace(/\s/g, '');
    const vNorm = v.replace(/\s/g, '');
    if (cur === v || cNorm === vNorm) {
      return { ok: true, reason: 'already_ok', current: cur };
    }
    // 反义检测：不选错
    if (isNoFuzzy(attr.name) && cur.includes(v) && cur !== v) {
      // 当前是"支持定制"，目标是"不支持定制"——不能跳过
    }
  }

  // 选择
  let result = await selectExact(page, ctrl, v);

  // 非是否类：允许最后模糊
  if (!result.ok && !isNoFuzzy(attr.name)) {
    await page.mouse.click(ctrl.cx, ctrl.cy);
    await page.waitForTimeout(400);
    const fuzzy = page.locator(`[role="option"]:has-text("${v}")`).first();
    if (await fuzzy.count() > 0) {
      const ft = await fuzzy.innerText();
      if (ft.length < v.length + 10) {
        await fuzzy.click();
        result = { ok: true, reason: 'fuzzy' };
      }
    } else {
      await page.keyboard.press('Escape');
    }
  } else if (!result.ok) {
    await page.keyboard.press('Escape');
    if (result.opts) logger.warn(`    Options: ${result.opts.join(', ')}`);
  }

  // 读回校验
  await page.waitForTimeout(300);
  const actual = await readCurrentValue(page, ctrl);
  if (result.ok && actual && actual !== v && actual.replace(/\s/g, '') !== v.replace(/\s/g, '')) {
    // 选错了，重试
    logger.warn(`    verify FAILED: expected="${v}" actual="${actual}" — retrying once`);
    await page.mouse.click(ctrl.cx, ctrl.cy);
    await page.waitForTimeout(400);
    const retry = page.getByRole('option', { name: v }).first();
    if (await retry.count() > 0) { await retry.click(); await page.waitForTimeout(300); } else { await page.keyboard.press('Escape'); }
    const actual2 = await readCurrentValue(page, ctrl);
    if (actual2 && actual2 !== v && actual2.replace(/\s/g, '') !== v.replace(/\s/g, '')) {
      return { ok: false, reason: `verify FAILED: expected="${v}" actual="${actual2}"`, current: actual2 };
    }
  }

  return { ...result, current: actual };
}

// ═══════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════

async function fillAttributes(page, product) {
  logger.step('=== Filling Attributes ===');
  const rawAttrs = product.attributes || [];
  if (rawAttrs.length === 0) { logger.info('No attributes'); return; }

  // 去重
  const seen = new Map(); for (const a of rawAttrs) seen.set(a.name, a);
  const attrs = [...seen.values()];

  logger.info(`Attributes for ${product.productId}:`);
  attrs.forEach(a => logger.info(`  ${a.name} = ${a.value}`));

  // 滚动到属性区
  await page.evaluate(() => { const e = [...document.querySelectorAll('*')].find(el => el.innerText === '商品属性' && el.offsetHeight > 0); if (e) e.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(500);

  // 关闭一键复用弹窗
  try { if ((await page.evaluate(() => document.body.innerText)).includes('一键复用')) { const no = page.locator('text=不使用').first(); if (await no.count() > 0) { await no.click(); await page.waitForTimeout(800); } } } catch {}
  await takeScreenshot(page, '06_attrs_before');

  // 扫描
  const labels = await scanAllLabels(page, attrs.map(a => a.name));
  const controls = await scanAllControls(page);
  printMatches(labels, controls);

  const filledSet = new Set();
  let filled = 0, skipped = 0, already = 0;

  for (const attr of attrs) {
    if (filledSet.has(attr.name)) continue;
    filledSet.add(attr.name);

    const label = labels.find(l => l.name === attr.name);
    if (!label) { logger.info(`  ⚠ "${attr.name}" — label not on page, skip`); skipped++; continue; }

    const ctrl = matchControl(label, controls);
    if (!ctrl) {
      logger.warn(`  ⚠ "${attr.name}" — label found @y=${label.cy.toFixed(0)} but no matching control`);
      await takeScreenshot(page, `06_attr_${attr.name}_noctrl`);
      skipped++; continue;
    }

    const r = await fillOneAttr(page, attr, ctrl);

    if (r.reason === 'already_ok') {
      logger.info(`  ✓ "${attr.name}" = "${r.current}" (already OK)`);
      already++;
    } else if (r.ok) {
      logger.info(`  ✓ "${attr.name}" → "${attr.value}"${r.current ? ' verify: ' + r.current : ''} [${r.reason}]`);
      filled++;
    } else {
      logger.warn(`  ✗ "${attr.name}" → "${attr.value}" FAILED: ${r.reason}`);
      skipped++;
    }
    await page.waitForTimeout(200);
  }

  await takeScreenshot(page, '07_attrs_done');
  logger.info(`Attributes: ${filled} filled, ${already} already-OK, ${skipped} skipped`);
}

module.exports = { fillAttributes };
