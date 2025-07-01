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
      timer: null
    };
    socket.join(gameId);
    socket.emit('gameCreated', gameId);
    console.log(`Game created with ID: ${gameId}`);
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
      score: 0,
      lastAnswerTime: null,
      selected: null
    };
    socket.join(gameId);
    socket.emit('gameJoined', gameId);
    io.to(games[gameId].host).emit('playerJoined', { playerId: playerName, playerName });
  });

  socket.on('startGame', (gameId) => {
    startQuestion(gameId);
  });

  socket.on('submitAnswer', ({ gameId, answer }) => {
    const game = games[gameId];
    if (!game) return;
    const player = getPlayerBySocket(game, socket.id);
    if (!player) return;

    const now = Date.now();
    if (player.lastAnswerTime === null) {
      player.lastAnswerTime = now;
      player.selected = answer;
    }

    if (answer === game.questions[game.currentQuestion].correctAnswer) {
      const timeTaken = (now - game.startTime) / 1000;
      let score = 0;
      if (timeTaken <= 5) score = 100;
      else if (timeTaken <= 15) score = 75;
      else if (timeTaken <= 30) score = 50;
      else if (timeTaken <= 60) score = 25;
      player.score += score;
    }

    socket.emit('answerResult', {
      correct: answer === game.questions[game.currentQuestion].correctAnswer,
      correctAnswer: game.questions[game.currentQuestion].correctAnswer
    });

    io.to(game.host).emit('playerAnswered', {
      playerId: player.name,
      playerName: player.name,
      correct: answer === game.questions[game.currentQuestion].correctAnswer
    });

    if (Object.values(game.players).every(p => p.lastAnswerTime !== null)) {
      clearTimeout(game.timer);
      showLeaderboard(gameId);
    }
  });

  socket.on('nextQuestion', (gameId) => {
    const game = games[gameId];
    if (!game) return;
    game.currentQuestion++;
    if (game.currentQuestion < game.questions.length) {
      startQuestion(gameId);
    } else {
      const leaderboard = getLeaderboard(game);
      io.to(gameId).emit('gameOver', { leaderboard });
    }
  });

  socket.on('showLeaderboard', (gameId) => {
    showLeaderboard(gameId);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Helper functions
function generateGameId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function sampleQuestions() {
  return [
    { question: "Capital of France?", options: ["Paris", "London", "Berlin", "Madrid"], correctAnswer: "Paris" },
    { question: "Red planet?", options: ["Venus", "Mars", "Jupiter", "Saturn"], correctAnswer: "Mars" },
    { question: "Mona Lisa painted by?", options: ["Picasso", "Da Vinci", "Van Gogh", "Michelangelo"], correctAnswer: "Da Vinci" }
  ];
}

function startQuestion(gameId) {
  const game = games[gameId];
  if (!game) return;
  const q = game.questions[game.currentQuestion];
  game.startTime = Date.now();

  for (const p of Object.values(game.players)) {
    p.lastAnswerTime = null;
    p.selected = null;
  }

  io.to(gameId).emit('gameStarted');
  io.to(gameId).emit('newQuestion', {
    question: q.question,
    options: q.options,
    questionNumber: game.currentQuestion + 1,
    totalQuestions: game.questions.length
  });

  game.timer = setTimeout(() => {
    showLeaderboard(gameId);
  }, 60000);
}

function showLeaderboard(gameId) {
  const game = games[gameId];
  if (!game) return;
  const leaderboard = getLeaderboard(game);
  io.to(gameId).emit('leaderboardUpdate', { leaderboard });
}

function getLeaderboard(game) {
  return Object.values(game.players)
    .map(p => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function getPlayerBySocket(game, socketId) {
  return Object.values(game.players).find(p => p.socketId === socketId);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
