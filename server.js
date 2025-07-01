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
const questionTimers = {};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('createGame', () => {
    const gameId = generateGameId();
    games[gameId] = {
      id: gameId,
      host: socket.id,
      players: {},
      currentQuestion: 0,
      questions: sampleQuestions(),
      startTime: null
    };
    socket.join(gameId);
    socket.emit('gameCreated', gameId);
    console.log(`Game created with ID: ${gameId}`);
  });

  socket.on('reconnectHost', (gameId) => {
    if (games[gameId]) {
      clearDisconnectTimer(games[gameId].host);
      games[gameId].host = socket.id;
      socket.join(gameId);
      socket.emit('gameCreated', gameId);
      console.log(`Host reconnected to game ${gameId}`);
    }
  });

  socket.on('reconnectPlayer', ({ gameId, playerName }) => {
    if (games[gameId] && games[gameId].players[playerName]) {
      clearDisconnectTimer(games[gameId].players[playerName].socketId);
      games[gameId].players[playerName].socketId = socket.id;
      socket.join(gameId);
      socket.emit('gameJoined', gameId);
      io.to(games[gameId].host).emit('playerJoined', {
        playerId: playerName,
        playerName: playerName
      });
      console.log(`Player ${playerName} reconnected to game ${gameId}`);
    } else {
      socket.emit('error', 'Reconnection failed: Player not found');
    }
  });

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
    io.to(games[gameId].host).emit('playerJoined', {
      playerId: playerName,
      playerName: playerName
    });
    console.log(`Player ${playerName} joined game ${gameId}`);
  });

  socket.on('startGame', (gameId) => {
    if (games[gameId]?.host === socket.id) {
      sendQuestion(gameId);
    }
  });

  socket.on('nextQuestion', (gameId) => {
    const game = games[gameId];
    if (!game || game.host !== socket.id) return;

    game.currentQuestion++;
    if (game.currentQuestion < game.questions.length) {
      sendQuestion(gameId);
    } else {
      const leaderboard = getLeaderboard(game);
      io.to(gameId).emit('gameOver', { leaderboard });
      io.to(`monitor-${gameId}`).emit('gameOver', { leaderboard });
    }
  });

  socket.on('submitAnswer', ({ gameId, answer }) => {
    const game = games[gameId];
    if (!game) return;

    const playerName = getPlayerNameBySocket(game, socket.id);
    if (!playerName) return;

    const currentQ = game.questions[game.currentQuestion];
    const isCorrect = answer === currentQ.correctAnswer;
    let score = 0;

    if (isCorrect) {
      const timeTaken = (Date.now() - game.startTime) / 1000;
      if (timeTaken <= 5) score = 100;
      else if (timeTaken <= 30) score = 50;
      else score = 20;
      game.players[playerName].score += score;
    }

    socket.emit('answerResult', {
      correct: isCorrect,
      correctAnswer: currentQ.correctAnswer,
      score
    });

    io.to(game.host).emit('playerAnswered', {
      playerId: playerName,
      playerName,
      correct: isCorrect
    });
  });

  socket.on('showLeaderboard', (gameId) => {
    const game = games[gameId];
    if (!game) return;
    const leaderboard = getLeaderboard(game);
    io.to(gameId).emit('leaderboardUpdate', { leaderboard });
    io.to(`monitor-${gameId}`).emit('leaderboardUpdate', { leaderboard });
  });

  socket.on('monitorGame', (gameId) => {
    if (!games[gameId]) {
      socket.emit('error', 'Game not found');
      return;
    }
    socket.join(`monitor-${gameId}`);
    console.log(`Monitor joined game ${gameId}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    for (const gameId in games) {
      const game = games[gameId];
      if (game.host === socket.id) {
        disconnectTimers[socket.id] = setTimeout(() => {
          io.to(gameId).emit('hostLeft');
          delete games[gameId];
        }, 10000);
        return;
      }

      const playerName = getPlayerNameBySocket(game, socket.id);
      if (playerName) {
        disconnectTimers[socket.id] = setTimeout(() => {
          delete game.players[playerName];
          io.to(game.host).emit('playerLeft', playerName);
        }, 10000);
        return;
      }
    }
  });
});

// Utility Functions
function sendQuestion(gameId) {
  const game = games[gameId];
  const q = game.questions[game.currentQuestion];

  game.startTime = Date.now();
  io.to(gameId).emit('newQuestion', {
    question: q.question,
    options: q.options,
    questionNumber: game.currentQuestion + 1,
    totalQuestions: game.questions.length
  });
  io.to(`monitor-${gameId}`).emit('newQuestion', {
    question: q.question,
    options: q.options,
    questionNumber: game.currentQuestion + 1,
    totalQuestions: game.questions.length
  });

  if (questionTimers[gameId]) clearTimeout(questionTimers[gameId]);
  questionTimers[gameId] = setTimeout(() => {
    const leaderboard = getLeaderboard(game);
    io.to(gameId).emit('leaderboardUpdate', { leaderboard });
    io.to(`monitor-${gameId}`).emit('leaderboardUpdate', { leaderboard });
  }, 60000);
}

function getPlayerNameBySocket(game, socketId) {
  for (const name in game.players) {
    if (game.players[name].socketId === socketId) return name;
  }
  return null;
}

function clearDisconnectTimer(socketId) {
  if (disconnectTimers[socketId]) {
    clearTimeout(disconnectTimers[socketId]);
    delete disconnectTimers[socketId];
  }
}

function generateGameId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getLeaderboard(game) {
  return Object.values(game.players)
    .sort((a, b) => b.score - a.score)
    .map(p => ({ name: p.name, score: p.score }));
}

function sampleQuestions() {
  return [
    {
      question: "What is the capital of France?",
      options: ["Paris", "London", "Rome", "Berlin"],
      correctAnswer: "Paris"
    },
    {
      question: "Which planet is known as the Red Planet?",
      options: ["Earth", "Venus", "Mars", "Jupiter"],
      correctAnswer: "Mars"
    }
  ];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
