const express = require('express');
const router  = express.Router();
const { db, admin } = require('../config/firebase');
const asyncHandler  = require('express-async-handler');
const { protectDescope, protectSubscription } = require('../middlewares/authMiddleware');

// All staff routes require login + active subscription
router.use(protectDescope);
router.use(protectSubscription);

// Normalization function matching frontend Descope OTP phone format
const formatPhoneNumber = (number) => {
  if (!number) return '';
  const cleaned = number.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`;
  }
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    return `+91${cleaned.slice(1)}`;
  }
  return number.startsWith('+') ? number : `+${cleaned}`;
};

// GET /api/staff — list all staff members for the active business
router.get('/', asyncHandler(async (req, res) => {
  const businessId = req.business.id;

  const snap = await db.collection('staff')
    .where('businessId', '==', businessId)
    .get();

  const staff = [];
  snap.forEach(doc => staff.push({ id: doc.id, ...doc.data() }));

  // Sort by createdAt descending
  staff.sort((a, b) => {
    const tA = a.createdAt?._seconds ?? 0;
    const tB = b.createdAt?._seconds ?? 0;
    return tB - tA;
  });

  res.json({ success: true, staff });
}));

// POST /api/staff — register a new staff member
router.post('/', asyncHandler(async (req, res) => {
  const { name, phone } = req.body;
  const businessId = req.business.id;

  if (!name || !name.trim()) {
    res.status(400);
    throw new Error('Staff name is required');
  }

  if (!phone || !phone.trim()) {
    res.status(400);
    throw new Error('Staff mobile number is required');
  }

  const normalizedPhone = formatPhoneNumber(phone.trim());

  // Prevent duplicate staff registration in same business
  const existing = await db.collection('staff')
    .where('businessId', '==', businessId)
    .where('phone', '==', normalizedPhone)
    .get();

  if (!existing.empty) {
    res.status(490); // custom client error or 409 conflict
    throw new Error('A staff member with this mobile number is already registered for this business');
  }

  const docRef = await db.collection('staff').add({
    businessId,
    name: name.trim(),
    phone: normalizedPhone,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const saved = await docRef.get();
  res.status(201).json({
    success: true,
    staff: { id: docRef.id, ...saved.data(), createdAt: new Date() }
  });
}));

// DELETE /api/staff/:id — delete a staff member
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const businessId = req.business.id;

  const doc = await db.collection('staff').doc(id).get();
  if (!doc.exists || doc.data().businessId !== businessId) {
    res.status(404);
    throw new Error('Staff member not found');
  }

  await db.collection('staff').doc(id).delete();
  res.json({ success: true, message: 'Staff member removed successfully' });
}));

module.exports = router;
