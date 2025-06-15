// [수정] game-logic/pokemon-game.js
// '포켓몬게임' 서버 로직 파일

module.exports = (io, generateRoomCode, pokemonDB) => {
    const pokemonGameNsp = io.of('/pokemon-game');
    const pokemonGameRooms = {};

    pokemonGameNsp.on('connection', (socket) => {
        console.log(`[포켓몬게임] 유저 접속: ${socket.id}`);

        const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
        const MAX_PLAYERS = 12;

        function getGameState(roomCode) {
            return pokemonGameRooms[roomCode] || null;
        }

        function shuffleArray(array) {
            const newArray = [...array];
            for (let i = newArray.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
            }
            return newArray;
        }

        function startNewRound(room) {
            const difficultyMap = { easy: 2, normal: 3, hard: 4 };
            const gridSize = difficultyMap[room.difficulty] || 4;
            const totalPokemons = gridSize * gridSize;

            const answerPokemon = { ...pokemonDB[Math.floor(Math.random() * pokemonDB.length)] };
            const decoys = [];
            const tempDB = shuffleArray(pokemonDB);
            for (const pokemon of tempDB) {
                if (decoys.length >= totalPokemons - 1) break;
                if (pokemon.id !== answerPokemon.id) {
                    decoys.push(pokemon);
                }
            }
            const gridPokemons = shuffleArray([answerPokemon, ...decoys]);
            room.state = 'playing_guessing';
            room.currentPokemon = answerPokemon;
            room.gridPokemons = gridPokemons;
            room.winnerId = null;
        }

        function startNextRoundSequence(roomCode) {
            const room = pokemonGameRooms[roomCode];
            if (!room) return;

            setTimeout(() => {
                let count = 3; 
                function countdown() {
                    const currentRoomForCountdown = pokemonGameRooms[roomCode];
                    if (!currentRoomForCountdown) return;

                    if (count > 0) {
                        pokemonGameNsp.to(roomCode).emit('countdownTick', { count });
                        count--;
                        setTimeout(countdown, 500);
                    } else {
                        startNewRound(currentRoomForCountdown);
                        pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
                    }
                }
                countdown();
            }, 1500); 
        }

        // --- 소켓 이벤트 핸들러 ---
        socket.on('createRoom', ({ playerName, profileImageSrc }) => {
            const roomCode = generateRoomCode();
            pokemonGameRooms[roomCode] = {
                code: roomCode, players: {}, state: 'waiting', maxPlayers: MAX_PLAYERS,
                difficulty: 'hard',
                currentPokemon: null, gridPokemons: [], winnerId: null
            };
            socket.join(roomCode);
            pokemonGameRooms[roomCode].players[socket.id] = { id: socket.id, name: playerName, color: PLAYER_COLORS[0], imageSrc: profileImageSrc, isHost: true, cumulativeScore: 0 };
            socket.emit('roomCreated', { roomCode });
            pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });
        
        socket.on('changeDifficulty', ({ roomCode, newDifficulty }) => {
            const room = pokemonGameRooms[roomCode];
            if (room && room.players[socket.id]?.isHost && room.state === 'waiting') {
                if (['easy', 'normal', 'hard'].includes(newDifficulty)) {
                    room.difficulty = newDifficulty;
                    pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
                }
            }
        });

        socket.on('joinRoom', ({ roomCode, playerName, profileImageSrc }) => {
            const room = pokemonGameRooms[roomCode];
            if (!room) return socket.emit('error', { message: '해당하는 방이 없습니다.' });
            if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('error', { message: '방이 가득 찼습니다.' });
            if (room.state !== 'waiting') return socket.emit('error', { message: '이미 시작된 게임입니다.' });
            socket.join(roomCode);
            const usedColors = new Set(Object.values(room.players).map(p => p.color));
            const availableColor = PLAYER_COLORS.find(c => !usedColors.has(c)) || PLAYER_COLORS[0];
            room.players[socket.id] = { id: socket.id, name: playerName, color: availableColor, imageSrc: profileImageSrc, isHost: false, cumulativeScore: 0 };
            socket.emit('roomJoined', { roomCode });
            socket.to(roomCode).emit('playerJoined', { playerName });
            pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });
        
        socket.on('startGame', ({ roomCode }) => {
            const room = pokemonGameRooms[roomCode];
            if (!room || !room.players[socket.id]?.isHost || room.state !== 'waiting') return;
            startNewRound(room);
            pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            pokemonGameNsp.to(roomCode).emit('gameStarted');
        });

        socket.on('guessPokemon', ({ roomCode, pokemonId }) => {
            const room = pokemonGameRooms[roomCode];
            if (!room || room.state !== 'playing_guessing' || room.winnerId || !room.currentPokemon) return;
            
            if (pokemonId === room.currentPokemon.id) {
                const winner = room.players[socket.id];
                if (winner) {
                    winner.cumulativeScore += 2;
                    room.winnerId = socket.id;
                    room.state = 'round_end';
                    pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
                    startNextRoundSequence(roomCode);
                }
            } else {
                const player = room.players[socket.id];
                if(player) {
                    // [핵심 수정] Math.max를 사용하여 점수가 0 미만으로 내려가지 않도록 함
                    player.cumulativeScore = Math.max(0, player.cumulativeScore - 1);
                }
                socket.emit('guessResult', { isCorrect: false });
                pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            }
        });
        
        socket.on('resetGame', ({ roomCode }) => {
            const room = pokemonGameRooms[roomCode];
            if (room && room.players[socket.id]?.isHost) {
                room.state = 'waiting';
                room.difficulty = 'hard';
                Object.values(room.players).forEach(p => { p.cumulativeScore = 0; });
                room.currentPokemon = null;
                room.gridPokemons = [];
                room.winnerId = null;
                pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            }
        });
        
        socket.on('disconnect', () => {
            for (const roomCode in pokemonGameRooms) { 
                const room = pokemonGameRooms[roomCode]; 
                if (room.players[socket.id]) { 
                    const wasHost = room.players[socket.id].isHost; 
                    const playerName = room.players[socket.id].name;
                    delete room.players[socket.id]; 

                    if (Object.keys(room.players).length === 0) { 
                        delete pokemonGameRooms[roomCode]; 
                        console.log(`[포켓몬게임] 방 삭제: ${roomCode}`);
                        return; 
                    } 
                    
                    socket.to(roomCode).emit('playerLeft', { playerName });

                    if (wasHost && Object.keys(room.players).length > 0) { 
                        const newHostId = Object.keys(room.players)[0]; 
                        if(room.players[newHostId]) {
                            room.players[newHostId].isHost = true;
                            socket.to(roomCode).emit('newHost', { playerName: room.players[newHostId].name });
                        }
                    } 
                    
                    if (room.state !== 'waiting' && Object.keys(room.players).length <= 1) {
                        room.state = 'waiting';
                        room.currentPokemon = null;
                        room.gridPokemons = [];
                        room.winnerId = null;
                    }
                    
                    pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode)); 
                    break; 
                } 
            }
        });
    });
};