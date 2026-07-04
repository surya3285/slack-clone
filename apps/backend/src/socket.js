const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
const { verifyToken } = require('./utils/jwt');

function userRoom(userId) {
  return `user:${userId}`;
}

function registerChatHandlers(io) {
  io.use((socket, next) => {
    try {
      socket.userId = verifyToken(socket.handshake.auth?.token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(userRoom(socket.userId));

    socket.on('message:send', async ({ conversationId, text } = {}) => {
      if (!conversationId || !text?.trim()) return;

      const conversation = await Conversation.findById(conversationId).populate('participants', 'username');
      if (!conversation || !conversation.participants.some((p) => String(p._id) === socket.userId)) {
        return;
      }

      const message = await Message.create({
        conversation: conversationId,
        sender: socket.userId,
        text: text.trim(),
      });
      await message.populate('sender', 'username');

      conversation.lastMessage = { text: message.text, sender: socket.userId, createdAt: message.createdAt };
      await conversation.save();

      const messagePayload = {
        id: message._id,
        text: message.text,
        sender: { id: message.sender._id, username: message.sender.username },
        createdAt: message.createdAt,
      };

      // Deliver to each participant's personal room rather than a
      // conversation-specific room: a recipient who has never opened this
      // conversation would never have joined that room, so they'd silently
      // miss both the message and the sidebar update.
      conversation.participants.forEach((participant) => {
        const otherUser = conversation.participants.find((p) => String(p._id) !== String(participant._id));
        const room = userRoom(participant._id);

        io.to(room).emit('message:new', { conversationId, message: messagePayload });
        io.to(room).emit('conversation:updated', {
          id: conversation._id,
          otherUser: { id: otherUser._id, username: otherUser.username },
          lastMessage: conversation.lastMessage,
        });
      });
    });
  });
}

module.exports = registerChatHandlers;
