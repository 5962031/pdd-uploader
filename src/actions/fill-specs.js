/**
 * 设置 SKU 规格 — 只在当前规格块内部找控件，不扫全局 textbox
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 在页面找到包含 labelText 的规格标签元素，返回其 DOM 位置
 */
async function findSpecBlockRoot(page, labelText) {
  return page.evaluate((name) => {
    const all = document.querySelectorAll('div, span, label, p');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 8) continue;
      if (r.y < 200 || r.y > 3000) continue;
      const t = (el.innerText || el.textContent || '').trim();
      if (t === name && t.length <= 6) {
        // 向上找最近的 spec 块容器
        let container = el.parentElement;
        for (let depth = 0; depth < 5 && container; depth++) {
          const cr = container.getBoundingClientRect();
          const cText = (container.innerText || '').trim();
          if (cText.length > t.length + 3 && cText.includes(name) && cr.y > 0) {
            return {
              top: cr.y,
              bottom: cr.y + cr.height,
              left: cr.x,
              found: true,
            };
          }
          container = container.parentElement;
        }
        // 回退到元素自身
        return { top: r.y, bottom: r.y + 200, left: r.x, found: true };
      }
    }
    // 回退: 找显示该值的选择器
    const selects = document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]');
    for (const s of selects) {
      if ((s.value || '').trim() === name) {
        const r = s.getBoundingClientRect();
        return { top: r.y, bottom: r.y + 200, left: r.x, found: true };
      }
    }
    return { found: false };
  }, labelText);
}

/**
 * 在当前规格块内找空 textbox（通过 evaluate 在块内查询，不扫全局）
 */
async function findAndFillInBlock(page, block, value) {
  const result = await page.evaluate((b, v) => {
    // 只找 block 区域内的 textbox
    const inputs = document.querySelectorAll('[data-testid="beast-core-input-htmlInput"], input[type="text"], input:not([type])');
    for (const inp of inputs) {
      const r = inp.getBoundingClientRect();
      if (r.width < 30 || r.height < 10) continue;
      if (r.y < b.top || r.y > b.bottom) continue;  // 必须在 block 区域内
      if (Math.abs(r.x - b.left) > 350) continue;     // x 不能差太远

      // 排除规格类型选择框
      if ((inp.placeholder || '').includes('规格类型')) continue;

      const val = inp.value || '';
      if (val === '' || val === '请输入规格名称' || val === '请输入') {
        // 找到了！用原生 setter 设值
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        desc.set.call(inp, v);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return { filled: true, at: r.y };
      }
    }
    return { filled: false };
  }, block, value);

  return result?.filled || false;
}

/**
 * 在当前规格块内找"添加定制规格"按钮并点击
 */
async function clickAddInBlock(page, block) {
  try {
    return await page.evaluate((b) => {
      const btns = document.querySelectorAll('a, button, [class*="add"], [class*="添加"]');
      for (const btn of btns) {
        const r = btn.getBoundingClientRect();
        if (r.width < 10 || r.height < 8) continue;
        if (r.y < b.top || r.y > b.bottom) continue;
        btn.click();
        return true;
      }
      return false;
    }, block);
  } catch { return false; }
}

/**
 * 校验当前规格块内的值
 */
async function verifyBlockValues(page, block, expectedValues) {
  const result = await page.evaluate((b) => {
    const inputs = document.querySelectorAll('[data-testid="beast-core-input-htmlInput"], input[type="text"], input:not([type])');
    const vals = [];
    for (const inp of inputs) {
      const r = inp.getBoundingClientRect();
      if (r.width < 30 || r.height < 10) continue;
      if (r.y < b.top || r.y > b.bottom) continue;
      if (Math.abs(r.x - b.left) > 350) continue;
      if ((inp.placeholder || '').includes('规格类型')) continue;
      const v = (inp.value || '').trim();
      if (v && v !== '请输入规格名称' && v !== '请输入') vals.push(v);
    }
    return vals;
  }, block);

  const allFound = expectedValues.every(v => result.includes(v));
  const noExtra = result.every(v => expectedValues.includes(v));
  return { ok: allFound && noExtra, actual: result };
}

/**
 * 添加规格类型
 */
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

/**
 * 主入口
 */
async function fillSpecifications(page, product) {
  logger.step('=== Filling SKU Specifications ===');

  await page.evaluate(() => {
    const el = document.querySelector('table, [class*="sku"], [class*="spec"]');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  const dimensions = product.skuDimensions;
  if (dimensions.length === 0) { logger.info('No SKU dimensions'); return; }

  logger.info(`Dimensions (${dimensions.length}): ${dimensions.map(d => d.name + '(' + d.values.length + ')').join(', ')}`);

  // 确保规格类型存在
  for (let i = 0; i < dimensions.length; i++) {
    const specInput = page.getByRole('textbox', { name: `规格类型${i + 1}` });
    if (await specInput.count() === 0) {
      const added = await addSpecType(page, dimensions[i].name, i + 1);
      if (!added) logger.warn(`Could not add spec type "${dimensions[i].name}"`);
    }
  }
  await page.waitForTimeout(300);

  // 逐个维度
  for (const dim of dimensions) {
    logger.info(`  Spec: ${dim.name} → [${dim.values.join(', ')}]`);

    // 找到规格块
    const block = await findSpecBlockRoot(page, dim.name);
    if (!block.found) {
      await takeScreenshot(page, `08_spec_block_${dim.name}`);
      throw new Error(`Spec block "${dim.name}" not found on page`);
    }
    logger.info(`  Spec block "${dim.name}" top=${block.top.toFixed(0)} bottom=${block.bottom.toFixed(0)}`);

    // 逐个填值
    for (let vi = 0; vi < dim.values.length; vi++) {
      if (vi > 0) {
        const added = await clickAddInBlock(page, block);
        if (added) {
          await page.waitForTimeout(400);
          logger.info(`  Clicked add value in "${dim.name}" block`);
        }
      }

      const filled = await findAndFillInBlock(page, block, dim.values[vi]);
      if (!filled) {
        await takeScreenshot(page, `08_spec_noinput_${dim.name}`);
        throw new Error(`Cannot find value input inside spec block: "${dim.name}"`);
      }
      await page.waitForTimeout(config.timeouts.reactRerender);
      logger.info(`  Filled "${dim.name}": "${dim.values[vi]}"`);
    }

    // 校验
    const verify = await verifyBlockValues(page, block, dim.values);
    if (verify.ok) {
      logger.info(`  ✓ "${dim.name}" verified: ${JSON.stringify(verify.actual)}`);
    } else {
      logger.error(`  ✗ "${dim.name}" MISMATCH: expected=${JSON.stringify(dim.values)} actual=${JSON.stringify(verify.actual)}`);
      await takeScreenshot(page, `08_spec_mismatch_${dim.name}`);
      throw new Error(`Spec "${dim.name}" verification failed`);
    }
  }

  await takeScreenshot(page, '08_specs_done');

  // 校验 SKU 行数
  const skuRows = product.skuRows;
  const rows = page.locator('tr');
  let enabledCount = 0;
  for (let i = 0; i < await rows.count(); i++) {
    if ((await rows.nth(i).innerText()).includes('已启用')) enabledCount++;
  }
  if (enabledCount !== skuRows.length) {
    await takeScreenshot(page, '08_sku_row_mismatch');
    throw new Error(`SKU row count mismatch: page has ${enabledCount}, Excel has ${skuRows.length}`);
  }
  logger.info(`SKU rows: ${enabledCount}/${skuRows.length} ✓`);
}

module.exports = { fillSpecifications };
