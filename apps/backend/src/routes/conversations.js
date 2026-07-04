const express = require('express');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');

const router = express.Router();

function toPublicUser(user) {
  return { id: user._id, username: user.username };
}

function otherParticipant(conversation, myUserId) {
  const participant = conversation.participants.find((p) => String(p._id) !== String(myUserId));
  return participant && toPublicUser(participant);
}

router.get('/', requireAuth, async (req, res) => {
  const conversations = await Conversation.find({ participants: req.userId })
    .populate('participants', 'username')
    .sort({ updatedAt: -1 });

  res.json(
    conversations.map((c) => ({
      id: c._id,
      otherUser: otherParticipant(c, req.userId),
      lastMessage: c.lastMessage,
    }))
  );
});

router.post('/', requireAuth, async (req, res) => {
  const { userId } = req.body || {};
  if (!userId || !mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'a valid userId is required' });
  }
  if (userId === req.userId) {
    return res.status(400).json({ error: "can't start a conversation with yourself" });
  }

  const otherUser = await User.findById(userId);
  if (!otherUser) return res.status(404).json({ error: 'user not found' });

  const participants = [req.userId, userId].sort();
  let conversation = await Conversation.findOne({ participants: { $all: participants, $size: 2 } });
  if (!conversation) {
    conversation = await Conversation.create({ participants });
  }
  await conversation.populate('participants', 'username');

  res.status(201).json({
    id: conversation._id,
    otherUser: otherParticipant(conversation, req.userId),
    lastMessage: conversation.lastMessage,
  });
});

router.get('/:id/messages', requireAuth, async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation || !conversation.participants.some((p) => String(p) === req.userId)) {
    return res.status(404).json({ error: 'conversation not found' });
  }

  const messages = await Message.find({ conversation: conversation._id })
    .sort({ createdAt: 1 })
    .limit(200)
    .populate('sender', 'username');

  res.json(
    messages.map((m) => ({
      id: m._id,
      text: m.text,
      sender: toPublicUser(m.sender),
      createdAt: m.createdAt,
    }))
  );
});

module.exports = router;
