'use strict';
function multer() {
  return { single: (field) => (req, res, next) => { req.file = (req.files || {})[field]; next(); } };
}
multer.memoryStorage = () => ({});
module.exports = multer;
