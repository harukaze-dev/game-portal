module.exports = (io, generateRoomCode) => {
    // ===================================================================
    // --- XX평 게임 네임스페이스 ---
    // ===================================================================
    const averageGameNsp = io.of('/average-game');
    const averageGameRooms = {};

    averageGameNsp.on('connection', (socket) => {
        console.log(`[XX평 게임] 유저 접속: ${socket.id}`);
        const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
        const MAX_PLAYERS = 12;

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
            console.log(`[XX평 게임] 유저 접속 종료: ${socket.id}`);
            for (const roomCode in averageGameRooms) {
                const room = averageGameRooms[roomCode];
                if (room.players[socket.id]) {
                    const deletedPlayerName = room.players[socket.id].name;
                    const wasHost = room.players[socket.id].isHost;
                    delete room.players[socket.id];
                    if (Object.keys(room.players).length === 0) {
                        delete averageGameRooms[roomCode];
                        console.log(`[XX평 게임] 방 ${roomCode}가 비어서 삭제되었습니다.`);
                    } else {
                        averageGameNsp.to(roomCode).emit('playerLeft', { playerName: deletedPlayerName });
                        if (wasHost && Object.keys(room.players).length > 0) {
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
};