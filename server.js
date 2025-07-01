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

const games = {}; // Stores game state
const disconnectTimers = {}; // Stores disconnect cleanup timers

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Host creates game
  socket.on('createGame', () => {
    const gameId = generateGameId();
    games[gameId] = {
      id: gameId,
      host: socket.id,
      players: {},
      currentQuestion: 0,
      questions: sampleQuestions()
    };
    socket.join(gameId);
    socket.emit('gameCreated', gameId);
    console.log(`Game created with ID: ${gameId}`);
  });

  // Host reconnects
  socket.on('reconnectHost', (gameId) => {
    if (games[gameId]) {
      clearDisconnectTimer(games[gameId].host);
      games[gameId].host = socket.id;
      socket.join(gameId);
      socket.emit('gameCreated', gameId);
      console.log(`Host reconnected to game ${gameId}`);
    }
  });

  // Player joins game
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

  // Player reconnects
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

  // Start game
  socket.on('startGame', (gameId) => {
    if (games[gameId]?.host === socket.id) {
      const q = games[gameId].questions[0];
      io.to(gameId).emit('gameStarted');
      io.to(gameId).emit('newQuestion', {
        question: q.question,
        options: q.options,
        questionNumber: 1,
        totalQuestions: games[gameId].questions.length
      });
    }
  });

  // Submit answer
  socket.on('submitAnswer', ({ gameId, answer }) => {
    const game = games[gameId];
    if (!game) return;

    const playerName = getPlayerNameBySocket(game, socket.id);
    if (!playerName) return;

    const currentQ = game.questions[game.currentQuestion];
    const isCorrect = answer === currentQ.correctAnswer;

    if (isCorrect) {
      game.players[playerName].score++;
    }

    socket.emit('answerResult', {
      correct: isCorrect,
      correctAnswer: currentQ.correctAnswer
    });

    io.to(game.host).emit('playerAnswered', {
      playerId: playerName,
      playerName,
      correct: isCorrect
    });
  });

  // Next question
  socket.on('nextQuestion', (gameId) => {
    const game = games[gameId];
    if (!game || game.host !== socket.id) return;

    game.currentQuestion++;
    if (game.currentQuestion < game.questions.length) {
      const q = game.questions[game.currentQuestion];
      io.to(gameId).emit('newQuestion', {
        question: q.question,
        options: q.options,
        questionNumber: game.currentQuestion + 1,
        totalQuestions: game.questions.length
      });
    } else {
      const leaderboard = getLeaderboard(game);
      io.to(gameId).emit('gameOver', { leaderboard });
    }
  });

  // Show leaderboard
  socket.on('showLeaderboard', (gameId) => {
    const game = games[gameId];
    if (!game) return;

    const leaderboard = getLeaderboard(game);
    io.to(gameId).emit('leaderboardUpdate', { leaderboard });
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);

    for (const gameId in games) {
      const game = games[gameId];

      if (game.host === socket.id) {
        console.log(`Host disconnected from ${gameId}, waiting 10s to remove...`);
        disconnectTimers[socket.id] = setTimeout(() => {
          io.to(gameId).emit('hostLeft');
          delete games[gameId];
          console.log(`Game ${gameId} removed`);
        }, 10000);
        return;
      }

      const playerName = getPlayerNameBySocket(game, socket.id);
      if (playerName) {
        console.log(`Player ${playerName} disconnected from ${gameId}, waiting 10s...`);
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

// Utilities
function clearDisconnectTimer(socketId) {
  if (disconnectTimers[socketId]) {
    clearTimeout(disconnectTimers[socketId]);
    delete disconnectTimers[socketId];
  }
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

function generateGameId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function sampleQuestions() {
  return [
    {
      question: "What is the capital of France?",
      options: ["Paris", "London", "Berlin", "Madrid"],
      correctAnswer: "Paris"
    },
    {
      question: "What is 5 + 3?",
      options: ["5", "7", "8", "9"],
      correctAnswer: "8"
    },
    {
      question: "What color is the sky?",
      options: ["Green", "Blue", "Red", "Yellow"],
      correctAnswer: "Blue"
    }
  ];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
