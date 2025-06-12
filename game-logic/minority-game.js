module.exports = (io, generateRoomCode) => {
    // ===================================================================
    // --- 소수결 게임 네임스페이스 ---
    // ===================================================================
    const minorityGameNsp = io.of('/minority-game');
    const minorityGameRooms = {};

    minorityGameNsp.on('connection', (socket) => {
        console.log(`[소수결 게임] 유저 접속: ${socket.id}`);
        const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
        const MAX_PLAYERS = 12;
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
                        if (wasHost && Object.keys(room.players).length > 0) {
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
};