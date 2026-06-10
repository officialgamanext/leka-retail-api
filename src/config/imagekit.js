// Using the 'imagekit' package (CommonJS-compatible, works with require())
// '@imagekit/nodejs' is ESM-only and breaks with CommonJS require()
const ImageKit = require('imagekit');

const imagekit = new ImageKit({
  publicKey:   process.env.IMAGEKIT_PUBLIC_KEY,
  privateKey:  process.env.IMAGEKIT_PRIVATE_KEY,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

module.exports = imagekit;
