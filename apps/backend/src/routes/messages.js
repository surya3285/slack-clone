const express = require('express');
const Message = require('../models/Message');

const router = express.Router();

router.get('/', async (req, res) => {
  const channel = req.query.channel || 'general';
  const messages = await Message.find({ channel }).sort({ createdAt: 1 }).limit(200);
  res.json(messages);
});

module.exports = router;
