const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const asyncHandler = require('express-async-handler');
const { protectDescope, protectSubscription } = require('../middlewares/authMiddleware');

// All vendor routes require valid login AND active business subscription
router.use(protectDescope);
router.use(protectSubscription);

// ────────────────────────────────────────────────────────────────────────────
//  VENDORS PROFILE CRUD
// ────────────────────────────────────────────────────────────────────────────

// @desc    Get all vendors for current business
// @route   GET /api/vendors
router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.business.id;
  const snap = await db.collection('vendors').where('businessId', '==', businessId).get();

  const vendors = [];
  snap.forEach(doc => vendors.push({ id: doc.id, ...doc.data() }));

  // Sort alphabetically
  vendors.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  res.status(200).json({ success: true, vendors });
}));

// @desc    Add a new vendor
// @route   POST /api/vendors
router.post('/', asyncHandler(async (req, res) => {
  const { name, mobile, address, gstNumber } = req.body;
  const businessId = req.business.id;

  if (!name || !mobile) {
    res.status(400);
    throw new Error('Vendor name and mobile number are required');
  }

  const newVendor = {
    businessId,
    name: name.trim(),
    mobile: mobile.trim(),
    address: (address || '').trim(),
    gstNumber: (gstNumber || '').toUpperCase().trim(),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const docRef = await db.collection('vendors').add(newVendor);
  const saved = await docRef.get();

  res.status(201).json({
    success: true,
    vendor: { id: docRef.id, ...saved.data() }
  });
}));

// @desc    Update a vendor details
// @route   PUT /api/vendors/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.business.id;
  const { name, mobile, address, gstNumber } = req.body;

  const ref = db.collection('vendors').doc(id);
  const doc = await ref.get();

  if (!doc.exists || doc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Vendor not found or access denied');
  }

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (mobile !== undefined) updates.mobile = mobile.trim();
  if (address !== undefined) updates.address = address.trim();
  if (gstNumber !== undefined) updates.gstNumber = gstNumber.toUpperCase().trim();

  await ref.update(updates);
  const updated = await ref.get();

  res.status(200).json({
    success: true,
    vendor: { id, ...updated.data() }
  });
}));

// @desc    Delete a vendor
// @route   DELETE /api/vendors/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.business.id;

  const ref = db.collection('vendors').doc(id);
  const doc = await ref.get();

  if (!doc.exists || doc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Vendor not found or access denied');
  }

  await ref.delete();

  res.status(200).json({
    success: true,
    message: 'Vendor deleted successfully'
  });
}));

// ────────────────────────────────────────────────────────────────────────────
//  PURCHASE ORDERS CRUD
// ────────────────────────────────────────────────────────────────────────────

// @desc    Get all purchase orders
// @route   GET /api/vendors/orders
router.get('/orders', asyncHandler(async (req, res) => {
  const businessId = req.business.id;
  const snap = await db.collection('purchase_orders').where('businessId', '==', businessId).get();

  const orders = [];
  snap.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));

  // Sort by createdAt descending
  orders.sort((a, b) => {
    const timeA = a.createdAt ? (a.createdAt._seconds ? a.createdAt._seconds * 1000 : new Date(a.createdAt).getTime()) : 0;
    const timeB = b.createdAt ? (b.createdAt._seconds ? b.createdAt._seconds * 1000 : new Date(b.createdAt).getTime()) : 0;
    return timeB - timeA;
  });

  res.status(200).json({ success: true, orders });
}));

