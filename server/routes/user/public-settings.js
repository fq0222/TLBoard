const express = require('express');
const publicSettingsController = require('../../controllers/user/public-settings-controller');

const router = express.Router();

router.get('/', publicSettingsController.getPublicSettings);

module.exports = router;
