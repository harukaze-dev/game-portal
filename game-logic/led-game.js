module.exports = (io, generateRoomCode) => {
    const ledGameNsp = io.of('/led-game');
    const ledGameRooms = {};

    ledGameNsp.on('connection', (socket) => {
        console.log(`[LED 게임] 유저 접속: ${socket.id}`);
        const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
        const MAX_PLAYERS = 12;

        function getGameState(roomCode) { return ledGameRooms[roomCode] || null; }
        
        function shuffleArray(array) {
            const newArray = [...array];
            for (let i = newArray.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
            }
            return newArray;
        }

        function startNewRound(room, nextTurnPlayerId) {
            const newTurnIndex = room.turnOrder.indexOf(nextTurnPlayerId);
            if (newTurnIndex > -1) room.turnIndex = newTurnIndex;
            room.currentTurnPlayerId = nextTurnPlayerId;
            room.state = 'playing_input';
            room.currentGuesserId = null;
            room.incorrectGuessers = [];
        }

        socket.on('createRoom', ({ playerName, profileImageSrc }) => {
            const roomCode = generateRoomCode();
            ledGameRooms[roomCode] = { code: roomCode, players: {}, state: 'waiting', maxPlayers: MAX_PLAYERS, turnOrder: [], turnIndex: 0, currentTurnPlayerId: null, currentWord: null, currentGuesserId: null, incorrectGuessers: [] };
            socket.join(roomCode);
            ledGameRooms[roomCode].players[socket.id] = { id: socket.id, name: playerName, color: PLAYER_COLORS[0], imageSrc: profileImageSrc, isHost: true, cumulativeScore: 0 };
            socket.emit('roomCreated', { roomCode });
            ledGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });

        socket.on('joinRoom', ({ roomCode, playerName, profileImageSrc }) => {
            const room = ledGameRooms[roomCode];
            if (!room) return socket.emit('error', { message: '해당하는 방이 없습니다.' });
            if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('error', { message: '방이 가득 찼습니다.' });
            if (room.state !== 'waiting') return socket.emit('error', { message: '이미 시작된 게임입니다.' });
            socket.join(roomCode);
            const usedColors = new Set(Object.values(room.players).map(p => p.color));
            const availableColor = PLAYER_COLORS.find(c => !usedColors.has(c)) || PLAYER_COLORS[0];
            room.players[socket.id] = { id: socket.id, name: playerName, color: availableColor, imageSrc: profileImageSrc, isHost: false, cumulativeScore: 0 };
            socket.emit('roomJoined', { roomCode });
            socket.to(roomCode).emit('playerJoined', { playerName });
            ledGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });
        
        socket.on('startGame', ({ roomCode }) => {
            const room = ledGameRooms[roomCode];
            if (!room || !room.players[socket.id]?.isHost || room.state !== 'waiting') return;
            room.turnOrder = shuffleArray(Object.keys(room.players));
            startNewRound(room, room.turnOrder[0]);
            room.currentWord = null;
            ledGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            ledGameNsp.to(roomCode).emit('gameStarted');
        });

        socket.on('submitWord', ({ roomCode, word }) => {
            const room = ledGameRooms[roomCode];
            if (!room || socket.id !== room.currentTurnPlayerId || word.length !== 4) return;
            const colors = ['#ef5350', '#FDD835', '#00ffc3', '#1976D2'];
            room.currentWord = {
                text: word,
                chars: word.split('').map((char, index) => ({ char: char.toUpperCase(), color: colors[index] })),
                submitterId: socket.id // [추가] 출제자 ID 기록
            };
            room.state = 'playing_guessing';
            room.currentGuesserId = null;
            room.incorrectGuessers = [];
            ledGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });

        socket.on('buzzIn', ({ roomCode }) => {
            const room = ledGameRooms[roomCode];
            if (!room || room.state !== 'playing_guessing' || room.currentGuesserId || room.incorrectGuessers.includes(socket.id)) return;
            room.state = 'playing_judging';
            room.currentGuesserId = socket.id;
            ledGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });

        socket.on('judgeAnswer', ({ roomCode, isCorrect }) => {
            const room = ledGameRooms[roomCode];
            const submitterId = room.currentWord.submitterId;
            if (!room || socket.id !== submitterId || room.state !== 'playing_judging') return;
            const guesserId = room.currentGuesserId;
            if (isCorrect) {
                const winner = room.players[guesserId];
                if(winner) winner.cumulativeScore += 1;
                room.state = 'round_end';
                room.currentTurnPlayerId = guesserId;
            } else {
                /*
                 * ===================================================================
                 *  [핵심 해결책 1] 오답 처리 로직 수정
                 *  - incorrectGuessers 목록을 현재 틀린 사람으로만 재설정합니다.
                 *  - 이로써, 이전에 틀렸던 다른 사람들은 다시 정답 시도가 가능해집니다.
                 * ===================================================================
                 */
                room.incorrectGuessers = [guesserId];
                room.currentGuesserId = null;
                room.state = 'playing_guessing';
            }
            ledGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });
        
        socket.on('resetRound', ({ roomCode }) => {
            const room = ledGameRooms[roomCode];
            if (room && room.players[socket.id]?.isHost) {
                room.state = 'waiting';
                Object.values(room.players).forEach(p => { p.cumulativeScore = 0; });
                room.turnOrder = []; room.turnIndex = 0; room.currentTurnPlayerId = null; room.currentWord = null; room.currentGuesserId = null; room.incorrectGuessers = [];
                ledGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            }
        });
        
        socket.on('disconnect', () => {
            // ... (기존 disconnect 로직 유지)
            for (const roomCode in ledGameRooms) { const room = ledGameRooms[roomCode]; if (room.players[socket.id]) { const wasHost = room.players[socket.id].isHost; const wasTurnPlayer = socket.id === room.currentTurnPlayerId; delete room.players[socket.id]; if (Object.keys(room.players).length === 0) { delete ledGameRooms[roomCode]; return; } const playerIndex = room.turnOrder.indexOf(socket.id); if (playerIndex > -1) room.turnOrder.splice(playerIndex, 1); if (wasHost && Object.keys(room.players).length > 0) { const newHostId = Object.keys(room.players)[0]; if(room.players[newHostId]) room.players[newHostId].isHost = true; } if (room.state.startsWith('playing') && wasTurnPlayer) { if (room.turnOrder.length > 0) { if (room.turnIndex >= room.turnOrder.length) room.turnIndex = 0; startNewRound(room, room.turnOrder[room.turnIndex]); room.currentWord = null; } else { room.state = 'waiting'; } } ledGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode)); break; } }
        });
    });
};