// @desc    Create a new purchase order
// @route   POST /api/vendors/orders
router.post('/orders', asyncHandler(async (req, res) => {
  const { vendorId, items } = req.body;
  const businessId = req.business.id;

  if (!vendorId || !items || !Array.isArray(items) || items.length === 0) {
    res.status(400);
    throw new Error('Please select a vendor and at least one item');
  }

  // 1. Resolve vendor details
  const vendorDoc = await db.collection('vendors').doc(vendorId).get();
  if (!vendorDoc.exists || vendorDoc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Vendor not found or access denied');
  }
  const vendorData = vendorDoc.data();

  // 2. Format items list
  const formattedItems = [];
  for (const it of items) {
    if (!it.productId || !it.quantity || it.quantity <= 0) {
      res.status(400);
      throw new Error('Invalid item parameters');
    }
    const prodDoc = await db.collection('products').doc(it.productId).get();
    if (!prodDoc.exists || prodDoc.data().businessId !== businessId) {
      res.status(404);
      throw new Error(`Product ${it.name || it.productId} not found in inventory`);
    }
    const prodData = prodDoc.data();
    formattedItems.push({
      productId: it.productId,
      name: prodData.name,
      shortCode: prodData.shortCode || '',
      price: Number(prodData.price || 0),
      quantity: Number(it.quantity),
      received: false
    });
  }

  // 3. Generate PO Number
  const shortTimestamp = Date.now().toString().slice(-6);
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const orderNumber = `PO-${shortTimestamp}-${randomSuffix}`;

  const newOrder = {
    orderNumber,
    businessId,
    vendorId,
    vendorName: vendorData.name,
    vendorMobile: vendorData.mobile || '',
    vendorAddress: vendorData.address || '',
    vendorGst: vendorData.gstNumber || '',
    items: formattedItems,
    status: 'Created',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const docRef = await db.collection('purchase_orders').add(newOrder);
  const saved = await docRef.get();

  res.status(201).json({
    success: true,
    order: { id: docRef.id, ...saved.data() }
  });
}));

// @desc    Update an existing purchase order
// @route   PUT /api/vendors/orders/:id
router.put('/orders/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.business.id;
  const { vendorId, items, status } = req.body;

  const ref = db.collection('purchase_orders').doc(id);
  const doc = await ref.get();

  if (!doc.exists || doc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Purchase order not found or access denied');
  }

  const updates = {};
  if (status !== undefined) updates.status = status;

  if (vendorId !== undefined) {
    const vendorDoc = await db.collection('vendors').doc(vendorId).get();
    if (!vendorDoc.exists || vendorDoc.data().businessId !== businessId) {
      res.status(404);
      throw new Error('Vendor not found or access denied');
    }
    const vendorData = vendorDoc.data();
    updates.vendorId = vendorId;
    updates.vendorName = vendorData.name;
    updates.vendorMobile = vendorData.mobile || '';
    updates.vendorAddress = vendorData.address || '';
    updates.vendorGst = vendorData.gstNumber || '';
  }

  if (items !== undefined && Array.isArray(items)) {
    if (items.length === 0) {
      res.status(400);
      throw new Error('An order must contain at least one item');
    }
    const formattedItems = [];
    for (const it of items) {
      const prodDoc = await db.collection('products').doc(it.productId).get();
      if (!prodDoc.exists || prodDoc.data().businessId !== businessId) {
        res.status(404);
        throw new Error(`Product ${it.name || it.productId} not found in inventory`);
      }
      const prodData = prodDoc.data();
      formattedItems.push({
        productId: it.productId,
        name: prodData.name,
        shortCode: prodData.shortCode || '',
        price: Number(prodData.price || 0),
        quantity: Number(it.quantity),
        received: it.received || false
      });
    }
    updates.items = formattedItems;
  }

  await ref.update(updates);
  const updated = await ref.get();

  res.status(200).json({
    success: true,
    order: { id, ...updated.data() }
  });
}));

// @desc    Delete a purchase order
// @route   DELETE /api/vendors/orders/:id
router.delete('/orders/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.business.id;

  const ref = db.collection('purchase_orders').doc(id);
  const doc = await ref.get();

  if (!doc.exists || doc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Purchase order not found or access denied');
  }

  await ref.delete();

  res.status(200).json({
    success: true,
    message: 'Purchase order deleted successfully'
  });
}));

// @desc    Receive a specific item from a purchase order and add to stock
// @route   POST /api/vendors/orders/:orderId/items/:productId/receive
router.post('/orders/:orderId/items/:productId/receive', asyncHandler(async (req, res) => {
  const { orderId, productId } = req.params;
  const businessId = req.business.id;

  const orderRef = db.collection('purchase_orders').doc(orderId);
  const productRef = db.collection('products').doc(productId);

  await db.runTransaction(async (transaction) => {
    const orderDoc = await transaction.get(orderRef);
    if (!orderDoc.exists || orderDoc.data().businessId !== businessId) {
      throw new Error('Purchase order not found or access denied');
    }

    const orderData = orderDoc.data();
    const items = orderData.items || [];
    const itemIndex = items.findIndex(it => it.productId === productId);

    if (itemIndex === -1) {
      throw new Error('Item not found in this purchase order');
    }

    const item = items[itemIndex];
    if (item.received) {
      throw new Error('This item has already been marked as received');
    }

    const productDoc = await transaction.get(productRef);
    if (!productDoc.exists || productDoc.data().businessId !== businessId) {
      throw new Error('Product not found in inventory');
    }

    const currentStock = Number(productDoc.data().stock || 0);
    const addedQty = Number(item.quantity || 0);
    const newStock = currentStock + addedQty;

    // Update product stock
    transaction.update(productRef, { stock: newStock });

    // Update item received status
    item.received = true;
    item.receivedAt = admin.firestore.Timestamp.now();
    
    // Check if all items in this order are now received
    const allReceived = items.every(it => it.received === true);
    const status = allReceived ? 'Received' : 'Partially Received';

    transaction.update(orderRef, { items, status });
  });

  const updatedOrder = await orderRef.get();
  res.status(200).json({
    success: true,
    message: 'Item received and stock updated successfully',
    order: { id: orderId, ...updatedOrder.data() }
  });
}));

module.exports = router;
