/**
 * 填规格值 — 每个值统一流程：找空input → 填 → 校验 → 循环
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/** 在页面找包含 labelText 的文本块的 y 坐标 */
async function findSpecBlockRoot(page, labelText) {
  return page.evaluate((name) => {
    for (const el of document.querySelectorAll('div, span, label, p')) {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 8 || r.y < 200 || r.y > 3000) continue;
      if ((el.innerText || el.textContent || '').trim() === name && name.length <= 6) {
        let c = el.parentElement;
        for (let d = 0; d < 5 && c; d++) {
          const cr = c.getBoundingClientRect();
          if ((c.innerText || '').includes(name) && cr.y > 0) return { top: cr.y, bottom: cr.y + cr.height, left: cr.x, found: true };
          c = c.parentElement;
        }
        return { top: r.y, bottom: r.y + 200, left: r.x, found: true };
      }
    }
    for (const s of document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]')) {
      if ((s.value || '').trim() === name) { const r = s.getBoundingClientRect(); return { top: r.y, bottom: r.y + 200, left: r.x, found: true }; }
    }
    return { found: false };
  }, labelText);
}

/** 读取规格块内已填值 —— 必须按 specName 过滤 placeholder */
async function readBlockValues(page, block, specName) {
  return page.evaluate((args) => {
    const b = args.block, name = args.specName;
    const bottom = b.bottom + 500;
    const vals = [];
    document.querySelectorAll('[data-testid="beast-core-input-htmlInput"], input[type="text"], input:not([type])').forEach(inp => {
      const r = inp.getBoundingClientRect();
      if (r.width < 20 || r.height < 8 || r.y < b.top || r.y > bottom || Math.abs(r.x - b.left) > 400) return;
      const ph = (inp.placeholder || '');
      // 排除非本规格的输入框：其他规格名、SKU表filter、价格输入框
      if (ph.includes('规格类型') || ph.includes('搜索')) return;
      if (ph.includes('全部') || ph.includes('库存') || ph.includes('拼单') || ph.includes('单买')) return;
      // 关键：placeholder 必须匹配当前 specName（如"款式""容量"），排除其他规格
      if (ph && !ph.includes(name)) return;
      const v = (inp.value || '').trim();
      // 过滤黑名单（SKU表filter值 / 批量选择行）
      const blocked = /^(全部|库存|拼单价|单买价|规格编码|启用|停用|\d)/;
      if (!v || blocked.test(v) || v === '请输入规格名称' || v === '请输入' || v === '请输入规格') return;
      if (!vals.includes(v)) vals.push(v);
    });
    return vals;
  }, { block, specName });
}

