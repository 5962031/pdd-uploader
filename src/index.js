/**
 * pdd-uploader — V1.1 多商品草稿模式
 */
require('dotenv').config({ path: '.env.local' });

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./helpers/logger');
const { takeScreenshot } = require('./helpers/screenshot');
const { launchBrowser } = require('./browser/launcher');
const { restoreSession, saveSession, waitForLogin } = require('./browser/session');
const { readWorkbook } = require('./data/excel-reader');
const { mapProduct } = require('./data/product-mapper');
const { validateProduct } = require('./data/validator');
const { applyTemplate } = require('./data/template-loader');
const { resolveCategoryPath } = require('./data/category-map');
const { selectCategory } = require('./pages/category-page');
const { fillBasicInfo } = require('./actions/fill-basic-info');
const { fillAttributes } = require('./actions/fill-attributes');
const { fillSpecifications } = require('./actions/fill-specs');
const { fillSkuTable } = require('./actions/fill-sku-table');
const { stopBeforePublish } = require('./pages/submit-guard');

// ═══════════════════════════════════════════════
// CLI 参数
// ═══════════════════════════════════════════════
function parseArgs() {
  const a = process.argv.slice(2);
  return {
    publish: a.includes('--publish'),
    verbose: a.includes('--verbose'),
    productId: a.find(x => x.startsWith('--product='))?.split('=')[1] || null,
    skipLogin: a.includes('--skip-login'),
    batch: a.includes('--batch'),
    batchDraft: a.includes('--batch-draft'),
    dryRun: a.includes('--dry-run'),
    only: a.find(x => x.startsWith('--only='))?.split('=')[1]?.split(',').map(s => s.trim()) || null,
    from: a.find(x => x.startsWith('--from='))?.split('=')[1]?.trim() || null,
    importUrl: a.find(x => x.startsWith('--import-url='))?.split('=').slice(1).join('=') || null,
  };
}

// ═══════════════════════════════════════════════
// 商品映射辅助
// ═══════════════════════════════════════════════
function mapWithTemplate(raw, workbook) {
  const pid = String(raw.product_id || '').trim();
  const tmpl = applyTemplate(raw, workbook.attributes.filter(a =>
    String(a.product_id || '').trim() === pid
  ));
  const attrs = tmpl.attributes.map(a => ({
    product_id: pid, '属性名': a.name, '属性值': a.value,
  }));
  const rawCat = { ...raw, category_path: raw.category_path || tmpl.categoryPath };
  return { product: mapProduct(rawCat, attrs, workbook.sku), templateInfo: tmpl };
}

function filterProducts(products, args) {
  let list = [...products];

  // --from: 从指定 product_id 开始
  if (args.from) {
    const idx = list.findIndex(r => String(r.product_id || '').trim() === args.from);
    if (idx >= 0) list = list.slice(idx);
  }

  // --only: 只处理指定 product_id
  if (args.only) {
    list = list.filter(r => args.only.includes(String(r.product_id || '').trim()));
  }

  return list;
}

// ═══════════════════════════════════════════════
// 单个商品处理
// ═══════════════════════════════════════════════
async function processOneProduct(page, product, args) {
  const v = validateProduct(product);
  if (!v.valid) {
    logger.error(`"${product.productId}" has ${v.errors.length} error(s):`);
    v.errors.forEach(e => logger.error(`  ❌ [${e.field}] ${e.message}`));
    if (args.dryRun) return { status: 'validation_failed', errors: v.errors };
    throw new Error(v.errors.map(e => e.message).join('; '));
  }
  if (v.warnings.length > 0) logger.warn(`${v.warnings.length} warning(s)`);

  if (args.dryRun) return { status: 'dry_run_ok' };

  const catPath = resolveCategoryPath(product);
  const formPage = await selectCategory(page.context(), page, catPath);
  await fillBasicInfo(formPage, product);
  await fillAttributes(formPage, product);
  await fillSpecifications(formPage, product);
  await fillSkuTable(formPage, product);
  return stopBeforePublish(formPage, args.publish);
}

// ═══════════════════════════════════════════════
// 批量草稿模式
// ═══════════════════════════════════════════════
async function batchDraftMode(page, workbook, args) {
  const allProducts = filterProducts(workbook.products, args);
  logger.info(`\n=== BATCH DRAFT: ${allProducts.length} product(s) ===\n`);

  const results = [];
  const batchReports = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < allProducts.length; i++) {
    const raw = allProducts[i];
    const pid = String(raw.product_id || '').trim();
    const startedAt = new Date();

    logger.info(`\n${'═'.repeat(50)}`);
    logger.info(`[${i + 1}/${allProducts.length}] ${pid}`);
    logger.info(`${'═'.repeat(50)}`);

    let status = 'failed';
    let error = '';
    const screenshots = [];
    let assetRoot = pid; // fallback

    try {
      const { product, templateInfo } = mapWithTemplate(raw, workbook);
      assetRoot = product.resolvedAssetName || pid;
      logger.info(`  Title: ${product.title.substring(0, 50)}`);
      logger.info(`  Template: ${templateInfo.templateName} | Category: ${product.categoryPath}`);
      logger.info(`  Asset root: ${assetRoot}`);

      // 每个商品重新从发布入口开始（不复用表单页状态）
      const result = await processOneProduct(page, product, { ...args, dryRun: false });

      status = result?.status || 'success';
      if (status === 'filled_not_published' || status === 'success') {
        successCount++;
        status = 'success';
      }
    } catch (err) {
      failCount++;
      status = 'failed';
      error = err.message;
      logger.error(`  ❌ ${pid} FAILED: ${err.message}`);
      try { await takeScreenshot(page, `batch_error_${pid}`); } catch {}
    }

    const finishedAt = new Date();
    const duration = ((finishedAt - startedAt) / 1000).toFixed(1);

    results.push({ productId: pid, status, error });
    batchReports.push({
      product_id: pid,
      title: String(raw.title || '').substring(0, 60),
      template_id: String(raw.template_id || 'generic'),
      asset_dir: String(raw.asset_dir || ''),
      asset_root: assetRoot,
      status,
      error,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_seconds: parseFloat(duration),
      screenshots,
    });

    // 进度打印
    const icon = status === 'success' ? '✅' : '❌';
    logger.info(`  ${icon} ${pid}: ${status} (${duration}s)`);

    // 最后一个不等待
    if (i < allProducts.length - 1) {
      const answer = await waitForEnter(`\n按 Enter 继续下一个，输入 q 退出: `);
      if (answer === 'q') { logger.info('User quit'); break; }
    }
  }

  // ---- 报告 ----
  const reportPath = saveBatchReport(batchReports);

  logger.info('\n╔══════════════════════════════╗');
  logger.info('║     Batch Draft Report       ║');
  logger.info('╚══════════════════════════════╝');
  logger.info(`  Total: ${results.length}`);
  logger.info(`  Success: ${successCount}`);
  logger.info(`  Failed: ${failCount}`);
  logger.info(`  Report: ${reportPath}`);
  results.forEach(r => {
    logger.info(`  ${r.status === 'success' ? '✅' : '❌'} ${r.productId} ${r.status}${r.error ? ' — ' + r.error : ''}`);
  });

  return results;
}

