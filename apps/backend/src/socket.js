const Message = require('./models/Message');

function registerChatHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('chat:join', (channel = 'general') => {
      socket.join(channel);
    });

    socket.on('chat:message', async ({ channel = 'general', username, text } = {}) => {
      if (!username || !text) return;
      const message = await Message.create({ channel, username, text });
      io.to(channel).emit('chat:message', message);
    });
  });
}

module.exports = registerChatHandlers;
