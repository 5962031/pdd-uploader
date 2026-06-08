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

    // 4. 尝试提取 SKU（点击规格区域打开 SKU 面板）
    try {
      // 滚动到底部触发 SKU 面板
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
      // 点击发起拼单
      const bottomBtn = page.locator('button:has-text("发起拼单"), button:has-text("去拼单")').first();
      if (await bottomBtn.count() > 0) {
        await bottomBtn.click();
        await page.waitForTimeout(2000);
      }
      // 读页面文本找 SKU 信息
      const skuText = await page.evaluate(() => {
        const body = document.body.innerText;
        const idx = body.indexOf('已选');
        if (idx < 0) return '';
        return body.substring(idx, idx + 500);
      });

      if (skuText) {
        // 简单解析：找 "已选：xxx" 后面的规格
        const skuInfo = await page.evaluate(() => {
          const dims = [];
          const rows = [];
          const body = document.body.innerText;
          const lines = body.split('\n').filter(l => l.trim());

          // 找规格名行（如 "款式" "套餐" "容量" 单独一行）和下面的选项
          const specKeywords = ['款式', '套餐', '容量', '颜色', '尺寸', '规格', '口味', '型号', '数量'];
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (specKeywords.includes(line) && line.length <= 4) {
              const values = [];
              for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                const v = lines[j].trim();
                if (v.length > 1 && v.length < 30 && !specKeywords.includes(v)) {
                  values.push(v);
                } else if (v.length > 30 || specKeywords.includes(v)) {
                  break;
                }
              }
              if (values.length > 0) dims.push({ name: line, values });
            }
          }

          // 找价格
          const priceMatch = body.match(/¥\s*([\d.]+)/g);
          const prices = priceMatch ? priceMatch.map(p => p.replace(/¥\s*/, '')) : [];

          return { dims, prices };
        });

        skuDimensions = skuInfo.dims || [];
        if (skuInfo.prices.length > 0) {
          skuRows = skuInfo.prices.map(p => ({
            specs: {},
            price: p,
            stock: '999',
            image: '',
          }));
        }
      }
    } catch (skuErr) {
      warnings.push(`SKU extraction warning: ${skuErr.message}`);
    }

    logger.info(`SKU: ${skuDimensions.length} dims, ${skuRows.length} rows estimated`);
  } catch (err) {
    warnings.push(`Parse warning: ${err.message}`);
  }

  return { title, mainImages, detailImages, skuDimensions, skuRows, warnings };
}

module.exports = { parseProductInfo };
