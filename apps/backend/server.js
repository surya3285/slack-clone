require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const connectDB = require('./src/config/db');
const messagesRouter = require('./src/routes/messages');
const registerChatHandlers = require('./src/socket');

const PORT = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/messages', messagesRouter);

const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io/',
  cors: { origin: '*' },
});

registerChatHandlers(io);

connectDB()
  .then(() => {
    server.listen(PORT, () => console.log(`backend listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('failed to connect to MongoDB', err);
    process.exit(1);
  });
