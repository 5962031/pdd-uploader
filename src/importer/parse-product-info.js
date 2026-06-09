/**
 * 从商品页面提取标题、图片、SKU 信息
 */
const logger = require('../helpers/logger');

async function parseProductInfo(page) {
  logger.step('Extracting product info...');
  const warnings = [];
  let title = '';
  let mainImages = [];
  let detailImages = [];
  let skuDimensions = [];
  let skuRows = [];
  let skuImages = [];

  // ═══════════════════════════════════════════════
  // 辅助：滚动采集详情图
  // ═══════════════════════════════════════════════
  async function extractDetailImages(page, existingMainImages) {
    const mainSet = new Set((existingMainImages || []).map(u => u.replace(/\?.*$/, '')));
    const collected = new Set();
    const MIN_SIZE = 200; // 最小宽高

    // 先收集当前可见图片
    let beforeCount = 0;
    const collectVisible = async () => {
      const urls = await page.evaluate((minSz) => {
        const result = [];
        const imgs = document.querySelectorAll('img[src*="pddpic"], img[src*="mms"]');
        for (const img of imgs) {
          const src = (img.src || '').replace(/\?.*$/, '');
          if (!src || !src.includes('pddpic.com')) continue;
          if (img.naturalWidth < minSz && img.naturalHeight < minSz) continue;
          if (img.width < minSz && img.height < minSz) continue;
          result.push(src);
        }
        return result;
      }, MIN_SIZE);
      for (const u of urls) { if (!mainSet.has(u) && !collected.has(u)) collected.add(u); }
      return urls.length;
    };

    beforeCount = await collectVisible();
    logger.info(`  Detail scan: before scroll=${beforeCount} visible images`);

    // 滚动页面多次触发懒加载
    for (let scroll = 0; scroll < 8; scroll++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.8));
      await page.waitForTimeout(500);
      const total = await collectVisible();
      if (scroll % 2 === 0) {
        logger.debug(`    scroll ${scroll + 1}: ${total} visible`);
      }
    }

    const after = [...collected];
    logger.info(`  Detail candidates: ${after.length}`);
    return after.slice(0, 50);
  }

  // ═══════════════════════════════════════════════
  // 辅助：扫描触发候选
  // ═══════════════════════════════════════════════
  async function scanTriggerCandidates(page) {
    return page.evaluate(() => {
      const vh = window.innerHeight;
      const all = [...document.querySelectorAll('button, a, div[role=button], [class*=button], [class*=btn], [class*=buy], [class*=group], [class*=sku], [class*=spec]')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 15; })
        .map(el => ({ tag: el.tagName, text: (el.innerText || '').trim().substring(0, 30), cls: (el.className?.toString() || '').substring(0, 40), x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y) }));
      const visible = all.filter(c => c.y > -50 && c.y < vh + 200);
      return { all: all.slice(0, 25), visible: visible.slice(0, 15) };
    });
  }

  // ═══════════════════════════════════════════════
  // 辅助：打开 SKU 弹窗并提取规格
  // ═══════════════════════════════════════════════
  async function extractSkuFromModal(page) {
    const result = { dimensions: [], rows: [], warnings: [] };

    try {
      // 1. 回到顶部
      await page.evaluate('window.scrollTo(0, 0)');
      await page.waitForTimeout(800);

      // 2. 滚到底部
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await page.waitForTimeout(800);

      // 3. 找底部触发按钮（直接用文本查找）
      const keywords = ['发起拼单', '单独购买', '立即购买', '去拼单', '参与拼单', '直接拼成'];
      let triggerText = '';
      for (const kw of keywords) {
        try {
          const el = page.locator(`text="${kw}"`).first();
          if (await el.count() > 0) {
            const box = await el.boundingBox().catch(() => null);
            if (box && box.y > 0) {
              triggerText = kw;
              logger.info(`  Trigger found: "${kw}" @(${Math.round(box.x)},${Math.round(box.y)})`);
              await el.click().catch(() => {});
              await page.waitForTimeout(1500);
              break;
            }
          }
        } catch {}
      }

      if (!triggerText) {
        // 模糊匹配
        const body = await page.evaluate('document.body.innerText');
        for (const kw of keywords) {
          if (body.includes(kw)) {
            const el = page.locator(`button:has-text("${kw}")`).first();
            if (await el.count() > 0) {
              await el.click().catch(() => {});
              await page.waitForTimeout(1500);
              triggerText = kw;
              logger.info(`  Trigger found (fuzzy): "${kw}"`);
              break;
            }
          }
        }
      }

      if (!triggerText) {
        // 点击底部右侧区域
        await page.mouse.click(350, 780);
        await page.waitForTimeout(1500);
        triggerText = '(bottom-right click)';
        logger.info('  Trigger: bottom-right click');
      }

      // 4. 检测是否跳转到订单页
      const bodyText = await page.evaluate('document.body.innerText');
      if (bodyText.includes('提交订单') || bodyText.includes('支付方式')) {
        result.warnings.push('ORDER_PAGE_REACHED_ABORTED');
        await page.goBack().catch(() => {});
        return result;
      }

      // 5. 检测弹窗
      const hasModal = bodyText.includes('已选') || bodyText.includes('确定');
      if (!hasModal) {
        result.warnings.push('SKU_MODAL_NOT_OPENED');
        return result;
      }
      logger.info('  SKU modal opened');

      // 6. 提取规格（过滤噪声文本）
      const noiseFilter = /可定制|已拼|起定制|免费设计|需要定制|联系客服|券后|即将恢复|退货|包运费|优惠|关注券|还差|直接拼成|数量|已选|确定|￥/;
      const lines = bodyText.split('\n').filter(l => {
        const t = l.trim();
        return t.length > 1 && t.length < 80 && !noiseFilter.test(t);
      });
      const specKeywords = ['款式', '套餐', '容量', '颜色', '尺寸', '规格', '口味', '型号', '数量'];
      const selectedIdx = lines.findIndex(l => l.includes('已选'));
      const startIdx = Math.max(0, selectedIdx - 30);

      for (let i = startIdx; i < Math.min(startIdx + 40, lines.length); i++) {
        const line = lines[i].trim();
        if (specKeywords.includes(line) && line.length <= 4 && !result.dimensions.find(d => d.name === line)) {
          const values = [];
          for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
            const v = lines[j].trim();
            if (noiseFilter.test(v)) continue;
            if (v.length > 1 && v.length < 80 && !specKeywords.includes(v) && v !== '已选' && v !== '确定')
              values.push(v);
            else if (v.length > 80 || specKeywords.includes(v) || v === '确定' || v === '已选') break;
          }
          if (values.length > 0) result.dimensions.push({ name: line, values });
        }
      }

      // 7. 提取弹窗内 SKU 图片
      let skuImages = [];
      try {
        skuImages = await page.evaluate(() => {
          const urls = new Set();
          // 弹窗内的 img（dom 选择器比较简单）
          const imgs = document.querySelectorAll('img');
          for (const img of imgs) {
            const rect = img.getBoundingClientRect();
            // 只看屏幕下半部分的图（弹窗区域）
            if (rect.top < 200 || rect.width < 100 || rect.height < 100) continue;
            const src = img.src || img.currentSrc || img.getAttribute('data-src') || '';
            if (src && src.startsWith('http') && (src.includes('pddpic') || src.includes('mms'))) {
              urls.add(src.replace(/\?.*$/, ''));
            }
          }
          return [...urls].slice(0, 10);
        });
      } catch {}
      result.skuImages = skuImages;

      const prices = (bodyText.match(/¥\s*([\d.]+)/g) || []).map(p => parseFloat(p.replace(/¥\s*/, '')));
      const uniquePrices = [...new Set(prices)];
      const fallbackImg = skuImages.length > 0 ? skuImages[0] : '';

      if (result.dimensions.length > 0) {
        const cp = (arr) => arr.reduce((a, b) => a.flatMap(d => b.map(e => [...d, e])), [[]]);
        result.rows = cp(result.dimensions.map(d => d.values)).map(c => {
          const specs = {};
          result.dimensions.forEach((d, i) => { specs[d.name] = c[i]; });
          return { specs, price: uniquePrices[0] ? String(uniquePrices[0]) : '', stock: '', image: fallbackImg };
        });
      }

      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      if (skuImages.length === 0) result.warnings.push('SKU_IMAGES_NOT_FOUND');
      if (result.dimensions.length === 0) result.warnings.push('SKU_DIMENSIONS_NOT_FOUND');
      if (result.rows.length === 0) result.warnings.push('SKU_ROWS_EMPTY');
      if (uniquePrices.length === 0) result.warnings.push('SKU_PRICE_PARTIAL');
    } catch (err) {
      result.warnings.push('SKU_EXTRACTION_ERROR: ' + err.message);
    }
    return result;
  }

  try {
    // 1. 提取标题
    title = await page.evaluate(() => {
      // 尝试多种方式
      const selectors = [
        'h1', '[class*="goods_name"]', '[class*="title"]',
        '[class*="name"]', '[data-testid*="title"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const t = el.innerText.trim();
          if (t.length > 5 && t.length < 200) return t;
        }
      }
      // meta og:title
      const og = document.querySelector('meta[property="og:title"]');
      if (og) { const c = og.getAttribute('content') || ''; if (c.length > 5) return c.trim(); }
      // document.title 清洗
      const dt = document.title.replace(/拼多多|pinduoduo|PDD/gi, '').replace(/[|｜-].*$/, '').trim();
      if (dt.length > 5) return dt;
      // body 中找最长文本行
      const lines = document.body.innerText.split('\n').filter(l => {
        const t = l.trim();
        return t.length > 10 && t.length < 200 && !/^[¥￥\d]/.test(t) && !/券|优惠|收藏|拼单|退货|包邮/.test(t);
      });
      return lines[0]?.trim() || '';
    });
    logger.info(`Title: ${title}`);

    // 2. 提取主图（大图 img，pddpic 域名）
    mainImages = await page.evaluate(() => {
      const imgs = document.querySelectorAll('img[src*="pddpic"], img[src*="mms-material"], img[src*="mms-goods"]');
      const urls = new Set();
      imgs.forEach(img => {
        const src = img.src || '';
        if (src && src.includes('pddpic.com') && img.width > 200) {
          // 去掉尺寸参数取原图
          urls.add(src.replace(/\?.*$/, ''));
        }
      });
      return [...urls].slice(0, 20);
    });
    logger.info(`Main images: ${mainImages.length}`);

    // 3. 提取详情图（滚动触发懒加载）
    detailImages = await extractDetailImages(page, mainImages);
    logger.info(`Detail images: ${detailImages.length}`);

    // 4. 尝试提取 SKU（打开规格弹窗）
    try {
      const skuResult = await extractSkuFromModal(page);
      if (skuResult.dimensions.length > 0) {
        skuDimensions = skuResult.dimensions;
        skuRows = skuResult.rows;
      }
      if (skuResult.skuImages && skuResult.skuImages.length > 0) {
        skuImages = skuResult.skuImages;
        logger.info(`SKU: ${skuDimensions.length} dims, ${skuRows.length} rows`);
      }
      if (skuResult.warnings.length > 0) {
        warnings.push(...skuResult.warnings);
      }
    } catch (skuErr) {
      warnings.push(`SKU extraction error: ${skuErr.message}`);
    }

    logger.info(`SKU: ${skuDimensions.length} dims, ${skuRows.length} rows estimated`);
  } catch (err) {
    warnings.push(`Parse warning: ${err.message}`);
  }

  return { title, mainImages, detailImages, skuDimensions, skuRows, skuImages, warnings };
}

module.exports = { parseProductInfo };
