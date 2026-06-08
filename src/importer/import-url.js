/**
 * 商品链接导入采集器 — 打开链接 → 采集信息 → 下载图片 → 保存 raw.json
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../helpers/logger');
const { launchBrowser } = require('../browser/launcher');
const { restoreSession, waitForLogin, saveSession } = require('../browser/session');
const { fetchProductPage } = require('./fetch-product-page');
const { parseProductInfo } = require('./parse-product-info');
const { downloadAssets } = require('./download-assets');

/**
 * 生成导入ID
 */
function nextImportId() {
  const importsDir = path.join(config.paths.root, 'pdd-uploader', 'imports');
  if (!fs.existsSync(importsDir)) fs.mkdirSync(importsDir, { recursive: true });
  const existing = fs.readdirSync(importsDir).filter(d => /^import_\d+$/.test(d));
  if (existing.length === 0) return 'import_001';
  const nums = existing.map(d => parseInt(d.replace('import_', ''))).sort((a, b) => b - a);
  return `import_${String(nums[0] + 1).padStart(3, '0')}`;
}

/**
 * 主入口
 * @param {string} productUrl - 商品链接
 */
async function importProduct(productUrl) {
  const importId = nextImportId();
  logger.info(`\n╔═══════════════════════════════╗`);
  logger.info(`║  Import: ${importId}     ║`);
  logger.info(`║  ${productUrl.substring(0, 40)}...`);
  logger.info(`╚═══════════════════════════════╝\n`);

  // 目录
  const importsDir = path.join(config.paths.root, 'pdd-uploader', 'imports', importId);
  const assetsDir = path.join(config.paths.assets, importId);
  fs.mkdirSync(importsDir, { recursive: true });
  fs.mkdirSync(path.join(assetsDir, '主图'), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, '详情图'), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, 'SKU图'), { recursive: true });

  const report = {
    import_id: importId,
    source_url: productUrl,
    started_at: new Date().toISOString(),
    status: 'started',
    title: '',
    main_images: 0,
    detail_images: 0,
    sku_dimensions: [],
    sku_rows: 0,
    warnings: [],
    errors: [],
  };

  const { browser, context, page } = await launchBrowser();
  const sessionOk = await restoreSession(context, page);
  if (!sessionOk) { await waitForLogin(page); await saveSession(context); }

  let parsed = null;
  let dlResult = { main: 0, detail: 0, sku: 0 };

  try {
    // 1. 打开商品页
    const fetchResult = await fetchProductPage(page, productUrl, importId);
    if (!fetchResult.ok) throw new Error(fetchResult.error || 'Failed to load product page');
    report.title = fetchResult.title || '';
    logger.info(`Title: ${fetchResult.title}`);

    // 2. 解析商品信息
    parsed = await parseProductInfo(page);
    report.title = parsed.title || report.title;
    report.main_images = (parsed.mainImages || []).length;
    report.detail_images = (parsed.detailImages || []).length;
    report.sku_dimensions = parsed.skuDimensions || [];
    report.sku_rows = (parsed.skuRows || []).length;
    report.warnings = (parsed.warnings || []).slice();

    // 3. 保存 raw.json
    const rawData = {
      source_url: productUrl,
      title: parsed.title || '',
      main_images: parsed.mainImages || [],
      detail_images: parsed.detailImages || [],
      sku_dimensions: parsed.skuDimensions || [],
      sku_rows: parsed.skuRows || [],
      warnings: parsed.warnings || [],
    };
    fs.writeFileSync(path.join(importsDir, 'raw.json'), JSON.stringify(rawData, null, 2));
    logger.info(`raw.json saved`);

    // 安全 fallback
    const safeParsed = {
      mainImages: parsed?.mainImages || [],
      detailImages: parsed?.detailImages || [],
      title: parsed?.title || '',
      skuDimensions: parsed?.skuDimensions || [],
      skuRows: parsed?.skuRows || [],
    };

    // 4. 下载图片
    dlResult = await downloadAssets(safeParsed, assetsDir);
    report.main_images_downloaded = dlResult.main;
    report.detail_images_downloaded = dlResult.detail;
    report.sku_images_downloaded = dlResult.sku;

    // 5. 生成 manifest
    fs.writeFileSync(path.join(assetsDir, 'manifest.json'), JSON.stringify({
      import_id: importId, source_url: productUrl, title: safeParsed.title,
      main_images: dlResult.main, detail_images: dlResult.detail, assets_dir: assetsDir,
    }, null, 2));

    // 6. summary
    report.status = 'success';
    report.finished_at = new Date().toISOString();
    const warnList = report.warnings || [];
    if (!safeParsed.title) warnList.push('TITLE_NOT_FOUND');
    if (safeParsed.detailImages.length === 0) warnList.push('DETAIL_IMAGES_NOT_FOUND');
    if (safeParsed.skuRows.length === 0) warnList.push('SKU_NOT_FOUND');
    report.warnings = warnList;

    logger.info(`\n✓ Import complete: ${importId}`);
    logger.info(`  Title: ${safeParsed.title || '(empty)'}`);
    logger.info(`  Main: ${dlResult.main} images`);
    logger.info(`  Detail: ${dlResult.detail} images`);
    logger.info(`  SKU dims: ${safeParsed.skuDimensions.length}, rows: ${safeParsed.skuRows.length}`);
    if (warnList.length > 0) logger.info(`  Warnings: ${warnList.join(', ')}`);
    logger.info(`  Assets: ${assetsDir}`);
    logger.info(`  Raw: ${importsDir}/raw.json`);

  } catch (err) {
    report.status = 'failed';
    report.errors.push(err.message);
    logger.error(`Import failed: ${err.message}`);
  }

  report.warnings = [...(report.warnings || []), ...(parsed?.warnings || [])];
  fs.writeFileSync(path.join(importsDir, 'report.json'), JSON.stringify(report, null, 2));

  return report;
}

module.exports = { importProduct };
