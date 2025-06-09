const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 'public' 폴더를 정적 파일 제공 폴더로 설정
app.use(express.static(path.join(__dirname, 'public')));

// 각 게임 페이지 라우팅
app.get('/average-game', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'average-game', 'index.html'));
});

app.get('/minority-game', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'minority-game', 'index.html'));
});

// ===================================================================
// --- 평균값 게임 네임스페이스 ---
// ===================================================================
const averageGameNsp = io.of('/average-game');
const averageGameRooms = {};

averageGameNsp.on('connection', (socket) => {
    console.log(`[평균값 게임] 유저 접속: ${socket.id}`);
    const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
    const MAX_PLAYERS = 12;

    function generateRoomCode() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }
    function getGameState(roomCode) { return averageGameRooms[roomCode] || null; }

    socket.on('createRoom', ({ playerName, profileImageSrc }) => {
        const roomCode = generateRoomCode();
        averageGameRooms[roomCode] = { players: {}, question: '', state: 'waiting', maxPlayers: MAX_PLAYERS, history: [] };
        socket.join(roomCode);
        averageGameRooms[roomCode].players[socket.id] = { id: socket.id, name: playerName, color: PLAYER_COLORS[0], imageSrc: profileImageSrc, value: null, submitted: false, isHost: true, cumulativeScore: 0 };
        socket.emit('roomCreated', { roomCode });
        averageGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
    });

    socket.on('joinRoom', ({ roomCode, playerName, profileImageSrc }) => {
        const room = averageGameRooms[roomCode];
        if (!room) return socket.emit('error', { message: '해당하는 방이 없습니다.' });
        if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('error', { message: '방이 가득 찼습니다.' });
        socket.join(roomCode);
        const usedColors = new Set(Object.values(room.players).map(p => p.color));
        const availableColor = PLAYER_COLORS.find(c => !usedColors.has(c)) || PLAYER_COLORS[0];
        room.players[socket.id] = { id: socket.id, name: playerName, color: availableColor, imageSrc: profileImageSrc, value: null, submitted: false, isHost: false, cumulativeScore: 0 };
        socket.emit('roomJoined', { roomCode });
        socket.to(roomCode).emit('playerJoined', { playerName });
        averageGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
    });

    socket.on('updateQuestion', ({ roomCode, question }) => {
        const room = averageGameRooms[roomCode];
        if (room && room.players[socket.id] && room.players[socket.id].isHost) {
            room.question = question;
            averageGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        }
    });

    socket.on('submitValue', ({ roomCode, value, submitted }) => {
        const room = averageGameRooms[roomCode];
        if (room && room.players[socket.id]) {
            const player = room.players[socket.id];
            player.submitted = submitted;
            player.value = submitted ? value : null;
            averageGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        }
    });

    socket.on('viewResults', ({ roomCode }) => {
        const room = averageGameRooms[roomCode];
        if (room && room.players[socket.id] && room.players[socket.id].isHost) {
            if (room.state === 'results') return;
            const players = Object.values(room.players);
            const submittedPlayers = players.filter(p => p.submitted && p.value !== null);
            if (submittedPlayers.length === 0) return;

            const total = submittedPlayers.reduce((sum, p) => sum + p.value, 0);
            const average = total / submittedPlayers.length;
            
            submittedPlayers.forEach(p => {
                p.diff = Math.abs(p.value - average);
                p.diffRatio = (average > 0) ? (p.diff / average) * 100 : (p.value === 0 ? 0 : 100);
            });
            
            players.forEach(p => { 
                if (p.submitted && p.value !== null) {
                     const diff = Math.abs(p.value - average);
                     const diffRatio = (average > 0) ? (diff / average) * 100 : (p.value === 0 ? 0 : 100);
                     p.cumulativeScore += diffRatio;
                } 
            });

            const roundResult = { question: room.question, average: average, players: JSON.parse(JSON.stringify(submittedPlayers)), timestamp: Date.now() };
            room.history.push(roundResult);
            room.state = 'results';
            averageGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        }
    });

    socket.on('resetRound', ({ roomCode }) => {
        const room = averageGameRooms[roomCode];
        if (room && room.players[socket.id] && room.players[socket.id].isHost) {
            room.state = 'waiting';
            room.question = '';
            Object.values(room.players).forEach(player => {
                player.submitted = false;
                player.value = null;
            });
            averageGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        }
    });

    socket.on('disconnect', () => {
        console.log(`[평균값 게임] 유저 접속 종료: ${socket.id}`);
        for (const roomCode in averageGameRooms) {
            const room = averageGameRooms[roomCode];
            if (room.players[socket.id]) {
                const deletedPlayerName = room.players[socket.id].name;
                const wasHost = room.players[socket.id].isHost;
                delete room.players[socket.id];
                if (Object.keys(room.players).length === 0) {
                    delete averageGameRooms[roomCode];
                } else {
                    averageGameNsp.to(roomCode).emit('playerLeft', { playerName: deletedPlayerName });
                    if (wasHost) {
                        const newHostId = Object.keys(room.players)[0];
                        room.players[newHostId].isHost = true;
                        averageGameNsp.to(roomCode).emit('newHost', { playerName: room.players[newHostId].name });
                    }
                    averageGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
                }
                break;
            }
        }
    });
});

