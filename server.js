const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = socketIo(server);

const games = {};
const disconnectTimers = {};

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Host creates game
  socket.on('createGame', () => {
    const gameId = generateGameId();
    games[gameId] = {
      id: gameId,
      host: socket.id,
      players: {},
      currentQuestion: 0,
      questions: sampleQuestions(),
      timer: null
    };
    socket.join(gameId);
    socket.emit('gameCreated', gameId);
    console.log(`Game created with ID: ${gameId}`);
  });

  // Host reconnects
  socket.on('reconnectHost', (gameId) => {
    if (games[gameId]) {
      games[gameId].host = socket.id;
      socket.join(gameId);
      socket.emit('gameCreated', gameId);
      console.log(`Host reconnected to game ${gameId}`);
    }
  });

  // Player joins
  socket.on('joinGame', ({ gameId, playerName }) => {
    gameId = gameId.toUpperCase();
    if (!games[gameId]) {
      socket.emit('error', 'Game not found');
      return;
    }

    games[gameId].players[playerName] = {
      socketId: socket.id,
      name: playerName,
      score: 0
    };

    socket.join(gameId);
    socket.emit('gameJoined', gameId);
    io.to(games[gameId].host).emit('playerJoined', { playerId: playerName, playerName });
    console.log(`Player ${playerName} joined game ${gameId}`);
  });

  // Player reconnects
  socket.on('reconnectPlayer', ({ gameId, playerName }) => {
    if (games[gameId] && games[gameId].players[playerName]) {
      games[gameId].players[playerName].socketId = socket.id;
      socket.join(gameId);
      socket.emit('gameJoined', gameId);
      io.to(games[gameId].host).emit('playerJoined', { playerId: playerName, playerName });
      console.log(`Player ${playerName} reconnected to game ${gameId}`);
      clearTimeout(disconnectTimers[socket.id]);
    }
  });

  // Start game
  socket.on('startGame', (gameId) => {
    if (games[gameId]?.host !== socket.id) return;
    sendQuestion(gameId);
  });

  // Submit answer
  socket.on('submitAnswer', ({ gameId, answer }) => {
    const game = games[gameId];
    if (!game) return;
    const playerName = getPlayerNameBySocket(game, socket.id);
    if (!playerName) return;

    const q = game.questions[game.currentQuestion];
    const correct = answer === q.correctAnswer;
    if (correct) {
      const timeTaken = Math.max(0, 60 - q.timerUsed);
      const score = timeTaken >= 50 ? 100 : timeTaken >= 30 ? 50 : 20;
      game.players[playerName].score += score;
    }

    socket.emit('answerResult', { correct, correctAnswer: q.correctAnswer });
    io.to(game.host).emit('playerAnswered', { playerId: playerName, playerName, correct });
  });

  // Next question
  socket.on('nextQuestion', (gameId) => {
    if (games[gameId]?.host !== socket.id) return;
    games[gameId].currentQuestion++;
    sendQuestion(gameId);
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);

    for (const gameId in games) {
      const game = games[gameId];
      if (game.host === socket.id) {
        disconnectTimers[socket.id] = setTimeout(() => {
          io.to(gameId).emit('hostLeft');
          delete games[gameId];
          console.log(`Game ${gameId} removed`);
        }, 10000);
        return;
      }

      const playerName = getPlayerNameBySocket(game, socket.id);
      if (playerName) {
        disconnectTimers[socket.id] = setTimeout(() => {
          delete game.players[playerName];
          io.to(game.host).emit('playerLeft', playerName);
          console.log(`Player ${playerName} removed from ${gameId}`);
        }, 10000);
        return;
      }
    }
  });
});

function sendQuestion(gameId) {
  const game = games[gameId];
  if (!game) return;

  if (game.currentQuestion >= game.questions.length) {
    io.to(gameId).emit('gameOver', { leaderboard: getLeaderboard(game) });
    return;
  }

  const q = game.questions[game.currentQuestion];
  q.timerUsed = 0;
  io.to(gameId).emit('newQuestion', {
    question: q.question,
    options: q.options,
    questionNumber: game.currentQuestion + 1,
    totalQuestions: game.questions.length
  });

  if (game.timer) clearInterval(game.timer);
  game.timer = setInterval(() => {
    q.timerUsed++;
    io.to(gameId).emit('timerUpdate', 60 - q.timerUsed);
    if (q.timerUsed >= 60) {
      clearInterval(game.timer);
      io.to(gameId).emit('leaderboardUpdate', { leaderboard: getLeaderboard(game) });
    }
  }, 1000);
}

function generateGameId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function sampleQuestions() {
  return [
    { question: "Capital of France?", options: ["Paris", "London", "Berlin", "Madrid"], correctAnswer: "Paris" },
    { question: "5 + 3?", options: ["5", "7", "8", "9"], correctAnswer: "8" }
  ];
}

function getPlayerNameBySocket(game, socketId) {
  for (const name in game.players) {
    if (game.players[name].socketId === socketId) return name;
  }
  return null;
}

function getLeaderboard(game) {
  return Object.values(game.players)
    .map(p => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
