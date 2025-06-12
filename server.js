const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// 각 게임별 로직 모듈을 불러옵니다.
const averageGameLogic = require('./game-logic/average-game.js');
const minorityGameLogic = require('./game-logic/minority-game.js');
const wordMafiaLogic = require('./game-logic/word-mafia.js');
const gridGameLogic = require('./game-logic/grid-game.js');
const ledGameLogic = require('./game-logic/led-game.js'); // [추가] LED 게임 로직 모듈

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 'public' 폴더를 정적 파일 제공 폴더로 설정
app.use(express.static(path.join(__dirname, 'public')));

// --- 모든 게임에서 공통으로 사용할 함수 ---
function generateRoomCode(length = 8) {
    return Math.random().toString(36).substring(2, 2 + length).toUpperCase();
}

// 각 게임 페이지 라우팅
app.get('/01.average-game', (req, res) => { res.sendFile(path.join(__dirname, 'public', '01.average-game', 'index.html')); });
app.get('/02.minority-game', (req, res) => { res.sendFile(path.join(__dirname, 'public', '02.minority-game', 'index.html')); });
app.get('/03.word-mafia', (req, res) => { res.sendFile(path.join(__dirname, 'public', '03.word-mafia', 'index.html')); });
app.get('/04.grid-game', (req, res) => { res.sendFile(path.join(__dirname, 'public', '04.grid-game', 'index.html')); });
app.get('/05.led-game', (req, res) => { res.sendFile(path.join(__dirname, 'public', '05.led-game', 'index.html')); }); // [추가] LED 게임 라우팅

// ===================================================================
// --- 각 게임 네임스페이스 로직 실행 ---
// 불러온 각 게임 로직 모듈에 io 인스턴스와 공용 함수를 전달하여 실행합니다.
// ===================================================================
averageGameLogic(io, generateRoomCode);
minorityGameLogic(io, generateRoomCode);
wordMafiaLogic(io, generateRoomCode);
gridGameLogic(io, generateRoomCode);
ledGameLogic(io, generateRoomCode); // [추가] LED 게임 로직 실행


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`));