const DescopeSDK = require('@descope/node-sdk');
const dotenv = require('dotenv');

dotenv.config();

let descopeClient;

try {
  const DescopeClient = DescopeSDK.default || DescopeSDK;
  descopeClient = DescopeClient({
    projectId: process.env.DESCOPE_PROJECT_ID,
    managementKey: process.env.DESCOPE_MANAGEMENT_KEY,
  });
  console.log('Descope Client initialized successfully');
} catch (error) {
  console.error('Descope initialization error:', error.message);
}

module.exports = descopeClient;
