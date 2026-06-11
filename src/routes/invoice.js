const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const asyncHandler = require('express-async-handler');
const { protectDescope, protectSubscription } = require('../middlewares/authMiddleware');

// All invoice routes require valid login AND active business subscription
router.use(protectDescope);
router.use(protectSubscription);

// @desc    Get all invoices for current business
// @route   GET /api/invoices
// @access  Private
router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.business.id;

  const snapshot = await db.collection('invoices')
    .where('businessId', '==', businessId)
    .get();

  const invoices = [];
  snapshot.forEach(doc => {
    invoices.push({
      id: doc.id,
      ...doc.data()
    });
  });

  // Sort in-memory to avoid Firestore composite index requirement
  invoices.sort((a, b) => {
    const timeA = a.createdAt ? (a.createdAt._seconds ? a.createdAt._seconds * 1000 : new Date(a.createdAt).getTime()) : 0;
    const timeB = b.createdAt ? (b.createdAt._seconds ? b.createdAt._seconds * 1000 : new Date(b.createdAt).getTime()) : 0;
    return timeB - timeA; // Descending order
  });

  res.status(200).json({
    success: true,
    invoices
  });
}));

// @desc    Create a new billing invoice and deduct inventory stock
// @route   POST /api/invoices
// @access  Private
router.post('/', asyncHandler(async (req, res) => {
  const { customerName, customerPhone, items, discount, paymentMethod, status } = req.body;
  const businessId = req.business.id;

  if (!items || !Array.isArray(items) || items.length === 0) {
    res.status(400);
    throw new Error('Please select at least one product to check out');
  }

  const finalStatus = status || 'Settled';
  const isSettled = finalStatus === 'Settled';

  // 1. Validate items and compute totals securely using DB data
  let subtotal = 0;
  let taxAmount = 0;
  const validatedItems = [];
  const batch = db.batch();

  for (const item of items) {
    if (!item.productId || !item.quantity || item.quantity <= 0) {
      res.status(400);
      throw new Error('Invalid cart item structure');
    }

    const productDoc = await db.collection('products').doc(item.productId).get();
    if (!productDoc.exists) {
      res.status(404);
      throw new Error(`Product ${item.name || item.productId} not found in inventory`);
    }

    const product = productDoc.data();
    if (product.businessId !== businessId) {
      res.status(403);
      throw new Error(`Access Denied: Product ${product.name} is not in this business catalog`);
    }

    // Check stock if we are settling immediately
    if (isSettled && product.stock < item.quantity) {
      res.status(400);
      throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`);
    }

    const price = Number(product.price);
    const quantity = Number(item.quantity);
    const gstRate = Number(product.gstRate || 0);

    const itemSubtotal = price * quantity;
    const itemGstAmount = (itemSubtotal * gstRate) / 100;
    const itemTotal = itemSubtotal + itemGstAmount;

    validatedItems.push({
      productId: item.productId,
      name: product.name,
      price: price,
      quantity: quantity,
      gstRate: gstRate,
      gstAmount: Number(itemGstAmount.toFixed(2)),
      total: Number(itemTotal.toFixed(2))
    });

    subtotal += itemSubtotal;
    taxAmount += itemGstAmount;

    if (isSettled) {
      // Deduct stock reference in batch
      const productRef = db.collection('products').doc(item.productId);
      batch.update(productRef, {
        stock: admin.firestore.FieldValue.increment(-quantity)
      });
    }
  }

  const discountVal = Number(discount || 0);
  const grandTotal = Math.max(0, subtotal + taxAmount - discountVal);

  // Generate unique invoice number: INV-[Timestamp-short]-[Random-short]
  const shortTimestamp = Date.now().toString().slice(-6);
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const invoiceNumber = `INV-${shortTimestamp}-${randomSuffix}`;

  const newInvoice = {
    invoiceNumber,
    businessId,
    customerName: customerName || 'Walk-in Customer',
    customerPhone: customerPhone || '',
    items: validatedItems,
    subtotal: Number(subtotal.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    discount: discountVal,
    grandTotal: Number(grandTotal.toFixed(2)),
    paymentMethod: paymentMethod || 'Cash',
    status: finalStatus, // 'Open' or 'Settled'
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  // Add invoice to batch
  const invoiceDocRef = db.collection('invoices').doc();
  batch.set(invoiceDocRef, newInvoice);

  // Execute batch write (deduct stock if settled and save invoice atomically)
  await batch.commit();

  // Retrieve saved invoice for response
  const savedDoc = await invoiceDocRef.get();

  res.status(201).json({
    success: true,
    invoice: {
      id: invoiceDocRef.id,
      ...savedDoc.data(),
      // Format timestamps for JSON response immediately
      createdAt: new Date()
    }
  });
}));

// @desc    Settle an existing open invoice
// @route   PUT /api/invoices/:id/settle
// @access  Private
router.put('/:id/settle', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { paymentMethod } = req.body;
  const businessId = req.business.id;

  const ref = db.collection('invoices').doc(id);
  const doc = await ref.get();

  if (!doc.exists || doc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Invoice not found or access denied');
  }

  const invoice = doc.data();
  if (invoice.status === 'Settled') {
    res.status(400);
    throw new Error('This invoice is already settled');
  }

  const items = invoice.items || [];
  const batch = db.batch();

  for (const item of items) {
    if (!item.productId || !item.quantity || item.quantity <= 0) {
      res.status(400);
      throw new Error('Invalid item structure in invoice');
    }

    const productDoc = await db.collection('products').doc(item.productId).get();
    if (!productDoc.exists) {
      res.status(404);
      throw new Error(`Product ${item.name || item.productId} not found in inventory`);
    }

    const product = productDoc.data();
    if (product.businessId !== businessId) {
      res.status(403);
      throw new Error(`Access Denied: Product ${product.name} is not in this business catalog`);
    }

    // Check if sufficient stock is available
    if (product.stock < item.quantity) {
      res.status(400);
      throw new Error(`Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}`);
    }

    const productRef = db.collection('products').doc(item.productId);
    batch.update(productRef, {
      stock: admin.firestore.FieldValue.increment(-Number(item.quantity))
    });
  }

  const updates = {
    status: 'Settled',
    paymentMethod: paymentMethod || 'Cash',
    settledAt: admin.firestore.FieldValue.serverTimestamp()
  };

  batch.update(ref, updates);
  await batch.commit();

  const updated = await ref.get();

  res.json({ success: true, invoice: { id, ...updated.data() } });
}));

module.exports = router;
