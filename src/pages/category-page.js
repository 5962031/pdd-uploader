/**
 * 分类选择页 —— 锁定 /goods/category 页面 + body.innerText 读类目 + 严格确认
 */
const readline = require('readline');
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

// ═══════════════════════════════════════════════
// 仅允许的确认按钮精确文本
// ═══════════════════════════════════════════════
const CONFIRM_TEXTS = [
  '确认发布该类商品',
  '确认发布此类商品',
  '确认发布这类商品',
];

/**
 * 在 context 中找到 URL 包含指定关键词的 page
 */
function findPageByUrl(context, urlContains) {
  const pages = context.pages().filter(p => !p.isClosed && !p.isClosed());
  for (const p of pages) {
    const u = p.url();
    if (u.includes(urlContains)) return p;
  }
  return null;
}

/**
 * 锁定分类页 —— 必须在 /goods/category 页面操作
 */
async function ensureCategoryPage(context, page) {
  // 先检查传入的 page
  let currentPage = page;
  let currentUrl = currentPage.url();
  logger.info(`  Current page URL: ${currentUrl}`);

  if (currentUrl.includes('/goods/category')) {
    await currentPage.bringToFront();
    logger.info('  Already on category page ✓');
    return currentPage;
  }

  // 在 context 中搜索分类页
  const catPage = findPageByUrl(context, '/goods/category');
  if (catPage) {
    logger.info('  Found /goods/category page in context, switching...');
    await catPage.bringToFront();
    await catPage.waitForTimeout(500);
    return catPage;
  }

  // 如果当前在 goods_list，尝试点击 "发布新商品"
  if (currentUrl.includes('goods_list')) {
    logger.info('  On goods_list, clicking "发布新商品"...');
    const link = currentPage.locator('a:has-text("发布新商品")').first();
    if (await link.count() > 0) {
      await link.click();
      await currentPage.waitForTimeout(3000);

      // 再次搜索
      const newCatPage = findPageByUrl(context, '/goods/category');
      if (newCatPage) {
        logger.info('  Found category page after click ✓');
        await newCatPage.bringToFront();
        await newCatPage.waitForTimeout(500);
        return newCatPage;
      }
    }
  }

  // 最后尝试直接导航
  logger.info('  Attempting direct navigation to category page...');
  await currentPage.goto(config.urls.goodsCategory, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await currentPage.waitForTimeout(2000);
  if (currentPage.url().includes('/goods/category')) {
    return currentPage;
  }

  throw new Error(
    'Cannot find or open /goods/category page.\n' +
    `Current pages: ${context.pages().map(p => p.url()).join(', ')}\n` +
    'Make sure you are not on the goods detail page or goods list page.'
  );
}

/**
 * 调试：打印页面关键信息
 */
async function debugPageState(page, label) {
  const url = page.url();
  logger.debug(`[${label}] URL: ${url}`);

  // 打印所有可见按钮（80个）
  const btns = await page.evaluate(() => {
    return [...document.querySelectorAll('button')]
      .filter(b => b.offsetHeight > 0)
      .map(b => (b.innerText || '').trim())
      .filter(Boolean);
  });
  logger.debug(`[${label}] Buttons (${btns.length}): ${JSON.stringify(btns)}`);

  // 打印包含 "确认" 的元素
  const confirmEls = await page.evaluate(() => {
    return [...document.querySelectorAll('button, a, span, div')]
      .filter(el => el.offsetHeight > 0)
      .map(el => (el.innerText || '').trim())
      .filter(t => t.includes('确认') || t.includes('发布'))
      .slice(0, 20);
  });
  logger.debug(`[${label}] "确认/发布" elements: ${JSON.stringify(confirmEls)}`);
}

/**
 * 精确读取页面底部 "已选分类" 区域（排除"最近使用的分类"干扰）
 * 返回 { selectedPath: string, recentPath: string }
 */
async function readCategoryState(page) {
  try {
    const result = await page.evaluate(() => {
      const body = document.body.innerText;
      const lines = body.split('\n');

      let recentPath = '';
      let selectedPath = '';

      // 找 "最近使用的分类" 下面的路径
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('最近使用的分类')) {
          // 下一行通常就是类目路径（含 > 符号）
          for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
            if (lines[j].includes('>')) {
              recentPath = lines[j].trim();
              break;
            }
          }
          break;
        }
      }

      // 找 "已选分类" 后面的路径（在页面底部）
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes('已选分类')) {
          // "已选分类" 标签和类目路径通常在同一行或下一行
          const line = lines[i];
          const after = line.substring(line.indexOf('已选分类') + 4).trim();
          if (after.includes('>')) {
            selectedPath = after;
          } else if (i + 1 < lines.length && lines[i + 1].includes('>')) {
            selectedPath = lines[i + 1].trim();
          }
          break;
        }
      }

      return { recentPath, selectedPath };
    });

    if (result.recentPath) {
      logger.info(`  Recent category: "${result.recentPath}"`);
    }
    if (result.selectedPath) {
      logger.info(`  Selected category (bottom): "${result.selectedPath}"`);
    } else {
      logger.info('  No "已选分类" found at page bottom — category NOT selected');
    }

    return result;
  } catch (err) {
    logger.warn(`  readCategoryState error: ${err.message}`);
    return { recentPath: '', selectedPath: '' };
  }
}