// ═══════════════════════════════════════════════
// 批量报告
// ═══════════════════════════════════════════════
function saveBatchReport(reports) {
  const logsDir = path.join(config.paths.root, 'pdd-uploader', 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filePath = path.join(logsDir, `batch-report-${ts}.json`);
  fs.writeFileSync(filePath, JSON.stringify(reports, null, 2));
  return filePath;
}

// ═══════════════════════════════════════════════
// Dry-run 增强
// ═══════════════════════════════════════════════
function dryRunAll(workbook, args) {
  const list = filterProducts(workbook.products, args);
  logger.info(`\n=== DRY RUN: ${list.length} product(s) ===\n`);

  list.forEach((raw, i) => {
    const pid = String(raw.product_id || '').trim();
    const { product, templateInfo } = mapWithTemplate(raw, workbook);

    const v = validateProduct(product);
    const icon = v.valid ? '✅' : '❌';
    const previewCount = product.skuRows.filter(r => r.previewImage && fs.existsSync(r.previewImage)).length;
    const previewOk = previewCount === product.skuRows.length;

    logger.info(`${icon} [${i + 1}] ${product.productId}`);
    logger.info(`    template: ${templateInfo.templateName} (${templateInfo.templateId})`);
    logger.info(`    asset_dir: ${product.assetDir || '(none)'} → ${product.resolvedAssetName}`);
    logger.info(`    category: ${product.categoryPath}`);
    logger.info(`    main: ${product.mainImages.length} | detail: ${product.detailImage ? '✓' : '✗'} | attrs: ${product.attributes.length} | SKU: ${product.skuRows.length} rows`);
    logger.info(`    SKU previews: ${previewCount}/${product.skuRows.length} ${previewOk ? '✓' : '⚠️'}`);

    v.errors.forEach(e => logger.error(`    ❌ ${e.field}: ${e.message}`));
    v.warnings.forEach(w => logger.warn(`    ⚠️ ${w.field}: ${w.message}`));
  });
}

// ═══════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════
function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt || '\n按 Enter 继续: ', answer => { rl.close(); resolve(answer.trim().toLowerCase()); }));
}

// ═══════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════
async function main() {
  const args = parseArgs();

  logger.info('╔═════════════════════════════════╗');
  logger.info('║  PDD Uploader v1.1.0          ║');
  logger.info('╚═════════════════════════════════╝');

  // ---- 导入模式（不读 Excel） ----
  if (args.importUrl) {
    const { importProduct } = require('./importer/import-url');
    const report = await importProduct(args.importUrl);
    logger.info(`Import ${report.status}: ${report.import_id}`);
    return;
  }

  const workbook = readWorkbook(config.paths.excel);
  if (workbook.products.length === 0) throw new Error('No products in Excel');

  logger.info(`Products: ${workbook.products.length} | Attrs: ${workbook.attributes.length} | SKU: ${workbook.sku.length}`);

  // ---- Dry-run ----
  if (args.dryRun) {
    dryRunAll(workbook, args);
    return;
  }

  // ---- 浏览器 + 登录 ----
  const { browser, context, page } = await launchBrowser();
  const sessionOk = await restoreSession(context, page);
  if (!sessionOk) { await waitForLogin(page); await saveSession(context); }

  // ---- 批量草稿 ----
  if (args.batchDraft || args.batch) {
    await batchDraftMode(page, workbook, args);
  } else if (args.productId) {
    const raw = workbook.products.find(r =>
      Object.values(r).some(v => String(v).includes(args.productId)));
    if (!raw) throw new Error(`"${args.productId}" not found`);
    const { product } = mapWithTemplate(raw, workbook);
    await processOneProduct(page, product, args);
  } else {
    // 默认：第一个商品
    const { product } = mapWithTemplate(workbook.products[0], workbook);
    logger.info(`Using first: ${product.productId}`);
    await processOneProduct(page, product, args);
  }

  logger.info('\nDone. Browser stays open.');
}

main().catch(err => { logger.error(`FATAL: ${err.message}`); logger.error(err.stack); process.exit(1); });
