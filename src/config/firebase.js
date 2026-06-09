const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

// Fix multiline key issue in privateKey
const privateKey = process.env.FIREBASE_PRIVATE_KEY 
  ? (process.env.FIREBASE_PRIVATE_KEY.startsWith('"') && process.env.FIREBASE_PRIVATE_KEY.endsWith('"')
      ? JSON.parse(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n')
      : process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'))
  : undefined;

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: privateKey,
};

if (!firebaseConfig.projectId || !firebaseConfig.clientEmail || !firebaseConfig.privateKey) {
  console.error('Firebase configuration is missing in .env');
} else {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(firebaseConfig),
    });
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase initialization error:', error.message);
  }
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
