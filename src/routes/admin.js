const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebase');
const asyncHandler = require('express-async-handler');
const { protectAdmin } = require('../middlewares/adminAuthMiddleware');

// @desc    Admin Login
// @route   POST /api/admin/auth/login
// @access  Public
router.post('/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error('Please provide email and password');
  }

  const cleanEmail = email.trim();
  const apiKey = process.env.FIREBASE_API_KEY;

  if (!apiKey) {
    res.status(500);
    throw new Error('Firebase Web API Key is missing. Please configure FIREBASE_API_KEY in the backend .env file.');
  }

  // Firebase Auth REST API call
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password,
          returnSecureToken: true
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      res.status(response.status || 401);
      throw new Error(data.error?.message || 'Firebase authentication failed');
    }

    // Optional Check: Verify if email is in the allowed admin list
    const allowedEmailsStr = process.env.ALLOWED_ADMIN_EMAILS || '';
    if (allowedEmailsStr) {
      const allowedEmails = allowedEmailsStr.split(',').map(e => e.trim().toLowerCase());
      if (!data.email || !allowedEmails.includes(data.email.toLowerCase())) {
        res.status(403);
        throw new Error('Access denied: You are not authorized as an administrator');
      }
    }

    res.status(200).json({
      success: true,
      token: data.idToken,
      refreshToken: data.refreshToken,
      user: {
        email: data.email,
        uid: data.localId,
        role: 'admin'
      }
    });
  } catch (error) {
    res.status(res.statusCode === 200 ? 500 : res.statusCode);
    throw new Error(error.message);
  }
}));

// Apply protectAdmin middleware to all remaining admin endpoints
router.use(protectAdmin);

// @desc    Get all users in the system and their business counts
// @route   GET /api/admin/users
// @access  Private (Admin Only)
router.get('/users', asyncHandler(async (req, res) => {
  // 1. Fetch all users
  const usersSnapshot = await db.collection('users').get();
  const usersList = [];
  
  usersSnapshot.forEach(doc => {
    usersList.push({
      id: doc.id,
      ...doc.data()
    });
  });

  // 2. Fetch all businesses to map counts
  const businessesSnapshot = await db.collection('businesses').get();
  const userBusinessMap = {};

  businessesSnapshot.forEach(doc => {
    const bizData = doc.data();
    if (bizData.ownerId) {
      userBusinessMap[bizData.ownerId] = (userBusinessMap[bizData.ownerId] || 0) + 1;
    }
  });

  // 3. Attach business counts to users
  const usersWithCounts = usersList.map(user => ({
    ...user,
    businessCount: userBusinessMap[user.id] || 0
  }));

  // Sort by createdAt descending
  usersWithCounts.sort((a, b) => {
    const dateA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
    const dateB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
    return dateB - dateA;
  });

  res.status(200).json({
    success: true,
    users: usersWithCounts
  });
}));

// @desc    Get all businesses owned by a specific user
// @route   GET /api/admin/users/:id/businesses
// @access  Private (Admin Only)
router.get('/users/:id/businesses', asyncHandler(async (req, res) => {
  const userId = req.params.id;

  const snapshot = await db.collection('businesses')
    .where('ownerId', '==', userId)
    .get();

  const businesses = [];
  snapshot.forEach(doc => {
    businesses.push({
      id: doc.id,
      ...doc.data()
    });
  });

  // Sort by createdAt descending
  businesses.sort((a, b) => {
    const dateA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
    const dateB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
    return dateB - dateA;
  });

  res.status(200).json({
    success: true,
    businesses
  });
}));

// @desc    Get all businesses in the system with owner details
// @route   GET /api/admin/businesses
// @access  Private (Admin Only)
router.get('/businesses', asyncHandler(async (req, res) => {
  // 1. Fetch all businesses
  const businessesSnapshot = await db.collection('businesses').get();
  const businesses = [];

  businessesSnapshot.forEach(doc => {
    businesses.push({
      id: doc.id,
      ...doc.data()
    });
  });

  // 2. Fetch all users to map owner details
  const usersSnapshot = await db.collection('users').get();
  const userMap = {};

  usersSnapshot.forEach(doc => {
    userMap[doc.id] = doc.data();
  });

  // 3. Attach owner details
  const businessesWithOwner = businesses.map(biz => {
    const owner = userMap[biz.ownerId] || null;
    return {
      ...biz,
      owner: owner ? {
        id: biz.ownerId,
        name: owner.name,
        phone: owner.phone,
        email: owner.email
      } : null
    };
  });

  // Sort by createdAt descending
  businessesWithOwner.sort((a, b) => {
    const dateA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate() : new Date(a.createdAt)) : new Date(0);
    const dateB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt)) : new Date(0);
    return dateB - dateA;
  });

  res.status(200).json({
    success: true,
    businesses: businessesWithOwner
  });
}));

// @desc    Update business details and subscription
// @route   PUT /api/admin/businesses/:id
// @access  Private (Admin Only)
router.put('/businesses/:id', asyncHandler(async (req, res) => {
  const businessId = req.params.id;
  const { name, address, isActive, subscriptionEndDate } = req.body;

  const businessDocRef = db.collection('businesses').doc(businessId);
  const businessDoc = await businessDocRef.get();

  if (!businessDoc.exists) {
    res.status(404);
    throw new Error('Business not found');
  }

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (address !== undefined) updates.address = address.trim();
  
  if (isActive !== undefined) {
    updates.isActive = !!isActive;
  }

  if (subscriptionEndDate !== undefined) {
    if (subscriptionEndDate === null) {
      updates.subscriptionEndDate = null;
    } else {
      const parsedDate = new Date(subscriptionEndDate);
      if (isNaN(parsedDate.getTime())) {
        res.status(400);
        throw new Error('Invalid subscription end date format');
      }
      updates.subscriptionEndDate = admin.firestore.Timestamp.fromDate(parsedDate);
    }
  }

  await businessDocRef.update(updates);
  const updatedDoc = await businessDocRef.get();

  res.status(200).json({
    success: true,
    message: 'Business subscription and settings updated successfully by admin',
    business: {
      id: businessId,
      ...updatedDoc.data()
    }
  });
}));

module.exports = router;
