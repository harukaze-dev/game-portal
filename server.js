const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const wordMafiaTopics = require('./public/03.word-mafia/word-mafia-data.js'); 

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 'public' 폴더를 정적 파일 제공 폴더로 설정
app.use(express.static(path.join(__dirname, 'public')));

// 각 게임 페이지 라우팅
app.get('/01.average-game', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'average-game', 'index.html')); });
app.get('/02.minority-game', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'minority-game', 'index.html')); });
app.get('/03.word-mafia', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'word-mafia', 'index.html')); });

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

            const allSubmitted = players.every(p => p.submitted);
            if (!allSubmitted) return;

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
                    console.log(`[평균값 게임] 방 ${roomCode}가 비어서 삭제되었습니다.`);
                } else {
                    averageGameNsp.to(roomCode).emit('playerLeft', { playerName: deletedPlayerName });
                    if (wasHost) {
                        const newHostId = Object.keys(room.players)[0];
                        if (room.players[newHostId]) {
                            room.players[newHostId].isHost = true;
                            averageGameNsp.to(roomCode).emit('newHost', { playerName: room.players[newHostId].name });
                        }
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
                    console.log(`[소수결 게임] 방 ${roomCode}가 비어서 삭제되었습니다.`);
                } else {
                    minorityGameNsp.to(roomCode).emit('playerLeft', { playerName: deletedPlayerName });
                    if (wasHost) {
                        const newHostId = Object.keys(room.players)[0];
                        if (room.players[newHostId]) {
                            room.players[newHostId].isHost = true;
                            minorityGameNsp.to(roomCode).emit('newHost', { playerName: room.players[newHostId].name });
                        }
                    }
                    minorityGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
                }
                break;
            }
        }
    });
});

// ===================================================================
// --- 워드 마피아 게임 네임스페이스 ---
// ===================================================================
const wordMafiaNsp = io.of('/word-mafia');
const wordMafiaRooms = {};

