/**
 * 创建 products.xlsx 模板（3个工作表）
 */
const XLSX = require('xlsx');
const path = require('path');

const wb = XLSX.utils.book_new();

// ============================================================
// Sheet 1: products（商品基础信息，竖排字段/值格式）
// ============================================================
const productsData = [
  { '字段': 'product_id', '示例': 'label_001' },
  { '字段': 'title', '示例': '分类贴商品贴不干胶标签贴自粘贴便利贴姓名贴办公用品贴手写贴纸' },
  { '字段': 'category_path', '示例': '数码电器>文具电教/文化用品/商务用品>纸张本册>不干胶标签' },
  { '字段': 'main_images', '示例': 'assets/label_001/main1.png;assets/label_001/main2.png;assets/label_001/main3.png' },
  { '字段': 'detail_image', '示例': 'assets/label_001/detail.jpg' },
  { '字段': 'freight_template', '示例': '默认模板' },
];
const ws1 = XLSX.utils.json_to_sheet(productsData);
ws1['!cols'] = [{ wch: 20 }, { wch: 80 }];
XLSX.utils.book_append_sheet(wb, ws1, 'products');

// ============================================================
// Sheet 2: attributes（商品属性）
// ============================================================
const attrsData = [
  { 'product_id': 'label_001', '属性名': '品牌', '属性值': '无品牌' },
  { 'product_id': 'label_001', '属性名': '是否支持定制', '属性值': '是' },
  { 'product_id': 'label_001', '属性名': '产地', '属性值': '河南省' },
  { 'product_id': 'label_001', '属性名': '纸张类型', '属性值': '铜版纸' },
  { 'product_id': 'label_001', '属性名': '形状', '属性值': '矩形' },
  { 'product_id': 'label_001', '属性名': '包装方式', '属性值': '袋装' },
];
const ws2 = XLSX.utils.json_to_sheet(attrsData);
ws2['!cols'] = [{ wch: 15 }, { wch: 20 }, { wch: 20 }];
XLSX.utils.book_append_sheet(wb, ws2, 'attributes');

// ============================================================
// Sheet 3: sku（SKU 价格库存）
// ============================================================
const skuData = [
  { 'product_id': 'label_001', '款式': '红蓝双色混装', '容量': '整包50张--1200贴', '库存': 999, '拼单价': 9.90, '单买价': 10.90, '规格编码': 'label_mix_50', 'SKU预览图': 'mix.png' },
  { 'product_id': 'label_001', '款式': '红蓝双色混装', '容量': '散装20张--480贴', '库存': 999, '拼单价': 5.90, '单买价': 6.90, '规格编码': 'label_mix_20', 'SKU预览图': 'mix.png' },
  { 'product_id': 'label_001', '款式': '红蓝双色混装', '容量': '100张--2400贴', '库存': 999, '拼单价': 16.90, '单买价': 17.90, '规格编码': 'label_mix_100', 'SKU预览图': 'mix.png' },
  { 'product_id': 'label_001', '款式': '红色', '容量': '整包50张--1200贴', '库存': 999, '拼单价': 9.90, '单买价': 10.90, '规格编码': 'label_red_50', 'SKU预览图': 'red.png' },
  { 'product_id': 'label_001', '款式': '红色', '容量': '散装20张--480贴', '库存': 999, '拼单价': 5.90, '单买价': 6.90, '规格编码': 'label_red_20', 'SKU预览图': 'red.png' },
  { 'product_id': 'label_001', '款式': '红色', '容量': '100张--2400贴', '库存': 999, '拼单价': 16.90, '单买价': 17.90, '规格编码': 'label_red_100', 'SKU预览图': 'red.png' },
  { 'product_id': 'label_001', '款式': '蓝色', '容量': '整包50张--1200贴', '库存': 999, '拼单价': 9.90, '单买价': 10.90, '规格编码': 'label_blue_50', 'SKU预览图': 'blue.png' },
  { 'product_id': 'label_001', '款式': '蓝色', '容量': '散装20张--480贴', '库存': 999, '拼单价': 5.90, '单买价': 6.90, '规格编码': 'label_blue_20', 'SKU预览图': 'blue.png' },
  { 'product_id': 'label_001', '款式': '蓝色', '容量': '100张--2400贴', '库存': 999, '拼单价': 16.90, '单买价': 17.90, '规格编码': 'label_blue_100', 'SKU预览图': 'blue.png' },
];
const ws3 = XLSX.utils.json_to_sheet(skuData);
ws3['!cols'] = [{ wch: 15 }, { wch: 18 }, { wch: 22 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 12 }];
XLSX.utils.book_append_sheet(wb, ws3, 'sku');

// 写入文件
const outPath = path.join(__dirname, '..', '..', '资料表', 'products.xlsx');
XLSX.writeFile(wb, outPath);
console.log('Template written to:', outPath);
console.log(`  products: ${productsData.length} fields`);
console.log(`  attributes: ${attrsData.length} rows`);
console.log(`  sku: ${skuData.length} rows`);
