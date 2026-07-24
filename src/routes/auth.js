const express = require('express');
const router = express.Router();
const descopeClient = require('../config/descope');
const { db, admin } = require('../config/firebase');
const asyncHandler = require('express-async-handler');
const { protectDescope } = require('../middlewares/authMiddleware');

// @desc    Send SMS OTP to phone number
// @route   POST /api/auth/otp/send
// @access  Public
router.post('/otp/send', asyncHandler(async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    res.status(400);
    throw new Error('Please provide a mobile number');
  }

  try {
    // Initiate Descope SMS OTP flow
    await descopeClient.otp.signUpOrIn.sms(phoneNumber);
    
    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      phoneNumber
    });
  } catch (error) {
    console.error('Descope OTP Send Error:', error);
    res.status(500);
    throw new Error('Failed to send OTP: ' + error.message);
  }
}));

// @desc    Verify SMS OTP and login/register user
// @route   POST /api/auth/otp/verify
// @access  Public
router.post('/otp/verify', asyncHandler(async (req, res) => {
  const { phoneNumber, otp } = req.body;

  if (!phoneNumber || !otp) {
    res.status(400);
    throw new Error('Please provide mobile number and OTP');
  }

  try {
    // Verify using Descope SDK
    const authInfo = await descopeClient.otp.verify.sms(phoneNumber, otp);
    
    // Extract Session JWT
    const effectiveAuthInfo = authInfo.data || authInfo;
    let sessionJwt = null;

    if (effectiveAuthInfo.sessionToken) {
      sessionJwt = typeof effectiveAuthInfo.sessionToken === 'string' 
        ? effectiveAuthInfo.sessionToken 
        : effectiveAuthInfo.sessionToken.jwt;
    } else if (effectiveAuthInfo.sessionJwt) {
      sessionJwt = effectiveAuthInfo.sessionJwt;
    } else {
      // Find key that looks like JWT
      for (const key of Object.keys(effectiveAuthInfo)) {
        if (typeof effectiveAuthInfo[key] === 'string' && effectiveAuthInfo[key].split('.').length === 3) {
          sessionJwt = effectiveAuthInfo[key];
          break;
        }
        if (effectiveAuthInfo[key] && typeof effectiveAuthInfo[key] === 'object' && effectiveAuthInfo[key].jwt) {
          sessionJwt = effectiveAuthInfo[key].jwt;
          break;
        }
      }
    }

    let refreshJwt = null;
    if (effectiveAuthInfo.refreshToken) {
      refreshJwt = typeof effectiveAuthInfo.refreshToken === 'string' 
        ? effectiveAuthInfo.refreshToken 
        : effectiveAuthInfo.refreshToken.jwt;
    } else {
      for (const key of Object.keys(effectiveAuthInfo)) {
        if (key.toLowerCase().includes('refresh')) {
          if (typeof effectiveAuthInfo[key] === 'string' && effectiveAuthInfo[key].split('.').length === 3) {
            refreshJwt = effectiveAuthInfo[key];
            break;
          }
          if (effectiveAuthInfo[key] && typeof effectiveAuthInfo[key] === 'object' && effectiveAuthInfo[key].jwt) {
            refreshJwt = effectiveAuthInfo[key].jwt;
            break;
          }
        }
      }
    }

    if (!sessionJwt) {
      res.status(500);
      throw new Error('Authentication succeeded but session token extraction failed');
    }

    // Validate the token to get the user ID
    const validatedInfo = await descopeClient.validateSession(sessionJwt);
    const userId = validatedInfo.token.sub;

    // Create user in Firestore users collection if not exists
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();

    let userData = {
      id: userId,
      phone: phoneNumber,
      name: 'Retail Owner',
      createdAt: new Date()
    };

    if (!userDoc.exists) {
      await userDocRef.set({
        ...userData,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      userData = userDoc.data();
    }

    res.status(200).json({
      success: true,
      token: sessionJwt,
      refreshToken: refreshJwt,
      user: userData
    });
  } catch (error) {
    console.error('OTP Verification Error:', error);
    res.status(401);
    throw new Error(error.message || 'Invalid or expired OTP');
  }
}));

// @desc    Refresh session token using refresh token
// @route   POST /api/auth/refresh
// @access  Public
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400);
    throw new Error('Please provide a refresh token');
  }

  try {
    const refreshed = await descopeClient.refreshSession(refreshToken);
    const effectiveAuthInfo = refreshed.data || refreshed;
    
    let sessionJwt = null;
    if (effectiveAuthInfo.sessionToken) {
      sessionJwt = typeof effectiveAuthInfo.sessionToken === 'string' 
        ? effectiveAuthInfo.sessionToken 
        : effectiveAuthInfo.sessionToken.jwt;
    } else if (effectiveAuthInfo.sessionJwt) {
      sessionJwt = effectiveAuthInfo.sessionJwt;
    } else {
      for (const key of Object.keys(effectiveAuthInfo)) {
        if (typeof effectiveAuthInfo[key] === 'string' && effectiveAuthInfo[key].split('.').length === 3) {
          sessionJwt = effectiveAuthInfo[key];
          break;
        }
        if (effectiveAuthInfo[key] && typeof effectiveAuthInfo[key] === 'object' && effectiveAuthInfo[key].jwt) {
          sessionJwt = effectiveAuthInfo[key].jwt;
          break;
        }
      }
    }

    let refreshJwt = null;
    if (effectiveAuthInfo.refreshToken) {
      refreshJwt = typeof effectiveAuthInfo.refreshToken === 'string' 
        ? effectiveAuthInfo.refreshToken 
        : effectiveAuthInfo.refreshToken.jwt;
    } else {
      for (const key of Object.keys(effectiveAuthInfo)) {
        if (key.toLowerCase().includes('refresh')) {
          if (typeof effectiveAuthInfo[key] === 'string' && effectiveAuthInfo[key].split('.').length === 3) {
            refreshJwt = effectiveAuthInfo[key];
            break;
          }
          if (effectiveAuthInfo[key] && typeof effectiveAuthInfo[key] === 'object' && effectiveAuthInfo[key].jwt) {
            refreshJwt = effectiveAuthInfo[key].jwt;
            break;
          }
        }
      }
    }

    if (!sessionJwt) {
      res.status(500);
      throw new Error('Session refresh succeeded but session token extraction failed');
    }

    res.status(200).json({
      success: true,
      token: sessionJwt,
      refreshToken: refreshJwt || refreshToken
    });
  } catch (error) {
    res.status(401);
    if (error.message?.includes('JWTExpired')) {
      console.warn('Session Refresh: Refresh token has expired.');
    } else {
      console.error('Session Refresh Error:', error.message || error);
    }
    throw new Error(error.message || 'Failed to refresh session');
  }
}));

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protectDescope, asyncHandler(async (req, res) => {
  const userId = req.user.sub;
  const userDoc = await db.collection('users').doc(userId).get();

  if (!userDoc.exists) {
    res.status(404);
    throw new Error('User profile not found in database');
  }

  res.status(200).json({
    success: true,
    user: userDoc.data()
  });
}));

module.exports = router;
