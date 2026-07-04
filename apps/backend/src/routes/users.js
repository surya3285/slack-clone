const express = require('express');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');

const router = express.Router();

router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  const users = await User.find({
    _id: { $ne: req.userId },
    username: { $regex: q, $options: 'i' },
  })
    .select('username')
    .limit(20);

  res.json(users.map((u) => ({ id: u._id, username: u.username })));
});

module.exports = router;