/**
 * 检查已选分类是否包含目标叶子类目
 */
function isCategoryCorrect(selectedPath, expectedLeaf) {
  if (!selectedPath) return false;
  return selectedPath.includes(expectedLeaf);
}

/**
 * 查找确认按钮 —— 精确文本匹配，支持非 button 元素
 */
async function findConfirmButton(page) {
  // 方法 1: 精确文本匹配 button
  for (const ct of CONFIRM_TEXTS) {
    const btn = page.getByText(ct, { exact: true }).first();
    if (await btn.count() > 0) {
      const visible = await btn.isVisible().catch(() => false);
      if (visible && !(await btn.isDisabled().catch(() => false))) {
        logger.debug(`  Confirm via getByText exact: "${ct}"`);
        return btn;
      }
    }
  }

  // 方法 2: locator text= 匹配
  for (const ct of CONFIRM_TEXTS) {
    const el = page.locator(`text=${ct}`).first();
    if (await el.count() > 0) {
      const tag = await el.evaluate(e => e.tagName).catch(() => 'UNKNOWN');
      const visible = await el.isVisible().catch(() => false);
      if (visible) {
        logger.debug(`  Confirm via locator text=: "${ct}" (tag: ${tag})`);
        return el;
      }
    }
  }

  // 方法 3: 扫描所有按钮精确匹配
  try {
    const match = await page.evaluate((texts) => {
      const btns = [...document.querySelectorAll('button')];
      for (const b of btns) {
        const t = (b.innerText || '').trim();
        if (b.offsetHeight > 0 && texts.includes(t)) return t;
      }
      // 也扫描 span/div/link 中的确认按钮
      const all = [...document.querySelectorAll('span, div, a')];
      for (const el of all) {
        const t = (el.innerText || '').trim();
        if (el.offsetHeight > 0 && texts.includes(t)) return t;
      }
      return null;
    }, CONFIRM_TEXTS);

    if (match) {
      logger.debug(`  Confirm via JS scan: "${match}"`);
      return page.locator(`text="${match}"`).first();
    }
  } catch { /* ignore */ }

  logger.warn('  No confirm button found');
  return null;
}

/**
 * 点击确认按钮并等待跳转
 */
async function clickConfirmAndWait(page) {
  const btn = await findConfirmButton(page);
  if (!btn) return false;

  logger.info(`  Clicking confirm...`);
  await btn.click({ timeout: 5000 }).catch(async () => {
    // JS 回退
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('button, span, div')]
        .find(e => e.innerText?.trim() === '确认发布该类商品');
      if (el) el.click();
    });
  });
  await page.waitForTimeout(3000);
  return true;
}

/**
 * 人工辅助模式
 */
async function manualAssist(page, expectedLeaf) {
  logger.info('');
  logger.info('╔══════════════════════════════════════════════╗');
  logger.info('║  MANUAL ASSIST — 请手动选择类目             ║');
  logger.info(`║  目标叶子类目: ${expectedLeaf}` + ' '.repeat(Math.max(0, 28 - expectedLeaf.length)) + '║');
  logger.info('║  请在浏览器中逐级选择正确类目                ║');
  logger.info('║  选好后按 Enter 继续                        ║');
  logger.info('╚══════════════════════════════════════════════╝');
  logger.info('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => {
    rl.question('按 Enter 继续...', () => { rl.close(); resolve(); });
  });

  await page.bringToFront();
  await page.waitForTimeout(500);
  await takeScreenshot(page, '03_manual_selection');

  // 重新读底部"已选分类"
  const state = await readCategoryState(page);

  logger.info(`  Bottom selected: "${state.selectedPath || '(empty)'}"`);
  logger.info(`  Recent (ignored): "${state.recentPath}"`);
  logger.info(`  Target leaf: "${expectedLeaf}"`);

  // 校验
  if (!isCategoryCorrect(state.selectedPath, expectedLeaf)) {
    logger.warn(`  Bottom still NOT showing "${expectedLeaf}" — may need to re-select`);
    logger.info('  Trying confirm anyway (user said it is correct)...');
  }

  // 点击确认
  const ok = await clickConfirmAndWait(page);
  if (ok) return true;

  // 再试一次
  logger.warn('  Confirm click failed, trying again...');
  const ok2 = await clickConfirmAndWait(page);
  if (ok2) return true;

  await debugPageState(page, 'manual_failed');
  await takeScreenshot(page, '03_manual_failed');
  return false;
}

// ═══════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════
/**
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} page
 * @param {string[]} categoryPath
 */
