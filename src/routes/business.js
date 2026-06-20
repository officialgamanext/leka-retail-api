const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const asyncHandler = require('express-async-handler');
const { protectDescope } = require('../middlewares/authMiddleware');

// All business routes require user to be logged in
router.use(protectDescope);

// @desc    List all businesses owned by current user
// @route   GET /api/businesses
// @access  Private
router.get('/', asyncHandler(async (req, res) => {
  const userId = req.user.sub;

  // Retrieve user document to get user phone number
  const userDoc = await db.collection('users').doc(userId).get();
  const userPhone = userDoc.exists ? userDoc.data().phone : null;

  // Fetch owned businesses
  const snapshot = await db.collection('businesses')
    .where('ownerId', '==', userId)
    .get();

  const ownedBusinesses = [];
  snapshot.forEach(doc => {
    ownedBusinesses.push({
      id: doc.id,
      ...doc.data(),
      isStaff: false
    });
  });

  // Fetch businesses where user is registered as staff
  const staffBusinesses = [];
  if (userPhone) {
    const staffSnapshot = await db.collection('staff')
      .where('phone', '==', userPhone)
      .get();

    for (const doc of staffSnapshot.docs) {
      const staffData = doc.data();
      const bizDoc = await db.collection('businesses').doc(staffData.businessId).get();
      if (bizDoc.exists) {
        staffBusinesses.push({
          id: bizDoc.id,
          ...bizDoc.data(),
          isStaff: true,
          staffName: staffData.name
        });
      }
    }
  }

  // Combine both lists
  const businesses = [...ownedBusinesses, ...staffBusinesses];

  // Sort in-memory to avoid Firestore composite index requirement
  businesses.sort((a, b) => {
    const timeA = a.createdAt ? (a.createdAt._seconds ? a.createdAt._seconds * 1000 : new Date(a.createdAt).getTime()) : 0;
    const timeB = b.createdAt ? (b.createdAt._seconds ? b.createdAt._seconds * 1000 : new Date(b.createdAt).getTime()) : 0;
    return timeB - timeA; // Descending order
  });

  res.status(200).json({
    success: true,
    businesses
  });
}));

// @desc    Create a new business
// @route   POST /api/businesses
// @access  Private
router.post('/', asyncHandler(async (req, res) => {
  const { name, address } = req.body;
  const userId = req.user.sub;

  if (!name || !address) {
    res.status(400);
    throw new Error('Please provide business name and address');
  }

  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() - 2); // 2 days before creation date

  const newBusiness = {
    name,
    address,
    ownerId: userId,
    isActive: false,              // Inactive initially
    subscriptionEndDate: admin.firestore.Timestamp.fromDate(expiryDate), // Expired 2 days ago
    enableOutOfStockBilling: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const docRef = await db.collection('businesses').add(newBusiness);
  const savedDoc = await docRef.get();

  res.status(201).json({
    success: true,
    business: {
      id: docRef.id,
      ...savedDoc.data()
    }
  });
}));

// @desc    Demo Endpoint: Toggle business subscription status for testing
// @route   POST /api/businesses/:id/demo-activate
// @access  Private
router.post('/:id/demo-activate', asyncHandler(async (req, res) => {
  const businessId = req.params.id;
  const userId = req.user.sub;

  const businessDocRef = db.collection('businesses').doc(businessId);
  const businessDoc = await businessDocRef.get();

  if (!businessDoc.exists) {
    res.status(404);
    throw new Error('Business not found');
  }

  const business = businessDoc.data();

  // Verify ownership
  if (business.ownerId !== userId) {
    res.status(403);
    throw new Error('Access Denied: You do not own this business');
  }

  // Toggle active status
  const willBeActive = !business.isActive;
  let newEndDate = null;

  if (willBeActive) {
    // Set expiry date to 30 days from now
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    newEndDate = admin.firestore.Timestamp.fromDate(expiry);
  }

  await businessDocRef.update({
    isActive: willBeActive,
    subscriptionEndDate: newEndDate
  });

  res.status(200).json({
    success: true,
    message: `Business subscription ${willBeActive ? 'activated (30 days)' : 'deactivated'} successfully`,
    isActive: willBeActive,
    subscriptionEndDate: newEndDate ? newEndDate.toDate() : null
  });
}));

// @desc    Delete a business
// @route   DELETE /api/businesses/:id
// @access  Private
router.delete('/:id', asyncHandler(async (req, res) => {
  const businessId = req.params.id;
  const userId = req.user.sub;

  const businessDocRef = db.collection('businesses').doc(businessId);
  const businessDoc = await businessDocRef.get();

  if (!businessDoc.exists) {
    res.status(404);
    throw new Error('Business not found');
  }

  const business = businessDoc.data();

  // Verify ownership
  if (business.ownerId !== userId) {
    res.status(403);
    throw new Error('Access Denied: You do not own this business');
  }

  await businessDocRef.delete();

  res.status(200).json({
    success: true,
    message: 'Business deleted successfully'
  });
}));

// @desc    Update business details (name, address, gstEnabled, gstPercentage)
// @route   PUT /api/businesses/:id
// @access  Private
router.put('/:id', asyncHandler(async (req, res) => {
  const businessId = req.params.id;
  const userId = req.user.sub;

  const businessDocRef = db.collection('businesses').doc(businessId);
  const businessDoc = await businessDocRef.get();

  if (!businessDoc.exists) {
    res.status(404);
    throw new Error('Business not found');
  }

  const business = businessDoc.data();

  // Verify ownership
  if (business.ownerId !== userId) {
    res.status(403);
    throw new Error('Access Denied: You do not own this business');
  }

  const { name, address, gstEnabled, gstPercentage, enableOutOfStockBilling } = req.body;

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (address !== undefined) updates.address = address.trim();
  if (gstEnabled !== undefined) updates.gstEnabled = !!gstEnabled;
  if (gstPercentage !== undefined) updates.gstPercentage = Number(gstPercentage);
  if (enableOutOfStockBilling !== undefined) updates.enableOutOfStockBilling = !!enableOutOfStockBilling;

  await businessDocRef.update(updates);
  const updatedDoc = await businessDocRef.get();

  res.status(200).json({
    success: true,
    message: 'Business details updated successfully',
    business: {
      id: businessId,
      ...updatedDoc.data()
    }
  });
}));

module.exports = router;