// ===================================================================
// --- 소수결 게임 네임스페이스 ---
// ===================================================================
const minorityGameNsp = io.of('/minority-game');
const minorityGameRooms = {};

minorityGameNsp.on('connection', (socket) => {
    console.log(`[소수결 게임] 유저 접속: ${socket.id}`);
    const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
    const MAX_PLAYERS = 12;
    function generateRoomCode() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }
    function getGameState(roomCode) { return minorityGameRooms[roomCode] || null; }

    socket.on('createRoom', ({ playerName, profileImageSrc }) => {
        const roomCode = generateRoomCode();
        minorityGameRooms[roomCode] = { players: {}, optionA: '', optionB: '', state: 'waiting', maxPlayers: MAX_PLAYERS, history: [] };
        socket.join(roomCode);
        minorityGameRooms[roomCode].players[socket.id] = { id: socket.id, name: playerName, color: PLAYER_COLORS[0], imageSrc: profileImageSrc, choice: null, submitted: false, isHost: true, cumulativeScore: 0 };
        socket.emit('roomCreated', { roomCode });
        minorityGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
    });

    socket.on('joinRoom', ({ roomCode, playerName, profileImageSrc }) => {
        const room = minorityGameRooms[roomCode];
        if (!room) return socket.emit('error', { message: '해당하는 방이 없습니다.' });
        if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('error', { message: '방이 가득 찼습니다.' });
        socket.join(roomCode);
        const usedColors = new Set(Object.values(room.players).map(p => p.color));
        const availableColor = PLAYER_COLORS.find(c => !usedColors.has(c)) || PLAYER_COLORS[0];
        room.players[socket.id] = { id: socket.id, name: playerName, color: availableColor, imageSrc: profileImageSrc, choice: null, submitted: false, isHost: false, cumulativeScore: 0 };
        socket.emit('roomJoined', { roomCode });
        socket.to(roomCode).emit('playerJoined', { playerName });
        minorityGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
    });

    socket.on('updateOptions', ({ roomCode, optionA, optionB }) => {
        const room = minorityGameRooms[roomCode];
        if (room && room.players[socket.id] && room.players[socket.id].isHost) {
            if (optionA === '' && optionB === '') {
                Object.values(room.players).forEach(player => {
                    player.submitted = false;
                    player.choice = null;
                });
            }
            room.optionA = optionA;
            room.optionB = optionB;
            minorityGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        }
    });

    socket.on('submitChoice', ({ roomCode, choice }) => {
        const room = minorityGameRooms[roomCode];
        if (room && room.players[socket.id]) {
            const player = room.players[socket.id];
            player.submitted = choice !== null;
            player.choice = choice;
            minorityGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        }
    });

    socket.on('viewResults', ({ roomCode }) => {
        const room = minorityGameRooms[roomCode];
        if (room && room.players[socket.id] && room.players[socket.id].isHost) {
            if (room.state === 'results') return;
            const players = Object.values(room.players);
            const submittedPlayers = players.filter(p => p.submitted);
            if (submittedPlayers.length === 0) return;

            const votes = { 'A': 0, 'B': 0 };
            submittedPlayers.forEach(p => { if (p.choice in votes) { votes[p.choice]++; } });

            let winningChoice = null;
            if (votes['A'] > 0 && votes['B'] > 0) {
                if (votes['A'] < votes['B']) winningChoice = 'A';
                else if (votes['B'] < votes['A']) winningChoice = 'B';
            }

            if (winningChoice) {
                players.forEach(p => { if (p.choice === winningChoice) p.cumulativeScore += 1; });
            }

            const roundResult = { optionA: room.optionA, optionB: room.optionB, votes: votes, winningChoice: winningChoice, players: JSON.parse(JSON.stringify(submittedPlayers)), timestamp: Date.now() };
            room.history.push(roundResult);
            room.state = 'results';
            minorityGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        }
    });

    socket.on('resetRound', ({ roomCode }) => {
        const room = minorityGameRooms[roomCode];
        if (room && room.players[socket.id] && room.players[socket.id].isHost) {
            room.state = 'waiting';
            room.optionA = '';
            room.optionB = '';
            Object.values(room.players).forEach(player => {
                player.submitted = false;
                player.choice = null;
            });
            minorityGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        }
    });

    socket.on('disconnect', () => {
        console.log(`[소수결 게임] 유저 접속 종료: ${socket.id}`);
        for (const roomCode in minorityGameRooms) {
            const room = minorityGameRooms[roomCode];
            if (room.players[socket.id]) {
                const deletedPlayerName = room.players[socket.id].name;
                const wasHost = room.players[socket.id].isHost;
                delete room.players[socket.id];
                if (Object.keys(room.players).length === 0) {
                    delete minorityGameRooms[roomCode];
                } else {
                    minorityGameNsp.to(roomCode).emit('playerLeft', { playerName: deletedPlayerName });
                    if (wasHost) {
                        const newHostId = Object.keys(room.players)[0];
                        room.players[newHostId].isHost = true;
                        minorityGameNsp.to(roomCode).emit('newHost', { playerName: room.players[newHostId].name });
                    }
                    minorityGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`));