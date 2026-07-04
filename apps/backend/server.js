require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const connectDB = require('./src/config/db');
const authRouter = require('./src/routes/auth');
const usersRouter = require('./src/routes/users');
const conversationsRouter = require('./src/routes/conversations');
const registerChatHandlers = require('./src/socket');

const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set');
}
if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not set');
}

async function start() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/conversations', conversationsRouter);

  const server = http.createServer(app);
  const io = new Server(server, {
    path: '/socket.io/',
    cors: { origin: '*' },
  });

  // With multiple backend replicas, Socket.IO's default in-memory
  // room/broadcast state only exists within a single pod's process. A
  // Redis pub/sub adapter is what lets io.to(room).emit(...) reach sockets
  // connected to a *different* pod.
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();
  pubClient.on('error', (err) => console.error('redis pub client error', err));
  subClient.on('error', (err) => console.error('redis sub client error', err));
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));

  registerChatHandlers(io);

  await connectDB();
  server.listen(PORT, () => console.log(`backend listening on port ${PORT}`));
}

start().catch((err) => {
  console.error('failed to start backend', err);
  process.exit(1);
});
