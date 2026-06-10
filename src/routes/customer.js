const express = require('express');
const router  = express.Router();
const { db, admin } = require('../config/firebase');
const asyncHandler  = require('express-async-handler');
const { protectDescope, protectSubscription } = require('../middlewares/authMiddleware');

// All customer routes require login + active subscription
router.use(protectDescope);
router.use(protectSubscription);

// GET /api/customers — list all customers for the active business
router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.business.id;

  const snap = await db.collection('customers')
    .where('businessId', '==', businessId)
    .get();

  const customers = [];
  snap.forEach(doc => customers.push({ id: doc.id, ...doc.data() }));

  // Sort by createdAt descending in-memory
  customers.sort((a, b) => {
    const tA = a.createdAt?._seconds ?? 0;
    const tB = b.createdAt?._seconds ?? 0;
    return tB - tA;
  });

  res.json({ success: true, customers });
}));

// POST /api/customers — create a new customer
router.post('/', asyncHandler(async (req, res) => {
  const { name, phone, address } = req.body;
  const businessId = req.business.id;

  if (!name || !name.trim()) {
    res.status(400);
    throw new Error('Customer name is required');
  }

  if (!phone || !phone.trim()) {
    res.status(400);
    throw new Error('Customer mobile number is required');
  }

  // Prevent duplicates within same business based on phone
  const existing = await db.collection('customers')
    .where('businessId', '==', businessId)
    .where('phone', '==', phone.trim())
    .get();

  if (!existing.empty) {
    res.status(409);
    throw new Error('A customer with this mobile number already exists');
  }

  const docRef = await db.collection('customers').add({
    businessId,
    name: name.trim(),
    phone: phone.trim(),
    address: (address || '').trim(),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const saved = await docRef.get();
  res.status(201).json({
    success: true,
    customer: { id: docRef.id, ...saved.data(), createdAt: new Date() }
  });
}));

// DELETE /api/customers/:id — delete a customer
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.business.id;

  const doc = await db.collection('customers').doc(id).get();
  if (!doc.exists || doc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Customer not found');
  }

  await db.collection('customers').doc(id).delete();
  res.json({ success: true, message: 'Customer deleted' });
}));

module.exports = router;
