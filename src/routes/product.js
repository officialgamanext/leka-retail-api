const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const asyncHandler = require('express-async-handler');
const { protectDescope, protectSubscription } = require('../middlewares/authMiddleware');

// All product routes require valid login AND active business subscription
router.use(protectDescope);
router.use(protectSubscription);

// @desc    Get all products for current business
// @route   GET /api/products
// @access  Private
router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.business.id;

  const snapshot = await db.collection('products')
    .where('businessId', '==', businessId)
    .orderBy('name', 'asc')
    .get();

  const products = [];
  snapshot.forEach(doc => {
    products.push({
      id: doc.id,
      ...doc.data()
    });
  });

  res.status(200).json({
    success: true,
    products
  });
}));

// @desc    Add a product to current business inventory
// @route   POST /api/products
// @access  Private
router.post('/', asyncHandler(async (req, res) => {
  const { name, sku, price, gstRate, stock } = req.body;
  const businessId = req.business.id;

  if (!name || price === undefined || gstRate === undefined || stock === undefined) {
    res.status(400);
    throw new Error('Please fill in all required fields (name, price, gstRate, stock)');
  }

  const newProduct = {
    name,
    sku: sku || '',
    price: Number(price),
    gstRate: Number(gstRate),
    stock: Number(stock),
    businessId,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const docRef = await db.collection('products').add(newProduct);
  const savedDoc = await docRef.get();

  res.status(201).json({
    success: true,
    product: {
      id: docRef.id,
      ...savedDoc.data()
    }
  });
}));

// @desc    Update a product in inventory
// @route   PUT /api/products/:id
// @access  Private
router.put('/:id', asyncHandler(async (req, res) => {
  const productId = req.params.id;
  const businessId = req.business.id;
  const { name, sku, price, gstRate, stock } = req.body;

  const productDocRef = db.collection('products').doc(productId);
  const productDoc = await productDocRef.get();

  if (!productDoc.exists) {
    res.status(404);
    throw new Error('Product not found');
  }

  if (productDoc.data().businessId !== businessId) {
    res.status(403);
    throw new Error('Access Denied: Product does not belong to this business');
  }

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (sku !== undefined) updates.sku = sku;
  if (price !== undefined) updates.price = Number(price);
  if (gstRate !== undefined) updates.gstRate = Number(gstRate);
  if (stock !== undefined) updates.stock = Number(stock);

  await productDocRef.update(updates);
  const updatedDoc = await productDocRef.get();

  res.status(200).json({
    success: true,
    product: {
      id: productId,
      ...updatedDoc.data()
    }
  });
}));

// @desc    Delete a product from inventory
// @route   DELETE /api/products/:id
// @access  Private
router.delete('/:id', asyncHandler(async (req, res) => {
  const productId = req.params.id;
  const businessId = req.business.id;

  const productDocRef = db.collection('products').doc(productId);
  const productDoc = await productDocRef.get();

  if (!productDoc.exists) {
    res.status(404);
    throw new Error('Product not found');
  }

  if (productDoc.data().businessId !== businessId) {
    res.status(403);
    throw new Error('Access Denied: Product does not belong to this business');
  }

  await productDocRef.delete();

  res.status(200).json({
    success: true,
    message: 'Product deleted successfully'
  });
}));

module.exports = router;
