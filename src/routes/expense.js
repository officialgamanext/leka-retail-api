const express = require('express');
const router  = express.Router();
const { db, admin } = require('../config/firebase');
const asyncHandler  = require('express-async-handler');
const { protectDescope, protectSubscription } = require('../middlewares/authMiddleware');

// All expense routes require login + active subscription
router.use(protectDescope);
router.use(protectSubscription);

// GET /api/expenses — list all expenses for the active business
router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.business.id;

  const snap = await db.collection('expenses')
    .where('businessId', '==', businessId)
    .get();

  const expenses = [];
  snap.forEach(doc => expenses.push({ id: doc.id, ...doc.data() }));

  // Sort by date string descending, and then by createdAt timestamp descending in-memory
  expenses.sort((a, b) => {
    const dateA = a.date || '';
    const dateB = b.date || '';
    if (dateA !== dateB) {
      return dateB.localeCompare(dateA);
    }
    const tA = a.createdAt?._seconds ?? 0;
    const tB = b.createdAt?._seconds ?? 0;
    return tB - tA;
  });

  res.json({ success: true, expenses });
}));

// POST /api/expenses — log a new expense
router.post('/', asyncHandler(async (req, res) => {
  const { forExpense, amount, date } = req.body;
  const businessId = req.business.id;

  if (!forExpense || !forExpense.trim()) {
    res.status(400);
    throw new Error('Expense purpose ("For") is required');
  }

  if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400);
    throw new Error('Valid expense amount (> 0) is required');
  }

  // Fallback to today's date in YYYY-MM-DD if date is missing
  const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local format
  const finalDate = (date && date.trim()) ? date.trim() : todayStr;

  const docRef = await db.collection('expenses').add({
    businessId,
    forExpense: forExpense.trim(),
    amount: Number(amount),
    date: finalDate,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const saved = await docRef.get();
  res.status(201).json({
    success: true,
    expense: { id: docRef.id, ...saved.data(), createdAt: new Date() }
  });
}));

// DELETE /api/expenses/:id — delete an expense
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.business.id;

  const doc = await db.collection('expenses').doc(id).get();
  if (!doc.exists || doc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Expense not found');
  }

  await db.collection('expenses').doc(id).delete();
  res.json({ success: true, message: 'Expense deleted successfully' });
}));

module.exports = router;
