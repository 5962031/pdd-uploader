/**
 * 设置 SKU 规格 — 按标签文本定位规格块，在块内填值。失败即 throw。
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 在页面找包含 labelText 的文本块（div/span），返回其 y 坐标
 */
async function findLabelY(page, labelText) {
  return page.evaluate((name) => {
    const all = document.querySelectorAll('div, span, label, p');
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 8 || r.y < 200) continue;
      const t = (el.innerText || el.textContent || '').trim();
      if (t === name && t.length <= 6) return r.y + r.height / 2;
    }
    // 回退：找下拉框里已显示的规格类型名（beast-core-select 的值）
    const selects = document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]');
    for (const s of selects) {
      const v = (s.value || '').trim();
      if (v === name) { const r = s.getBoundingClientRect(); return r.y + r.height / 2; }
    }
    return null;
  }, labelText);
}

/**
 * 在 specY 下方查找可填值的 textbox
 */
async function findInputInBlock(page, specY, specName) {
  // 找到 specY 下方、同列的 textbox
  const allTb = page.getByRole('textbox');
  const count = await allTb.count();
  const candidates = [];

  for (let i = 0; i < count; i++) {
    try {
      const box = await allTb.nth(i).boundingBox();
      if (!box || box.width < 30 || box.height < 10) continue;
      // 在 specY 下方 150px 内
      if (box.y > specY && box.y < specY + 150) {
        const ph = await allTb.nth(i).getAttribute('placeholder').catch(() => '');
        const val = await allTb.nth(i).inputValue().catch(() => '');
        // 排除规格类型选择框
        if (ph.includes('规格类型') || ph.includes('搜索分类') || ph.includes('搜索功能')) continue;
        candidates.push({ idx: i, y: box.y, ph, val, locator: allTb.nth(i) });
      }
    } catch {}
  }

  if (candidates.length === 0) {
    logger.error(`  ✗ Cannot find value input below "${specName}" (y=${specY.toFixed(0)})`);
    logger.debug(`     Total textboxes on page: ${count}`);
    return null;
  }

  // 返回最近的一个（y 最接近 specY）
  candidates.sort((a, b) => a.y - b.y);
  const found = candidates[0];
  logger.info(`  Value input for "${specName}" found at y=${found.y.toFixed(0)}`);
  return found;
}

/**
 * 在 specY 下方找"添加定制规格"按钮
 */
async function findAddBtnInBlock(page, specY, specName) {
  try {
    const btns = page.locator('a, button, [class*="add"], [class*="添加"]');
    const cnt = await btns.count();
    for (let i = 0; i < cnt; i++) {
      const box = await btns.nth(i).boundingBox();
      if (box && box.y > specY && box.y < specY + 150 && box.width > 20) {
        return btns.nth(i);
      }
    }
  } catch {}
  return null;
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

  // 逐个维度填值
  for (const dim of dimensions) {
    logger.info(`  Spec: ${dim.name} → [${dim.values.join(', ')}]`);

    // 找到这个规格名的 y 位置
    const specY = await findLabelY(page, dim.name);
    if (specY === null) {
      await takeScreenshot(page, `08_spec_label_${dim.name}`);
      throw new Error(`Cannot find spec label "${dim.name}" on page`);
    }
    logger.info(`  Spec block "${dim.name}" found at y=${specY.toFixed(0)}`);

    // 填值：逐个填入
    for (let vi = 0; vi < dim.values.length; vi++) {
      // 第一个值之后，点"添加定制规格"
      if (vi > 0) {
        const addBtn = await findAddBtnInBlock(page, specY, dim.name);
        if (addBtn) {
          await addBtn.click();
          await page.waitForTimeout(400);
          logger.info(`  Clicked add value inside "${dim.name}" block`);
        } else {
          logger.warn(`  ⚠ Cannot find add button for "${dim.name}" value ${vi + 1}`);
        }
      }

      // 找该 block 内的空 textbox
      const input = await findInputInBlock(page, specY, dim.name);
      if (!input) {
        await takeScreenshot(page, `08_spec_noinput_${dim.name}`);
        throw new Error(`Cannot find value input inside spec block: "${dim.name}"`);
      }

      await input.locator.fill(dim.values[vi]);
      await page.waitForTimeout(config.timeouts.reactRerender);
      logger.info(`  Filled "${dim.name}": "${dim.values[vi]}"`);
    }

    // 校验
    const verifyInput = await findInputInBlock(page, specY, dim.name);
    if (verifyInput) {
      const actualVals = [];
      // 读取该 block 内所有 textbox 的值
      const allTb = page.getByRole('textbox');
      const tbCount = await allTb.count();
      for (let i = 0; i < tbCount; i++) {
        try {
          const box = await allTb.nth(i).boundingBox();
          if (!box || box.y < specY || box.y > specY + 150) continue;
          const ph = await allTb.nth(i).getAttribute('placeholder').catch(() => '');
          if (ph.includes('规格类型') || ph.includes('搜索')) continue;
          const v = await allTb.nth(i).inputValue().catch(() => '');
          if (v && v !== '请输入规格名称' && v !== '请输入') actualVals.push(v);
        } catch {}
      }
      const allOk = dim.values.every(v => actualVals.includes(v));
      if (allOk) {
        logger.info(`  ✓ "${dim.name}" verified: ${JSON.stringify(actualVals)}`);
      } else {
        logger.error(`  ✗ "${dim.name}" MISMATCH: expected=${JSON.stringify(dim.values)} actual=${JSON.stringify(actualVals)}`);
        await takeScreenshot(page, `08_spec_mismatch_${dim.name}`);
        throw new Error(`Spec "${dim.name}" verification failed`);
      }
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