/** 只用 Playwright locator 填值并提交（触发 React） */
async function fillAndCommit(page, block, value, specName) {
  const bottom = block.bottom + 500;

  // 只在当前规格块内 + placeholder 匹配 specName 的 input 中填空
  const result = await page.evaluate((args) => {
    const b = args.block, v = args.value, name = args.specName;
    const bottomB = b.bottom + 500;
    const inputs = document.querySelectorAll('input[type="text"], input:not([type]), [data-testid="beast-core-input-htmlInput"]');
    for (const inp of inputs) {
      const r = inp.getBoundingClientRect();
      if (r.width < 20 || r.height < 8 || r.y < b.top || r.y > bottomB || Math.abs(r.x - b.left) > 400) continue;
      const ph = (inp.placeholder || '').toLowerCase();
      if (ph.includes('规格类型') || ph.includes('搜索') || ph.includes('全部') || ph.includes('库存') || ph.includes('拼单') || ph.includes('单买')) continue;
      if (ph && !ph.includes(name.toLowerCase())) continue;
      const cur = (inp.value || '').trim();
      if (cur === '' || cur === '请输入' || cur === '请输入规格名称' || cur === '请输入规格' || cur === '请选择' || cur.length === 0) {
        try { inp.scrollIntoViewIfNeeded(); } catch {}
        inp.focus(); inp.click();
        const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        d.set.call(inp, ''); inp.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        d.set.call(inp, v); inp.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        inp.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        return { filled: true };
      }
    }
    return { filled: false };
  }, { block, value, specName });

  if (result?.filled) {
    await page.mouse.click(block.left + 10, block.top - 20);
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

/** 点添加按钮 */
async function clickAddInBlock(page, block) {
  // 优先用 Playwright 点击
  const addLink = page.locator('a:has-text("添加"), button:has-text("添加")').first();
  if (await addLink.count() > 0) {
    const box = await addLink.boundingBox();
    if (box && box.y > block.top && box.y < block.bottom) {
      await addLink.click();
      return true;
    }
  }
  // 回退 evaluate
  return page.evaluate((b) => {
    for (const el of document.querySelectorAll('a, button, span, div')) {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 6) continue;
      if (r.y < b.top || r.y > b.bottom) continue;
      const t = (el.innerText || '').trim();
      if (t.includes('添加') || t.includes('定制')) { el.click(); return true; }
    }
    return false;
  }, block);
}

async function addSpecType(page, specName, specIndex) {
  const addBtn = page.locator(config.selectors.spec.addSpecBtn);
  if (await addBtn.count() === 0) return false;
  await addBtn.click(); await page.waitForTimeout(500);
  const inp = page.getByRole('textbox', { name: `规格类型${specIndex}` });
  if (await inp.count() === 0) return false;
  await inp.click(); await page.waitForTimeout(300);
  const opt = page.getByRole('option', { name: specName }).first();
  if (await opt.count() > 0) { await opt.click(); await page.waitForTimeout(300); return true; }
  const fz = page.locator(`[role="option"]:has-text("${specName}")`).first();
  if (await fz.count() > 0) { await fz.click(); await page.waitForTimeout(300); return true; }
  try { await inp.fill(specName); await page.waitForTimeout(300); return true; } catch { return false; }
}

async function countSkuRows(page) {
  try { return await page.evaluate(() => { let n = 0; document.querySelectorAll('input[placeholder="请输入"]').forEach(i => { if (i.getBoundingClientRect().width > 50) n++; }); return Math.floor(n / 3); }); } catch { return 0; }
}

async function fillSpecifications(page, product) {
  logger.step('=== Filling SKU Specifications ===');
  await page.evaluate(() => { const e = document.querySelector('table, [class*="sku"]'); if (e) e.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(500);

  const dims = product.skuDimensions;
  if (dims.length === 0) { logger.info('No SKU dimensions'); return; }
  logger.info(`Dimensions: ${dims.map(d => d.name + '(' + d.values.length + ')').join(', ')}`);

  for (let i = 0; i < dims.length; i++) {
    const si = page.getByRole('textbox', { name: `规格类型${i + 1}` });
    if (await si.count() === 0) { const ok = await addSpecType(page, dims[i].name, i + 1); if (!ok) logger.warn(`Add spec "${dims[i].name}" failed`); }
  }
  await page.waitForTimeout(300);

  for (const dim of dims) {
    logger.info(`  Spec: ${dim.name} → [${dim.values.join(', ')}]`);

    for (let vi = 0; vi < dim.values.length; vi++) {
      const value = dim.values[vi];

      // 刷新 block
      let block = await findSpecBlockRoot(page, dim.name);
      if (!block.found) throw new Error(`Spec block "${dim.name}" lost`);

      let curVals = await readBlockValues(page, block, dim.name);
      if (curVals.includes(value)) {
        logger.info(`  "${dim.name}" already has "${value}"`);
        continue;
      }

      // 打印 block 内所有 input
      const inputsDebug = await page.evaluate((b) => {
        const bottom = b.bottom + 300;
        const r = [];
        document.querySelectorAll('[data-testid="beast-core-input-htmlInput"], input[type="text"], input:not([type])').forEach((inp, i) => {
          const br = inp.getBoundingClientRect();
          if (br.width < 10 || br.y < b.top || br.y > bottom) return;
          r.push({ i, v: (inp.value || '').substring(0, 20), ph: (inp.placeholder || '').substring(0, 20), y: Math.round(br.y) });
        });
        return r;
      }, block);
      logger.info(`  "${dim.name}" inputs before "${value}": ${JSON.stringify(inputsDebug)}`);
      logger.info(`  "${dim.name}" before "${value}": vals=${JSON.stringify(curVals)} block y=[${block.top.toFixed(0)}-${block.bottom.toFixed(0)}]`);

      // 填值：找到空input→填→等页面自动生成新空框
      let committed = false;
      for (let attempt = 0; attempt < 5 && !committed; attempt++) {
        block = await findSpecBlockRoot(page, dim.name);
        if (!block.found) break;

        const filled = await fillAndCommit(page, block, value, dim.name);
        if (filled) {
          // 等页面自动生成新空框 + 校验值已 commit
          for (let w = 0; w < 10; w++) {
            await page.waitForTimeout(300);
            const b = await findSpecBlockRoot(page, dim.name);
            const av = b.found ? await readBlockValues(page, b, dim.name) : [];
            if (av.includes(value)) { committed = true; break; }
          }
        }

        if (!committed) {
          // 点击 block 空白处触发自动刷新
          await page.mouse.click(block.left + 10, block.top - 10);
          await page.waitForTimeout(500);
        }
      }

      curVals = await readBlockValues(page, block, dim.name);
      logger.info(`  "${dim.name}" after "${value}": ${JSON.stringify(curVals)}`);

      if (!committed) {
        await takeScreenshot(page, `08_nocommit_${dim.name}`);
        throw new Error(`Value "${value}" not committed in "${dim.name}" block`);
      }
    }

    const fb = await findSpecBlockRoot(page, dim.name);
    const fv = fb.found ? await readBlockValues(page, fb, dim.name) : [];
    const allOk = dim.values.every(v => fv.includes(v));
    if (allOk) logger.info(`  ✓ "${dim.name}" OK: ${JSON.stringify(fv)}`);
    else { logger.error(`  ✗ "${dim.name}" FAIL: ${JSON.stringify(fv)}`); await takeScreenshot(page, `08_fail_${dim.name}`); throw new Error(`Spec "${dim.name}" wrong`); }
  }

  await takeScreenshot(page, '08_specs_done');
  await page.keyboard.press('Escape');
  try { const st = page.locator('text=商品规格').first(); if (await st.count() > 0) await st.click().catch(() => {}); } catch {}
  await page.waitForTimeout(500);

  const expected = product.skuRows.length;
  let rows = await countSkuRows(page);
  logger.info(`SKU rows: ${rows} (expected ${expected})`);
  for (let a = 0; a < 15 && rows < expected; a++) { await page.waitForTimeout(500); rows = await countSkuRows(page); }
  if (rows < expected) { await takeScreenshot(page, '08_sku_rows'); throw new Error(`SKU rows too low: ${rows} < ${expected}`); }
  if (rows > expected) logger.warn(`Extra SKU rows (${rows} > ${expected}), will ignore`);
  logger.info(`SKU rows: ${rows}/${expected} ✓`);
}

module.exports = { fillSpecifications };
