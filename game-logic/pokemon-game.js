// [수정] game-logic/pokemon-game.js
// '포켓몬게임' 서버 로직 파일
// 이 파일은 서버에서 실행되며, 클라이언트의 접속과 게임 로직을 처리합니다.
// module.exports로 시작하는 것이 정상입니다.

module.exports = (io, generateRoomCode, pokemonDB) => {
    // 네임스페이스와 게임 방 목록 객체 초기화
    const pokemonGameNsp = io.of('/pokemon-game');
    const pokemonGameRooms = {};

    pokemonGameNsp.on('connection', (socket) => {
        console.log(`[포켓몬게임] 유저 접속: ${socket.id}`);

        // --- 게임 설정 및 유틸리티 함수 ---
        const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
        const MAX_PLAYERS = 12;

        // 방의 현재 게임 상태를 가져오는 함수
        function getGameState(roomCode) {
            return pokemonGameRooms[roomCode] || null;
        }

        // 배열을 무작위로 섞는 함수 (피셔-예이츠 셔플)
        function shuffleArray(array) {
            const newArray = [...array];
            for (let i = newArray.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
            }
            return newArray;
        }

        // 새 라운드를 시작하는 함수
        function startNewRound(room) {
            // 난이도에 따른 그리드 크기 설정
            const difficultyMap = { easy: 2, normal: 3, hard: 4 };
            const gridSize = difficultyMap[room.difficulty] || 4;
            const totalPokemons = gridSize * gridSize;

            // 정답 포켓몬과 오답 포켓몬(더미)들을 설정
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
            
            // 라운드 시작을 위한 상태 업데이트
            room.state = 'playing_guessing';
            room.currentPokemon = answerPokemon;
            room.gridPokemons = gridPokemons;
            room.winnerId = null;
        }

        // 다음 라운드를 시작하기 전 카운트다운을 진행하는 함수
        function startNextRoundSequence(roomCode) {
            const room = pokemonGameRooms[roomCode];
            if (!room) return;

            // 1.5초 후 카운트다운 시작
            setTimeout(() => {
                let count = 3; 
                function countdown() {
                    const currentRoomForCountdown = pokemonGameRooms[roomCode];
                    if (!currentRoomForCountdown) return;

                    if (count > 0) {
                        pokemonGameNsp.to(roomCode).emit('countdownTick', { count });
                        count--;
                        setTimeout(countdown, 500); // 0.5초마다 카운트
                    } else {
                        // 카운트다운이 끝나면 새 라운드 시작
                        startNewRound(currentRoomForCountdown);
                        pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
                    }
                }
                countdown();
            }, 1500); 
        }

        // --- 소켓 이벤트 핸들러 ---

        // '방 만들기' 이벤트 처리
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
        
        // '난이도 변경' 이벤트 처리 (방장만 가능)
        socket.on('changeDifficulty', ({ roomCode, newDifficulty }) => {
            const room = pokemonGameRooms[roomCode];
            if (room && room.players[socket.id]?.isHost && room.state === 'waiting') {
                if (['easy', 'normal', 'hard'].includes(newDifficulty)) {
                    room.difficulty = newDifficulty;
                    pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
                }
            }
        });

        // '방 참가' 이벤트 처리
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
        
        // '게임 시작' 이벤트 처리 (방장만 가능)
        socket.on('startGame', ({ roomCode }) => {
            const room = pokemonGameRooms[roomCode];
            if (!room || !room.players[socket.id]?.isHost || room.state !== 'waiting') return;
            startNewRound(room);
            pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            pokemonGameNsp.to(roomCode).emit('gameStarted');
        });

        // '포켓몬 추측' 이벤트 처리
        socket.on('guessPokemon', ({ roomCode, pokemonId }) => {
            const room = pokemonGameRooms[roomCode];
            if (!room || room.state !== 'playing_guessing' || room.winnerId || !room.currentPokemon) return;
            
            // 정답을 맞혔을 경우
            if (pokemonId === room.currentPokemon.id) {
                const winner = room.players[socket.id];
                if (winner) {
                    winner.cumulativeScore += 2; // 점수 획득
                    room.winnerId = socket.id;
                    room.state = 'round_end'; // 라운드 종료 상태로 변경
                    pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
                    startNextRoundSequence(roomCode); // 다음 라운드 준비
                }
            } else { // 오답을 선택했을 경우
                const player = room.players[socket.id];
                if(player) {
                    player.cumulativeScore = Math.max(0, player.cumulativeScore - 1); // 점수 감점 (0점 미만 방지)
                }

                // 오답을 선택했음을 방 전체에 알립니다.
                // 오답자 ID와 이름을 함께 보내 클라이언트에서 페널티를 차등 적용할 수 있게 합니다.
                pokemonGameNsp.to(roomCode).emit('wrongGuessBroadcast', { 
                    guesserId: socket.id, 
                    guesserName: player.name 
                });

                // 점수 변경이 있으므로 전체 게임 상태를 다시 전송
                pokemonGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            }
        });
        
        // '게임 초기화' 이벤트 처리 (방장만 가능)
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
        
        // 유저 '접속 종료' 처리
        socket.on('disconnect', () => {
            for (const roomCode in pokemonGameRooms) { 
                const room = pokemonGameRooms[roomCode]; 
                if (room.players[socket.id]) { 
                    const wasHost = room.players[socket.id].isHost; 
                    const playerName = room.players[socket.id].name;
                    delete room.players[socket.id]; 

                    // 방에 아무도 없으면 방 삭제
                    if (Object.keys(room.players).length === 0) { 
                        delete pokemonGameRooms[roomCode]; 
                        console.log(`[포켓몬게임] 방 삭제: ${roomCode}`);
                        return; 
                    } 
                    
                    socket.to(roomCode).emit('playerLeft', { playerName });

                    // 나간 유저가 방장이었다면 다른 사람에게 방장 위임
                    if (wasHost && Object.keys(room.players).length > 0) { 
                        const newHostId = Object.keys(room.players)[0]; 
                        if(room.players[newHostId]) {
                            room.players[newHostId].isHost = true;
                            socket.to(roomCode).emit('newHost', { playerName: room.players[newHostId].name });
                        }
                    } 
                    
                    // 게임 중에 플레이어가 1명 이하로 남으면 대기 상태로 전환
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