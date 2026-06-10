const express = require('express');
const router  = express.Router();
const asyncHandler = require('express-async-handler');
const { protectDescope, protectSubscription } = require('../middlewares/authMiddleware');
const imagekit = require('../config/imagekit');

// Upload requires login + active subscription
router.use(protectDescope);
router.use(protectSubscription);

/**
 * POST /api/upload
 * Body: { base64: "data:image/png;base64,...", fileName: "item_abc.png", folder: "/items" }
 * Returns: { success: true, url: "https://ik.imagekit.io/..." }
 */
router.post('/', asyncHandler(async (req, res) => {
  const { base64, fileName, folder = '/leka-retail/items' } = req.body;
  const businessId = req.business.id;

  if (!base64 || !fileName) {
    res.status(400);
    throw new Error('base64 image data and fileName are required');
  }

  // Strip data URI prefix if present
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');

  const uploadFolder = `${folder}/${businessId}`;

  const result = await imagekit.upload({
    file:     base64Data,
    fileName: fileName,
    folder:   uploadFolder,
    useUniqueFileName: true,
    tags:     [`business_${businessId}`, 'leka-retail']
  });

  res.json({
    success:  true,
    url:      result.url,
    fileId:   result.fileId,
    filePath: result.filePath
  });
}));

module.exports = router;
