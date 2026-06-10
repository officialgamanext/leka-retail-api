const descopeClient = require('../config/descope');
const { db } = require('../config/firebase');
const asyncHandler = require('express-async-handler');

// Verify Descope session token
const protectDescope = asyncHandler(async (req, res, next) => {
  let sessionToken;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    sessionToken = req.headers.authorization.split(' ')[1];
  }

  if (!sessionToken || sessionToken === 'undefined' || sessionToken === 'null') {
    res.status(401);
    throw new Error('Not authorized, no session token');
  }

  try {
    if (!descopeClient) {
      throw new Error('Descope client not initialized');
    }
    const authInfo = await descopeClient.validateSession(sessionToken);
    
    // Descope stores user ID in 'sub' property of the token
    req.user = authInfo.token;
    next();
  } catch (error) {
    console.error('Descope Auth Error:', error.message);
    res.status(401);
    
    if (error.message?.includes('JWTExpired')) {
      throw new Error('Your session has expired. Please log in again.');
    }
    throw new Error('Not authorized, Descope session failed');
  }
});

// Strict middleware: checks if business subscription is active and belongs to user
const protectSubscription = asyncHandler(async (req, res, next) => {
  const businessId = req.headers['x-business-id'];

  if (!businessId) {
    res.status(400);
    throw new Error('Missing X-Business-Id header for tenant scoping');
  }

  if (!req.user || !req.user.sub) {
    res.status(401);
    throw new Error('Not authorized, user profile missing');
  }

  const userId = req.user.sub;

  try {
    const businessDoc = await db.collection('businesses').doc(businessId).get();

    if (!businessDoc.exists) {
      res.status(404);
      throw new Error('Business not found');
    }

    const business = businessDoc.data();
    let isStaff = false;

    // 1. Ownership Check or Staff Check
    if (business.ownerId !== userId) {
      // Retrieve staff record by user phone number
      const userDoc = await db.collection('users').doc(userId).get();
      const userPhone = userDoc.exists ? userDoc.data().phone : null;

      if (userPhone) {
        const staffSnap = await db.collection('staff')
          .where('businessId', '==', businessId)
          .where('phone', '==', userPhone)
          .get();
        if (!staffSnap.empty) {
          isStaff = true;
        }
      }

      if (!isStaff) {
        res.status(403);
        throw new Error('Access Denied: You do not own or work at this business');
      }
    }

    // 2. Strict Active Check
    if (business.isActive !== true) {
      res.status(403);
      throw new Error('Access Denied: Subscription is inactive for this business');
    }

    // 3. Strict Subscription Date Check
    if (!business.subscriptionEndDate) {
      res.status(403);
      throw new Error('Access Denied: Subscription duration is not configured');
    }

    const expiryDate = business.subscriptionEndDate.toDate();
    if (expiryDate < new Date()) {
      res.status(403);
      throw new Error('Access Denied: Your subscription has expired. Please renew to continue.');
    }

    // Attach business object to request for downstream handlers
    req.business = {
      id: businessDoc.id,
      ...business,
      isStaff
    };

    next();
  } catch (error) {
    if (res.statusCode === 200) {
      res.status(500);
    }
    throw error;
  }
});

module.exports = { protectDescope, protectSubscription };
