// game-logic/name-game.js

// '얘의 이름은?' 게임 서버 로직
module.exports = (io, generateRoomCode, imageDB) => {
    const gameNsp = io.of('/name-game');
    let rooms = {};

    function shuffle(array) {
        let currentIndex = array.length, randomIndex;
        while (currentIndex !== 0) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;
            [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
        }
        return array;
    }

    function createNewGameState(hostId, hostName, hostImageSrc, roomCode) {
        return {
            roomCode: roomCode,
            players: {
                [hostId]: {
                    id: hostId, name: hostName, imageSrc: hostImageSrc, isHost: true, score: 0,
                    color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
                }
            },
            maxPlayers: 8, state: 'waiting', turnOrder: [], currentTurnIndex: 0,
            gameImages: [], deck: [], graveyard: [], namedMonsters: {},
            lastDrawnCard: null, isNamingPhase: false,
            timeLimitStartedAt: null,
        };
    }

    function advanceTurn(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;
        
        if (room.timeLimitTimer) {
            clearTimeout(room.timeLimitTimer);
            room.timeLimitTimer = null;
        }

        room.gameState.currentTurnIndex = (room.gameState.currentTurnIndex + 1) % room.gameState.turnOrder.length;
        room.gameState.lastDrawnCard = null;
        room.gameState.isNamingPhase = false;
        room.gameState.timeLimitStartedAt = null;
    }

    gameNsp.on('connection', (socket) => {
        const playerId = socket.id;

        socket.on('createRoom', ({ playerName, profileImageSrc }) => {
            if (!playerName || playerName.length > 8) return socket.emit('error', { message: '닉네임은 1~8자로 설정해주세요.' });
            const roomCode = generateRoomCode();
            rooms[roomCode] = { gameState: createNewGameState(playerId, playerName, profileImageSrc, roomCode), hostId: playerId, timeLimitTimer: null };
            socket.join(roomCode);
            socket.emit('roomCreated', { roomCode });
            gameNsp.to(roomCode).emit('updateGameState', rooms[roomCode].gameState);
        });

        socket.on('joinRoom', ({ roomCode, playerName, profileImageSrc }) => {
            const room = rooms[roomCode];
            if (!room) return socket.emit('error', { message: '존재하지 않는 방입니다.' });
            if (Object.keys(room.gameState.players).length >= room.gameState.maxPlayers) return socket.emit('error', { message: '방이 가득 찼습니다.' });
            if (!playerName || playerName.length > 8) return socket.emit('error', { message: '닉네임은 1~8자로 설정해주세요.' });
            room.gameState.players[playerId] = {
                id: playerId, name: playerName, imageSrc: profileImageSrc, isHost: false, score: 0,
                color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
            };
            socket.join(roomCode);
            socket.emit('roomJoined', { roomCode });
            gameNsp.to(roomCode).emit('playerJoined', { playerName });
            gameNsp.to(roomCode).emit('updateGameState', room.gameState);
        });

        socket.on('startGame', ({ roomCode }) => {
            const room = rooms[roomCode];
            if (!room || room.hostId !== playerId || room.gameState.state !== 'waiting') return;
            const gameState = room.gameState;
            gameState.gameImages = shuffle([...imageDB]).slice(0, 16);
            gameState.deck = gameState.gameImages.flatMap(img => Array(5).fill(img));
            shuffle(gameState.deck);
            gameState.turnOrder = shuffle(Object.keys(gameState.players));
            gameState.currentTurnIndex = 0;
            gameState.state = 'playing';
            gameState.graveyard = []; gameState.namedMonsters = {}; gameState.lastDrawnCard = null;
            gameNsp.to(roomCode).emit('gameStarted');
            gameNsp.to(roomCode).emit('updateGameState', gameState);
        });

        socket.on('drawCard', ({ roomCode }) => {
            const room = rooms[roomCode];
            if (!room) return;
            const gameState = room.gameState;
            const currentTurnPlayerId = gameState.turnOrder[gameState.currentTurnIndex];
            if (playerId !== currentTurnPlayerId || gameState.deck.length === 0 || gameState.lastDrawnCard) return;

            const drawnCard = gameState.deck.pop();
            gameState.lastDrawnCard = drawnCard;
            gameState.isNamingPhase = !gameState.namedMonsters[drawnCard.id];
            gameState.timeLimitStartedAt = Date.now();

            if (room.timeLimitTimer) clearTimeout(room.timeLimitTimer);
            
            // [핵심 수정] 타이머를 15초로 변경
            room.timeLimitTimer = setTimeout(() => {
                if (!rooms[roomCode]) return;
                
                gameState.graveyard.push(drawnCard);
                gameNsp.to(roomCode).emit('timeUp', { namer: gameState.players[currentTurnPlayerId].name });
                
                advanceTurn(roomCode);
                
                if (gameState.deck.length === 0) {
                    gameState.state = 'game_over';
                }
                gameNsp.to(roomCode).emit('updateGameState', gameState);
            }, 15000); // 15초

            gameNsp.to(roomCode).emit('updateGameState', gameState);
        });

        socket.on('nameMonster', ({ roomCode, monsterName }) => {
            const room = rooms[roomCode];
            if (!room) return;
            const gameState = room.gameState;
            const currentTurnPlayerId = gameState.turnOrder[gameState.currentTurnIndex];

            if (playerId !== currentTurnPlayerId || !gameState.isNamingPhase || !gameState.lastDrawnCard) return;
            if (!monsterName || monsterName.length < 4 || !/^[가-힣]+$/.test(monsterName)) {
                return socket.emit('error', { message: '이름은 4글자 이상의 한글로만 지어주세요.' });
            }

            if (room.timeLimitTimer) {
                clearTimeout(room.timeLimitTimer);
                room.timeLimitTimer = null;
            }

            const card = gameState.lastDrawnCard;
            gameState.namedMonsters[card.id] = monsterName;
            gameState.graveyard.push(card);
            
            gameNsp.to(roomCode).emit('monsterNamed', { 
                namer: gameState.players[playerId].name,
                imagePath: card.path,
                assignedName: monsterName 
            });

            advanceTurn(roomCode);
            if (gameState.deck.length === 0) gameState.state = 'game_over';
            gameNsp.to(roomCode).emit('updateGameState', gameState);
        });

        socket.on('guessName', ({ roomCode, guess }) => {
            const room = rooms[roomCode];
            if (!room) return;
            const gameState = room.gameState;

            if (gameState.state !== 'playing' || gameState.isNamingPhase || !gameState.lastDrawnCard) return;

            const correctName = gameState.namedMonsters[gameState.lastDrawnCard.id];
            
            if (correctName && guess === correctName) {
                if (room.timeLimitTimer) {
                    clearTimeout(room.timeLimitTimer);
                    room.timeLimitTimer = null;
                }

                const card = gameState.lastDrawnCard;
                const earnedPoints = gameState.graveyard.length + 1;
                gameState.players[playerId].score += earnedPoints;
                gameState.graveyard = [];

                gameNsp.to(roomCode).emit('correctGuess', {
                    winnerName: gameState.players[playerId].name, correctName: correctName,
                    imagePath: card.path, points: earnedPoints
                });

                advanceTurn(roomCode);
                if (gameState.deck.length === 0) gameState.state = 'game_over';
                gameNsp.to(roomCode).emit('updateGameState', gameState);
            }
        });

        socket.on('resetGame', ({ roomCode }) => {
            const room = rooms[roomCode];
            if (room && room.hostId === playerId) {
                 if (room.timeLimitTimer) { clearTimeout(room.timeLimitTimer); room.timeLimitTimer = null; }
                const players = room.gameState.players;
                const newGameState = createNewGameState(room.hostId, players[room.hostId].name, players[room.hostId].imageSrc, roomCode);
                Object.values(players).forEach(p => { newGameState.players[p.id] = { ...p, score: 0 }; });
                rooms[roomCode].gameState = newGameState;
                gameNsp.to(roomCode).emit('updateGameState', newGameState);
            }
        });
        
        socket.on('disconnect', () => {
            let roomCodeToDelete = null;
            for (const roomCode in rooms) {
                const room = rooms[roomCode];
                if (room.gameState.players[playerId]) {
                    if (room.timeLimitTimer) { clearTimeout(room.timeLimitTimer); room.timeLimitTimer = null; }
                    const playerName = room.gameState.players[playerId].name;
                    delete room.gameState.players[playerId];
                    if (Object.keys(room.gameState.players).length === 0) {
                        roomCodeToDelete = roomCode;
                    } else {
                        if (room.hostId === playerId) {
                            const newHostId = Object.keys(room.gameState.players)[0];
                            room.hostId = newHostId;
                            room.gameState.players[newHostId].isHost = true;
                            gameNsp.to(roomCode).emit('newHost', { playerName: room.gameState.players[newHostId].name });
                        }
                        gameNsp.to(roomCode).emit('playerLeft', { playerName });
                        gameNsp.to(roomCode).emit('updateGameState', room.gameState);
                    }
                    break;
                }
            }
            if (roomCodeToDelete) delete rooms[roomCodeToDelete];
        });
    });
};