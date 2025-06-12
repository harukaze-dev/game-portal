// word-mafia-data.js 파일의 경로가 'game-logic' 폴더 기준으로 변경되었습니다.
const wordMafiaTopics = require('../public/03.word-mafia/word-mafia-data.js');

module.exports = (io, generateRoomCode) => {
    // ===================================================================
    // --- 워드 마피아 게임 네임스페이스 ---
    // ===================================================================
    const wordMafiaNsp = io.of('/word-mafia');
    const wordMafiaRooms = {};

    wordMafiaNsp.on('connection', (socket) => {
        console.log(`[워드 마피아] 유저 접속: ${socket.id}`);
        const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
        const MAX_PLAYERS = 12;

        function getGameState(roomCode) { return wordMafiaRooms[roomCode] || null; }

        function resetGame(room) {
            room.state = 'waiting';
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

            const randomWordSet = wordMafiaTopics[Math.floor(Math.random() * wordMafiaTopics.length)];
            const shuffledWords = [...randomWordSet].sort(() => Math.random() - 0.5);

            room.citizenWord = shuffledWords[0];
            room.mafiaWord = shuffledWords[1];

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
};