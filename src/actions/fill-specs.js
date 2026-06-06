/**
 * 填规格值 — 逐个值输入 + key事件 + 等新input出现 + 校验
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

async function findSpecBlockRoot(page, labelText) {
  return page.evaluate((name) => {
    const all = document.querySelectorAll('div, span, label, p');
    for (const el of all) {
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
      if ((s.value || '').trim() === name) {
        const r = s.getBoundingClientRect();
        return { top: r.y, bottom: r.y + 200, left: r.x, found: true };
      }
    }
    return { found: false };
  }, labelText);
}

async function readBlockValues(page, block) {
  return page.evaluate((b) => {
    const vals = [];
    const inputs = document.querySelectorAll('[data-testid="beast-core-input-htmlInput"], input[type="text"], input:not([type])');
    for (const inp of inputs) {
      const r = inp.getBoundingClientRect();
      if (r.width < 20 || r.height < 8) continue;
      if (r.y < b.top || r.y > b.bottom) continue;
      if (Math.abs(r.x - b.left) > 350) continue;
      const ph = (inp.placeholder || '');
      if (ph.includes('规格类型') || ph.includes('搜索')) continue;
      const v = (inp.value || '').trim();
      if (v && v !== '请输入规格名称' && v !== '请输入') vals.push(v);
    }
    return vals;
  }, block);
}

async function clickAddInBlock(page, block) {
  return page.evaluate((b) => {
    const btns = document.querySelectorAll('a, button, [class*="add"], [class*="添加"]');
    for (const btn of btns) {
      const r = btn.getBoundingClientRect();
      if (r.width < 8 || r.height < 6) continue;
      if (r.y < b.top || r.y > b.bottom) continue;
      btn.click();
      return true;
    }
    return false;
  }, block);
}

async function fillOneValueInBlock(page, block, value) {
  return page.evaluate((args) => {
    const b = args.block;
    const v = args.value;
    const inputs = document.querySelectorAll('[data-testid="beast-core-input-htmlInput"], input[type="text"], input:not([type])');
    for (const inp of inputs) {
      const r = inp.getBoundingClientRect();
      if (r.width < 20 || r.height < 8) continue;
      if (r.y < b.top || r.y > b.bottom) continue;
      if (Math.abs(r.x - b.left) > 350) continue;
      if ((inp.placeholder || '').includes('规格类型') || (inp.placeholder || '').includes('搜索')) continue;

      const cur = (inp.value || '').trim();
      if (cur === '' || cur === '请输入规格名称' || cur === '请输入') {
        const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        d.set.call(inp, v);
        inp.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        inp.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        return { filled: true };
      }
    }
    return { filled: false };
  }, { block, value });
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
  try {
    return await page.evaluate(() => {
      let n = 0;
      document.querySelectorAll('input[placeholder="请输入"]').forEach(inp => {
        if (inp.getBoundingClientRect().width > 50) n++;
      });
      return Math.floor(n / 3);
    });
  } catch { return 0; }
}

async function fillSpecifications(page, product) {
  logger.step('=== Filling SKU Specifications ===');
  await page.evaluate(() => { const e = document.querySelector('table, [class*="sku"]'); if (e) e.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(500);

  const dims = product.skuDimensions;
  if (dims.length === 0) { logger.info('No SKU dimensions'); return; }
  logger.info(`Dimensions: ${dims.map(d => d.name + '(' + d.values.length + ')').join(', ')}`);

  // 确保规格类型存在
  for (let i = 0; i < dims.length; i++) {
    const si = page.getByRole('textbox', { name: `规格类型${i + 1}` });
    if (await si.count() === 0) { const ok = await addSpecType(page, dims[i].name, i + 1); if (!ok) logger.warn(`Add spec "${dims[i].name}" failed`); }
  }
  await page.waitForTimeout(300);

  // 逐个维度
  for (const dim of dims) {
    logger.info(`  Spec: ${dim.name} → [${dim.values.join(', ')}]`);
    const block = await findSpecBlockRoot(page, dim.name);
    if (!block.found) { await takeScreenshot(page, `08_spec_block_${dim.name}`); throw new Error(`Spec block "${dim.name}" not found`); }
    logger.info(`  Block "${dim.name}" top=${block.top.toFixed(0)} bottom=${block.bottom.toFixed(0)}`);

    // 逐个值
    let beforeVals = await readBlockValues(page, block);
    logger.info(`  Before fill: ${JSON.stringify(beforeVals)}`);

    for (let vi = 0; vi < dim.values.length; vi++) {
      if (vi > 0) {
        const clicked = await clickAddInBlock(page, block);
        if (clicked) {
          await page.waitForTimeout(500);
          logger.info(`  Clicked add in "${dim.name}" block`);
        }
      }

      const filled = await fillOneValueInBlock(page, block, dim.values[vi]);
      if (!filled) { await takeScreenshot(page, `08_noinput_${dim.name}`); throw new Error(`Cannot fill value in "${dim.name}" block`); }

      // 点空白处触发提交
      await page.mouse.click(block.left + 10, block.top - 20);
      await page.waitForTimeout(400);

      const afterVals = await readBlockValues(page, block);
      logger.info(`  After "${dim.values[vi]}": ${JSON.stringify(afterVals)}`);

      if (!afterVals.includes(dim.values[vi])) {
        await takeScreenshot(page, `08_nocommit_${dim.name}`);
        throw new Error(`Value "${dim.values[vi]}" not committed in "${dim.name}" block`);
      }
    }

    // 最终校验
    const finalVals = await readBlockValues(page, block);
    const ok = dim.values.every(v => finalVals.includes(v));
    if (ok) {
      logger.info(`  ✓ "${dim.name}" OK: ${JSON.stringify(finalVals)}`);
    } else {
      logger.error(`  ✗ "${dim.name}" FAIL: expected=${JSON.stringify(dim.values)} actual=${JSON.stringify(finalVals)}`);
      await takeScreenshot(page, `08_fail_${dim.name}`);
      throw new Error(`Spec "${dim.name}" wrong values`);
    }
  }

  await takeScreenshot(page, '08_specs_done');

  // 关闭下拉 + 等 SKU 表刷新
  await page.keyboard.press('Escape');
  await page.mouse.click(200, 200);
  await page.waitForTimeout(500);

  const expected = product.skuRows.length;
  let rows = await countSkuRows(page);
  logger.info(`SKU rows after fill: ${rows} (expected ${expected})`);
  for (let a = 0; a < 15 && rows < expected; a++) {
    await page.waitForTimeout(500);
    rows = await countSkuRows(page);
  }
  if (rows !== expected) {
    await takeScreenshot(page, '08_sku_rows');
    throw new Error(`SKU row count: page=${rows} excel=${expected}`);
  }
  logger.info(`SKU rows: ${rows}/${expected} ✓`);
}

module.exports = { fillSpecifications };