wordMafiaNsp.on('connection', (socket) => {
    console.log(`[워드 마피아] 유저 접속: ${socket.id}`);
    const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
    const MAX_PLAYERS = 12;

    function generateRoomCode() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }
    function getGameState(roomCode) { return wordMafiaRooms[roomCode] || null; }

    function resetGame(room) {
        room.state = 'waiting';
        // room.mainTopic = ''; // [수정됨] 대분류 제거
        room.citizenWord = '';
        room.mafiaWord = '';
        room.mafiaId = null;
        room.votes = {};
        room.votedOutPlayerId = null;
        room.roundResult = null;
        room.participants = [];
        if(room.players) {
            Object.values(room.players).forEach(p => {
                p.word = null;
                p.isMafia = false;
                p.votedFor = null;
                p.isDead = false;
                p.submitted = false;
            });
        }
    }

    socket.on('createRoom', ({ playerName, profileImageSrc }) => {
        const roomCode = generateRoomCode();
        wordMafiaRooms[roomCode] = { players: {}, maxPlayers: MAX_PLAYERS };
        resetGame(wordMafiaRooms[roomCode]);
        socket.join(roomCode);
        wordMafiaRooms[roomCode].players[socket.id] = { id: socket.id, name: playerName, color: PLAYER_COLORS[0], imageSrc: profileImageSrc, isHost: true, cumulativeScore: 0 };
        socket.emit('roomCreated', { roomCode });
        wordMafiaNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
    });

    socket.on('joinRoom', ({ roomCode, playerName, profileImageSrc }) => {
        const room = wordMafiaRooms[roomCode];
        if (!room) return socket.emit('error', { message: '해당하는 방이 없습니다.' });
        if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('error', { message: '방이 가득 찼습니다.' });
        
        if (room.state !== 'waiting') {
            return socket.emit('error', { message: '이미 게임이 시작되어 참여할 수 없습니다.' });
        }

        socket.join(roomCode);
        const usedColors = new Set(Object.values(room.players).map(p => p.color));
        const availableColor = PLAYER_COLORS.find(c => !usedColors.has(c)) || PLAYER_COLORS[0];
        room.players[socket.id] = { id: socket.id, name: playerName, color: availableColor, imageSrc: profileImageSrc, isHost: false, cumulativeScore: 0 };
        socket.emit('roomJoined', { roomCode });
        socket.to(roomCode).emit('playerJoined', { playerName });
        wordMafiaNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
    });
    
    socket.on('startGame', ({ roomCode }) => {
        const room = wordMafiaRooms[roomCode];
        if (!room || !room.players[socket.id]?.isHost) return;
        const players = Object.values(room.players);
        if (players.length < 3) return socket.emit('error', { message: '마피아 게임은 3명 이상부터 가능합니다.' });

        room.participants = players.map(p => p.id);

        // --- [수정됨] 여기가 핵심 변경 사항입니다 ---

        // 1. wordMafiaTopics에서 주제어 세트(배열)를 무작위로 하나 선택합니다.
        //    이 세트에는 2개 이상의 단어가 들어있을 수 있습니다. (e.g., ['강아지', '고양이', '햄스터'])
        const randomWordSet = wordMafiaTopics[Math.floor(Math.random() * wordMafiaTopics.length)];

        // 2. 선택된 단어 세트의 순서를 무작위로 섞습니다.
        //    예: ['강아지', '고양이', '햄스터'] -> ['고양이', '햄스터', '강아지']
        const shuffledWords = [...randomWordSet].sort(() => Math.random() - 0.5);

        // 3. 섞인 배열에서 앞의 두 단어를 시민과 마피아에게 각각 할당합니다.
        //    이렇게 하면 3개 이상의 단어 세트에서도 무작위로 2개의 단어가 선택됩니다.
        //    예: 시민 = '고양이', 마피아 = '햄스터'
        room.citizenWord = shuffledWords[0];
        room.mafiaWord = shuffledWords[1];
        // ------------------------------------

        const mafiaIndex = Math.floor(Math.random() * players.length);
        room.mafiaId = players[mafiaIndex].id;

        players.forEach(p => {
            p.isMafia = p.id === room.mafiaId;
            p.word = p.isMafia ? room.mafiaWord : room.citizenWord;
            p.votedFor = null;
            p.isDead = false;
        });

        room.state = 'voting';
        wordMafiaNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
    });

    socket.on('revealVotes', ({ roomCode }) => {
        const room = wordMafiaRooms[roomCode];
        if (!room || !room.players[socket.id]?.isHost) return;
        
        const livingParticipants = Object.values(room.players).filter(p => room.participants.includes(p.id) && !p.isDead);
        const allVoted = livingParticipants.every(p => p.votedFor !== null);
        if (!allVoted) return;

        room.votes = {};
        livingParticipants.forEach(p => {
            const voteTarget = p.votedFor;
            if (voteTarget) room.votes[voteTarget] = (room.votes[voteTarget] || 0) + 1;
        });
        
        let maxVotes = 0;
        let votedOutPlayerId = null;
        let tie = false;
        for (const playerId in room.votes) {
            if (room.votes[playerId] > maxVotes) {
                maxVotes = room.votes[playerId];
                votedOutPlayerId = playerId;
                tie = false;
            } else if (room.votes[playerId] === maxVotes) {
                tie = true;
            }
        }
        if (tie) votedOutPlayerId = null;
        room.votedOutPlayerId = votedOutPlayerId;

        if (votedOutPlayerId && votedOutPlayerId === room.mafiaId) {
            room.state = 'finalGuess';
        } else {
            room.state = 'result';
            const winner = 'mafia';
            room.roundResult = { winner, votedOutPlayerId };
            Object.values(room.players).forEach(p => {
                if (p.isMafia) p.cumulativeScore += 1;
            });
        }
        wordMafiaNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
    });
    
    socket.on('vote', ({ roomCode, targetId }) => {
        const room = wordMafiaRooms[roomCode];
        if (!room || !room.players[socket.id] || !room.participants.includes(socket.id) || room.players[socket.id].isDead) {
            return;
        }
        
        const voter = room.players[socket.id];
        voter.votedFor = targetId;
        voter.submitted = (targetId !== null);
        
        wordMafiaNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
    });
    
    socket.on('finalGuess', ({ roomCode, guessWord }) => {
        const room = wordMafiaRooms[roomCode];
        if (!room || !room.players[socket.id] || !room.players[socket.id].isMafia) return;

        let winner = (guessWord.trim().toLowerCase() === room.citizenWord.toLowerCase()) ? 'mafia' : 'citizen';
        room.state = 'result';
        room.roundResult = { winner, votedOutPlayerId: room.votedOutPlayerId, finalGuess: guessWord };
        
        Object.values(room.players).forEach(p => {
            if ((winner === 'citizen' && !p.isMafia) || (winner === 'mafia' && p.isMafia)) p.cumulativeScore += 1;
        });
        wordMafiaNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
    });

    socket.on('nextRound', ({ roomCode }) => {
        const room = wordMafiaRooms[roomCode];
        if (room && room.players[socket.id]?.isHost) {
            resetGame(room);
            wordMafiaNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        }
    });

    socket.on('disconnect', () => {
        console.log(`[워드 마피아] 유저 접속 종료: ${socket.id}`);
        for (const roomCode in wordMafiaRooms) {
            const room = wordMafiaRooms[roomCode];
            if (room.players[socket.id]) {
                const deletedPlayerName = room.players[socket.id].name;
                const wasHost = room.players[socket.id].isHost;
                delete room.players[socket.id];
                if (Object.keys(room.players).length === 0) {
                    delete wordMafiaRooms[roomCode];
                    console.log(`[워드 마피아] 방 ${roomCode}가 비어서 삭제되었습니다.`);
                } else {
                    wordMafiaNsp.to(roomCode).emit('playerLeft', { playerName: deletedPlayerName });
                    if (wasHost && Object.keys(room.players).length > 0) {
                        const newHostId = Object.keys(room.players)[0];
                        if(room.players[newHostId]){
                           room.players[newHostId].isHost = true;
                           wordMafiaNsp.to(roomCode).emit('newHost', { playerName: room.players[newHostId].name });
                        }
                    }
                     if(room.state !== 'waiting' && room.participants.includes(socket.id) && Object.values(room.players).filter(p => room.participants.includes(p.id) && !p.isDead).length <= 2) {
                        room.state = 'result';
                        room.roundResult = { winner: 'mafia', votedOutPlayerId: null };
                    }
                    wordMafiaNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버가 ${PORT}번 포트에서 실행 중입니다.`));