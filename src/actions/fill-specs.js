/**
 * 设置 SKU 规格维度 — 按坐标定位每个规格块，在块内填值
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 扫描所有规格块的标注点：找到规格类型下拉框的位置，再找它下方的值输入框
 * 返回 [{ name, specY, inputIndexes: [idx, ...] }]
 */
async function scanSpecLayout(page) {
  return page.evaluate(() => {
    const blocks = [];
    // 找规格类型下拉框（beast-core-select-htmlInput，有值的）
    const selects = document.querySelectorAll('[data-testid="beast-core-select-htmlInput"]');
    for (const sel of selects) {
      const val = sel.value || '';
      const ph = sel.placeholder || '';
      // 规格类型下拉框：placeholder 含"规格类型"或 value 含维度名
      const isSpecType = ph.includes('规格类型') || (val && val.length <= 6 && !ph.includes('请选择'));
      if (!isSpecType) continue;
      const sr = sel.getBoundingClientRect();
      if (sr.width < 30 || sr.height < 10 || sr.y < 200) continue;

      const name = val || ph.replace('规格类型', '').replace(/^\d+/, '').trim();
      if (!name) continue;

      // 找它下方最近的 textbox（值输入框）
      const allTb = document.querySelectorAll('[data-testid="beast-core-input-htmlInput"], input[type="text"], input:not([type])');
      const tbIndices = [];
      for (let i = 0; i < allTb.length; i++) {
        const tb = allTb[i];
        const tr = tb.getBoundingClientRect();
        // 在该下拉框下方 100px 以内，x 接近
        if (tr.y > sr.y && tr.y < sr.y + sr.height + 120 && Math.abs(tr.x - sr.x) < 300 && tr.width > 30) {
          tbIndices.push(i);
        }
      }

      // 找添加按钮
      const addBtns = document.querySelectorAll('a, button, [class*="add"], [class*="添加"]');
      let addBtnIdx = -1;
      for (let i = 0; i < addBtns.length; i++) {
        const ar = addBtns[i].getBoundingClientRect();
        if (ar.y > sr.y && ar.y < sr.y + sr.height + 120 && Math.abs(ar.x - sr.x) < 300) {
          addBtnIdx = i;
          break;
        }
      }

      blocks.push({
        name,
        specY: sr.y,
        specX: sr.x,
        tbIndices,
        addBtnIdx,
        inputCount: tbIndices.length,
        hasAddBtn: addBtnIdx >= 0,
      });
    }
    return blocks;
  });
}

/**
 * 添加规格类型
 */
async function addSpecType(page, specName, specIndex) {
  const addBtn = page.locator(config.selectors.spec.addSpecBtn);
  if (await addBtn.count() === 0) return false;
  await addBtn.click();
  await page.waitForTimeout(500);

  const specInput = page.getByRole('textbox', { name: `规格类型${specIndex}` });
  if (await specInput.count() === 0) return false;
  await specInput.click();
  await page.waitForTimeout(300);

  const opt = page.getByRole('option', { name: specName }).first();
  if (await opt.count() > 0) { await opt.click(); await page.waitForTimeout(300); return true; }
  const fuzzy = page.locator(`[role="option"]:has-text("${specName}")`).first();
  if (await fuzzy.count() > 0) { await fuzzy.click(); await page.waitForTimeout(300); return true; }
  try { await specInput.fill(specName); await page.waitForTimeout(300); return true; } catch { return false; }
}

/**
 * 按 block 填入规格值
 */