async function selectCategory(context, page, categoryPath) {
  const expectedLeaf = categoryPath[categoryPath.length - 1];
  logger.step(`Category: ${categoryPath.join(' > ')}`);

  // ---- Step 1: 锁定分类页 ----
  const catPage = await ensureCategoryPage(context, page);

  await debugPageState(catPage, 'category_page');
  await takeScreenshot(catPage, '03_category_page');

  // ---- Step 2: 读取当前分类状态 ----
  let state = await readCategoryState(catPage);

  // 关键：只有底部"已选分类"区域显示的才算是真的已选
  // "最近使用的分类"里的不算！
  if (isCategoryCorrect(state.selectedPath, expectedLeaf)) {
    logger.info(`Category already selected (bottom): "${state.selectedPath}" ✓`);
    const ok = await clickConfirmAndWait(catPage);
    if (ok) return await waitForFormLoad(catPage);
  }

  if (state.selectedPath) {
    logger.info(`Bottom selection is "${state.selectedPath}" — does NOT match "${expectedLeaf}", need to click tree`);
  }

  // ---- Step 3: 逐级点击类目树 ----
  logger.step('Clicking tree level by level...');
  for (let i = 0; i < categoryPath.length; i++) {
    const level = categoryPath[i];
    logger.info(`  Level ${i + 1}/4: "${level}"`);

    if (level.includes('/')) {
      for (const part of level.split('/')) {
        const trimmed = part.trim();
        const ok = await clickByText(catPage, trimmed);
        if (ok) logger.info(`    ✓ "${trimmed}"`);
        else logger.warn(`    ✗ "${trimmed}"`);
        await catPage.waitForTimeout(300);
      }
    } else {
      const ok = await clickByText(catPage, level);
      if (ok) logger.info(`    ✓ "${level}"`);
      else logger.warn(`    ✗ "${level}"`);
    }

    await takeScreenshot(catPage, `03_level_${i + 1}`);
    await catPage.waitForTimeout(400);
  }

  // ---- Step 4: 验证底部"已选分类" ----
  await catPage.waitForTimeout(500);
  state = await readCategoryState(catPage);

  await debugPageState(catPage, 'before_confirm');

  if (isCategoryCorrect(state.selectedPath, expectedLeaf)) {
    logger.info(`Bottom selection verified ✓ → "${state.selectedPath}"`);
    const ok = await clickConfirmAndWait(catPage);
    if (ok) return await waitForFormLoad(catPage);
  } else {
    logger.warn(`Bottom selection is "${state.selectedPath || '(empty)'}" — NOT "${expectedLeaf}"`);
    logger.warn(`Recent category (ignored): "${state.recentPath}"`);
  }

  // ---- Step 5: 人工辅助 ----
  logger.warn('Auto tree click did not change bottom selection — entering manual assist...');
  const manualOk = await manualAssist(catPage, expectedLeaf);
  if (manualOk) return await waitForFormLoad(catPage);

  throw new Error(
    'Category selection failed after manual assist.\n' +
    `Expected leaf: "${expectedLeaf}"\n` +
    `Bottom selection: "${state.selectedPath || '(empty)'}"\n` +
    'Check Chrome window and screenshots in logs/screenshots/.'
  );
}

/**
 * 用文本点击元素 —— 返回 true/false，不假成功
 */
async function clickByText(page, text) {
  // Playwright 精确匹配
  const exact = page.locator(`text="${text}"`).first();
  if (await exact.count() > 0) {
    try {
      await exact.click({ timeout: 5000 });
      await page.waitForTimeout(800);
      return true;
    } catch { /* fall through */ }
  }

  // Playwright 包含匹配
  const fuzzy = page.locator(`text=${text}`).first();
  if (await fuzzy.count() > 0 && text.length > 2) {
    try {
      await fuzzy.click({ timeout: 3000 });
      await page.waitForTimeout(800);
      return true;
    } catch { /* fall through */ }
  }

  // JS fallback —— 必须找到才返回 true
  const result = await page.evaluate((t) => {
    const all = document.querySelectorAll('div, span, li, a, p');
    for (const el of all) {
      if ((el.innerText || '').trim() === t) { el.click(); return 'exact'; }
    }
    for (const el of all) {
      if ((el.innerText || '').includes(t)) { el.click(); return 'contains'; }
    }
    return false;
  }, text);

  if (result) {
    logger.debug(`  JS click "${text}" (${result})`);
    await page.waitForTimeout(800);
    return true;
  }

  return false;
}

/**
 * 等待表单页加载
 */
async function waitForFormLoad(page) {
  try {
    await page.waitForFunction(
      () => window.location.href.includes('goods_add') || window.location.href.includes('goods_id'),
      { timeout: 10000 }
    );
    await takeScreenshot(page, '04_form_loaded');
    logger.info('Form loaded ✓');
    return page;
  } catch {
    const url = page.url();
    await takeScreenshot(page, '04_form_load_failed');
    throw new Error(`Form page did not load. Still at: ${url}`);
  }
}

module.exports = { selectCategory };
