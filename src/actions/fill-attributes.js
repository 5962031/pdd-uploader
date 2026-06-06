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
    // 策略1: 精确匹配
    const exact = page.locator(`text="${attrName}"`).first();
    if (await exact.count() > 0) {
      const box = await exact.boundingBox();
      if (box) return { label: attrName, x: box.x, y: box.y, w: box.width, h: box.height, cy: box.y + box.height / 2 };
    }

    // 策略2: 滚动到属性区后在所有可见文本中查找包含匹配
    const result = await page.evaluate((name) => {
      // 扫描所有可见的短文本节点（最可能是属性标签的）
      const all = document.querySelectorAll('div, span, label, p, td, th');
      const clean = (t) => t.replace(/[\*重要：:\s]/g, '').trim();

      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 8) continue;
        const text = (el.innerText || el.textContent || '').trim();
        if (text.length < 2 || text.length > 30) continue;

        // 多种匹配
        if (text === name) return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
        if (text.includes(name)) return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
        if (clean(text) === name) return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
        if (clean(text).includes(name)) return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };

        // 例："重要 产品类型" 包含 "产品类型"
        const spaced = text.replace(/\s+/g, '');
        if (spaced.includes(name.replace(/\s+/g, ''))) return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      }
      return null;
    }, attrName);

    if (result) return { label: attrName, x: result.x, y: result.y, w: result.w, h: result.h, cy: result.y + result.h / 2 };

    return null;
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

/**
 * 不能模糊匹配的易反义字段
 */
const NO_FUZZY_FIELDS = ['是否支持定制', '是否带音乐', '是否含税', '是否进口', '是否原创', '是否预售'];

/**
 * 判断当前属性是否禁止模糊匹配
 */
function isNoFuzzy(fieldName) {
  return NO_FUZZY_FIELDS.some(f => fieldName.includes(f) || f.includes(fieldName));
}

async function clickAndSelect(page, ctrl, value, attrName) {
  const v = String(value).trim();
  await page.mouse.click(ctrl.cx, ctrl.cy);
  await page.waitForTimeout(500);

  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')].map(o => o.innerText.trim()).filter(Boolean)
  );
  logger.debug(`  Options: ${JSON.stringify(opts.slice(0, 20))}`);

  if (opts.length === 0) return { ok: false, reason: 'no dropdown appeared' };

  const forbidFuzzy = isNoFuzzy(attrName);

  // 1. 精确匹配（getByRole exact）
  const exact = page.getByRole('option', { name: v }).first();
  if (await exact.count() > 0) {
    await exact.click();
    return { ok: true, reason: 'exact' };
  }

  // 2. 在 options 列表中精确匹配（去空格比较）
  const vNorm = v.replace(/\s/g, '');
  const exactMatch = opts.find(o => o.replace(/\s/g, '') === vNorm);
  if (exactMatch) {
    const el = page.getByRole('option', { name: exactMatch }).first();
    if (await el.count() > 0) { await el.click(); return { ok: true, reason: 'exact-normalized' }; }
    // 回退：用文本点击
    await page.locator(`[role="option"]:text-is("${exactMatch}")`).first().click().catch(() => {});
    await page.waitForTimeout(200);
    const optsAfter = await page.evaluate(() =>
      [...document.querySelectorAll('[role="option"]')].map(o => o.innerText.trim()).filter(Boolean)
    );
    if (optsAfter.length === 0) return { ok: true, reason: 'exact-text-click' };
  }

  // 2b. 补充：去标点后比较
  const vClean = v.replace(/[\s，,。.!！、/\\()（）【】\[\]]/g, '');
  const cleanMatch = opts.find(o => o.replace(/[\s，,。.!！、/\\()（）【】\[\]]/g, '') === vClean);
  if (cleanMatch && cleanMatch !== exactMatch) {
    const el = page.getByRole('option', { name: cleanMatch }).first();
    if (await el.count() > 0) { await el.click(); return { ok: true, reason: 'exact-clean' }; }
  }

  // 3. 如果禁止模糊匹配，到这里就失败
  if (forbidFuzzy) {
    await page.keyboard.press('Escape');
    return { ok: false, reason: `NO_FUZZY: "${v}" not exactly matched. Options: ${opts.join(', ')}` };
  }

  // 4. 模糊匹配（打印 WARN）—— 但不用于子串包含情况
  const strictFuzzy = page.locator(`[role="option"]:text-is("${v}")`).first();
  if (await strictFuzzy.count() > 0) {
    await strictFuzzy.click();
    return { ok: true, reason: 'fuzzy-text-is' };
  }

  const fuzzy = page.locator(`[role="option"]:has-text("${v}")`).first();
  if (await fuzzy.count() > 0 && v.length >= 4) {
    // 额外检查：确保不是相反含义
    const fuzzyText = await fuzzy.innerText();
    if (forbidFuzzy || (fuzzyText.includes('支持') && v.includes('不支持') && fuzzyText !== v)) {
      await page.keyboard.press('Escape');
      return { ok: false, reason: `REJECTED fuzzy: "${fuzzyText}" ≠ "${v}"` };
    }
    logger.warn(`  ⚠ Fuzzy match used for "${attrName}": "${v}" → "${fuzzyText}"`);
    await fuzzy.click();
    return { ok: true, reason: 'fuzzy' };
  }

  await page.keyboard.press('Escape');
  return { ok: false, reason: `"${v}" not in ${opts.join(', ')}` };
}

