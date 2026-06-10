const express = require('express');
const router  = express.Router();
const { db, admin } = require('../config/firebase');
const asyncHandler  = require('express-async-handler');
const { protectDescope, protectSubscription } = require('../middlewares/authMiddleware');

// All category routes require login + active subscription
router.use(protectDescope);
router.use(protectSubscription);

// GET /api/categories — list all categories for the active business
router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.business.id;

  const snap = await db.collection('categories')
    .where('businessId', '==', businessId)
    .get();

  const categories = [];
  snap.forEach(doc => categories.push({ id: doc.id, ...doc.data() }));

  // Sort by createdAt descending in-memory (no composite index needed)
  categories.sort((a, b) => {
    const tA = a.createdAt?._seconds ?? 0;
    const tB = b.createdAt?._seconds ?? 0;
    return tB - tA;
  });

  res.json({ success: true, categories });
}));

// POST /api/categories — create a new category
router.post('/', asyncHandler(async (req, res) => {
  const { name } = req.body;
  const businessId = req.business.id;

  if (!name || !name.trim()) {
    res.status(400);
    throw new Error('Category name is required');
  }

  // Prevent duplicates within same business
  const existing = await db.collection('categories')
    .where('businessId', '==', businessId)
    .where('name', '==', name.trim())
    .get();

  if (!existing.empty) {
    res.status(409);
    throw new Error('A category with this name already exists');
  }

  const docRef = await db.collection('categories').add({
    businessId,
    name: name.trim(),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const saved = await docRef.get();
  res.status(201).json({
    success: true,
    category: { id: docRef.id, ...saved.data(), createdAt: new Date() }
  });
}));

// DELETE /api/categories/:id — delete a category
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.business.id;

  const doc = await db.collection('categories').doc(id).get();
  if (!doc.exists || doc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Category not found');
  }

  await db.collection('categories').doc(id).delete();
  res.json({ success: true, message: 'Category deleted' });
}));

module.exports = router;
