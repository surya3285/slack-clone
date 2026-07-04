const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    // Always stored sorted by id so a (userA, userB) pair maps to exactly
    // one conversation regardless of who started it.
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    lastMessage: {
      text: String,
      sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      createdAt: Date,
    },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