async function fillSpecBlock(page, block, values) {
  if (!values || values.length === 0) return true;

  // 获取该 block 下的所有 textbox
  const allTb = page.getByRole('textbox');
  const tbCount = await allTb.count();
  const blockTb = [];
  for (let i = 0; i < tbCount; i++) {
    const tb = allTb.nth(i);
    try {
      const box = await tb.boundingBox();
      if (!box) continue;
      if (box.y > block.specY && box.y < block.specY + 120 && Math.abs(box.x - block.specX) < 350 && box.width > 30) {
        // 排除规格类型下拉框自身
        const ph = await tb.getAttribute('placeholder').catch(() => '');
        if (ph.includes('规格类型')) continue;
        blockTb.push({ idx: i, locator: tb });
      }
    } catch {}
  }

  if (blockTb.length === 0) {
    logger.error(`  ✗ Cannot find value input inside spec block: ${block.name}`);
    await takeScreenshot(page, `08_spec_novalue_${block.name}`);
    return false;
  }

  logger.info(`  Value input for ${block.name} found @ block y=${block.specY.toFixed(0)}, ${blockTb.length} textbox(es)`);

  // 获取添加按钮
  const addBtns = page.locator('[class*="add"], a:has-text("添加"), [class*="添加"]');
  const addCount = await addBtns.count();

  for (let vi = 0; vi < values.length; vi++) {
    if (vi > 0) {
      // 点击该 block 内的添加按钮
      let clicked = false;
      for (let ai = 0; ai < addCount; ai++) {
        try {
          const abox = await addBtns.nth(ai).boundingBox();
          if (abox && abox.y > block.specY && abox.y < block.specY + 120) {
            await addBtns.nth(ai).click();
            await page.waitForTimeout(400);
            clicked = true;
            logger.info(`  Clicked add value inside ${block.name} block`);
            break;
          }
        } catch {}
      }
      if (!clicked) {
        logger.warn(`  ⚠ Cannot find add button in ${block.name} block for value ${vi + 1}`);
      }
    }

    // 填入值（填最后一个空 textbox）
    const blockInputs = page.getByRole('textbox');
    const biCount = await blockInputs.count();
    let filled = false;
    for (let bi = biCount - 1; bi >= 0; bi--) {
      try {
        const bbox = await blockInputs.nth(bi).boundingBox();
        if (!bbox || bbox.y < block.specY || bbox.y > block.specY + 120) continue;
        const ph = await blockInputs.nth(bi).getAttribute('placeholder').catch(() => '');
        if (ph.includes('规格类型')) continue;
        const val = await blockInputs.nth(bi).inputValue().catch(() => '');
        if (val === '' || val === '请输入规格名称' || val === '请输入') {
          await blockInputs.nth(bi).fill(values[vi]);
          await page.waitForTimeout(config.timeouts.reactRerender);
          logger.info(`  Filled ${block.name}: "${values[vi]}"`);
          filled = true;
          break;
        }
      } catch {}
    }
    if (!filled) {
      logger.error(`  ✗ Cannot fill value ${vi + 1} "${values[vi]}" in ${block.name} block`);
      return false;
    }
  }
  return true;
}

/**
 * 校验 block 内的值
 */
async function verifySpecBlock(page, block, values) {
  const allTb = page.getByRole('textbox');
  const tbCount = await allTb.count();
  const actual = [];
  for (let i = 0; i < tbCount; i++) {
    try {
      const box = await allTb.nth(i).boundingBox();
      if (!box || box.y < block.specY || box.y > block.specY + 120) continue;
      const ph = await allTb.nth(i).getAttribute('placeholder').catch(() => '');
      if (ph.includes('规格类型')) continue;
      const val = await allTb.nth(i).inputValue().catch(() => '');
      if (val && val !== '请输入规格名称' && val !== '请输入') actual.push(val);
    } catch {}
  }
  const allFound = values.every(v => actual.includes(v));
  const noExtra = actual.every(v => values.includes(v));
  if (allFound && noExtra) {
    logger.info(`  ✓ ${block.name}: expected=${JSON.stringify(values)} actual=${JSON.stringify(actual)} OK`);
    return true;
  }
  logger.error(`  ✗ ${block.name} MISMATCH: expected=${JSON.stringify(values)} actual=${JSON.stringify(actual)}`);
  await takeScreenshot(page, `08_spec_mismatch_${block.name}`);
  return false;
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

  // 扫描布局
  const blocks = await scanSpecLayout(page);
  logger.info(`Found ${blocks.length} spec blocks: ${blocks.map(b => b.name).join(', ')}`);
  if (blocks.length === 0) {
    await takeScreenshot(page, '08_spec_no_blocks');
    throw new Error('No spec blocks found on page');
  }

  // 每个维度填值
  for (const dim of dimensions) {
    logger.info(`  Spec: ${dim.name} → [${dim.values.join(', ')}]`);
    const block = blocks.find(b => b.name === dim.name);
    if (!block) {
      logger.error(`  ✗ Spec block "${dim.name}" not found on page`);
      await takeScreenshot(page, `08_spec_block_${dim.name}_missing`);
      throw new Error(`Spec block "${dim.name}" not found`);
    }

    logger.info(`  Spec block ${dim.name} found at y=${block.specY.toFixed(0)}`);

    // 填值
    const ok = await fillSpecBlock(page, block, dim.values);
    if (!ok) throw new Error(`Failed to fill spec "${dim.name}"`);

    // 校验
    const verified = await verifySpecBlock(page, block, dim.values);
    if (!verified) throw new Error(`Spec "${dim.name}" verification failed`);
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
