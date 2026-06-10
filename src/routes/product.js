const express = require('express');
const router  = express.Router();
const { db, admin } = require('../config/firebase');
const asyncHandler  = require('express-async-handler');
const { protectDescope, protectSubscription } = require('../middlewares/authMiddleware');

// All product routes require valid login AND active business subscription
router.use(protectDescope);
router.use(protectSubscription);

// GET /api/products — list all products for current business
router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.business.id;
  const snap = await db.collection('products').where('businessId', '==', businessId).get();

  const products = [];
  snap.forEach(doc => products.push({ id: doc.id, ...doc.data() }));

  // Sort alphabetically in-memory (no composite index needed)
  products.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  res.json({ success: true, products });
}));

// POST /api/products — create a new product item
router.post('/', asyncHandler(async (req, res) => {
  const {
    name, shortCode, price, gstRate, stock, bufferStock,
    categoryId, categoryName,
    barcode,          // unique barcode string
    imageUrl,         // ImageKit CDN URL
    barcodeImageUrl   // ImageKit CDN URL for barcode image
  } = req.body;

  const businessId = req.business.id;

  if (!name || price === undefined) {
    res.status(400);
    throw new Error('Product name and price are required');
  }

  // Prevent duplicate barcode within the same business
  if (barcode) {
    const dupSnap = await db.collection('products')
      .where('businessId', '==', businessId)
      .where('barcode', '==', barcode)
      .get();
    if (!dupSnap.empty) {
      res.status(409);
      throw new Error('A product with this barcode already exists in this business');
    }
  }

  const newProduct = {
    businessId,
    name:            name.trim(),
    shortCode:       (shortCode || '').toUpperCase().trim(),
    price:           Number(price),
    gstRate:         Number(gstRate || 0),
    stock:           Number(stock || 0),
    bufferStock:     Number(bufferStock || 0),
    categoryId:      categoryId  || '',
    categoryName:    categoryName || 'Uncategorised',
    barcode:         barcode       || '',
    imageUrl:        imageUrl      || '',
    barcodeImageUrl: barcodeImageUrl || '',
    createdAt:       admin.firestore.FieldValue.serverTimestamp()
  };

  const docRef = await db.collection('products').add(newProduct);
  const saved  = await docRef.get();

  res.status(201).json({
    success: true,
    product: { id: docRef.id, ...saved.data(), createdAt: new Date() }
  });
}));

// PUT /api/products/:id — update an existing product
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.business.id;

  const ref = db.collection('products').doc(id);
  const doc = await ref.get();

  if (!doc.exists || doc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Product not found or access denied');
  }

  const {
    name, shortCode, price, gstRate, stock, bufferStock,
    categoryId, categoryName, imageUrl
  } = req.body;

  const updates = {};
  if (name       !== undefined) updates.name         = name.trim();
  if (shortCode  !== undefined) updates.shortCode    = shortCode.toUpperCase().trim();
  if (price      !== undefined) updates.price        = Number(price);
  if (gstRate    !== undefined) updates.gstRate      = Number(gstRate);
  if (stock      !== undefined) updates.stock        = Number(stock);
  if (bufferStock!== undefined) updates.bufferStock  = Number(bufferStock);
  if (categoryId !== undefined) updates.categoryId   = categoryId;
  if (categoryName!== undefined)updates.categoryName = categoryName;
  if (imageUrl   !== undefined) updates.imageUrl     = imageUrl;

  await ref.update(updates);
  const updated = await ref.get();

  res.json({ success: true, product: { id, ...updated.data() } });
}));

// DELETE /api/products/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.business.id;

  const ref = db.collection('products').doc(id);
  const doc = await ref.get();

  if (!doc.exists || doc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Product not found or access denied');
  }

  await ref.delete();
  res.json({ success: true, message: 'Product deleted successfully' });
}));

module.exports = router;
