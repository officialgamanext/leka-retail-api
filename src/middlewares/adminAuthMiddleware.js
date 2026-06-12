const { auth } = require('../config/firebase');
const asyncHandler = require('express-async-handler');

/**
 * Protect admin routes.
 * Checks for a Bearer token in the Authorization header.
 * Verifies Firebase ID token or checks against local fallback.
 */
const protectAdmin = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token || token === 'undefined' || token === 'null') {
    res.status(401);
    throw new Error('Not authorized, no admin token provided');
  }


  try {
    // Verify Firebase ID token using firebase-admin SDK
    const decodedToken = await auth.verifyIdToken(token);
    
    // Optional: Check if email is in the allowed list
    const allowedEmailsStr = process.env.ALLOWED_ADMIN_EMAILS || '';
    if (allowedEmailsStr) {
      const allowedEmails = allowedEmailsStr.split(',').map(e => e.trim().toLowerCase());
      if (!decodedToken.email || !allowedEmails.includes(decodedToken.email.toLowerCase())) {
        res.status(403);
        throw new Error('Access denied: You are not authorized as an administrator');
      }
    }

    req.admin = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: 'admin'
    };
    
    next();
  } catch (error) {
    console.error('Admin Auth Token verification error:', error.message);
    res.status(401);
    throw new Error('Not authorized, admin token validation failed: ' + error.message);
  }
});

module.exports = { protectAdmin };