/**
 * 读回页面当前显示的属性值（通过再次扫描页面文本）
 */
async function verifyAttributeValue(page, attrName) {
  try {
    const labelBox = await findLabelBox(page, attrName);
    if (!labelBox) return null;
    // 读label右侧的控件文本
    const txt = await page.evaluate((y) => {
      const selects = document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]');
      for (const s of selects) {
        const r = s.getBoundingClientRect();
        if (Math.abs(r.y - y) < 60 && r.width > 20) return s.value || s.placeholder || '';
      }
      // 也读div/span文本
      const divs = document.querySelectorAll('div, span');
      for (const d of divs) {
        const r = d.getBoundingClientRect();
        const t = (d.innerText || '').trim();
        if (Math.abs(r.y - y) < 60 && t.length > 1 && t.length < 30 && r.x > labelBox.x + labelBox.w) return t;
      }
      return null;
    }, labelBox.y);
    return txt;
  } catch { return null; }
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
    if (!labelBox) { logger.info(`  ⚠ "${attr.name}" — not on page, skipped`); skipped++; continue; }

    const candidates = findCandidates(labelBox, controls);
    if (candidates.length === 0) {
      logger.info(`  ⚠ "${attr.name}" — no control on page, skipped`);
      skipped++; continue;
    }

    logger.debug(`  "${attr.name}" label@y=${labelBox.cy.toFixed(0)}: ${candidates.length} candidates`);
    let done = false;

    for (let ci = 0; ci < candidates.length && !done; ci++) {
      const c = candidates[ci];
      logger.debug(`    try#${ci + 1} ctrl#${c.idx} ${c.tag} @(${c.x.toFixed(0)},${c.y.toFixed(0)})`);
      const r = await clickAndSelect(page, c, attr.value, attr.name);
      if (r.ok) {
        await page.waitForTimeout(300);
        // 对照字段校验实际值
        const actual = await verifyAttributeValue(page, attr.name);
        if (actual && !actual.includes(attr.value) && attr.value !== actual) {
          logger.warn(`  ⚠ "${attr.name}" verify: expected="${attr.value}" actual="${actual}" — retrying...`);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
          continue; // 重试下一个candidate
        }
        logger.info(`  ✓ "${attr.name}" → "${attr.value}" [${r.reason}]${actual ? ' verify: ✓' : ''}`);
        filled++;
        done = true;
      } else if (ci < candidates.length - 1) {
        logger.debug(`    failed (${r.reason}), trying next candidate...`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }
    }

    if (!done) {
      logger.warn(`  ✗ "${attr.name}" → "${attr.value}" (tried ${candidates.length} candidates)`);
      // 打印所有可选项帮助排查
      await page.mouse.click(candidates[0].cx, candidates[0].cy);
      await page.waitForTimeout(400);
      const allOpts = await page.evaluate(() =>
        [...document.querySelectorAll('[role="option"]')].map(o => o.innerText.trim()).filter(Boolean)
      );
      logger.warn(`    All available options: ${JSON.stringify(allOpts)}`);
      await page.keyboard.press('Escape');
      skipped++;
    }

    await page.waitForTimeout(200);
    await takeScreenshot(page, `06_attr_${attr.name.substring(0, 6)}`);
  }

  await takeScreenshot(page, '07_attrs_done');
  logger.info(`Attributes: ${filled} filled, ${skipped} skipped/not-on-page (of ${attrs.length} in Excel). Page required fields satisfied.`);
}

module.exports = { fillAttributes };
