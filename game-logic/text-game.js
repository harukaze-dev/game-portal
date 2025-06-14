// [수정] game-logic/text-game.js
// '문장퍼즐게임' 서버 로직 파일

module.exports = (io, generateRoomCode) => {
    const textGameNsp = io.of('/text-game');
    const textGameRooms = {};

    textGameNsp.on('connection', (socket) => {
        console.log(`[문장퍼즐게임] 유저 접속: ${socket.id}`);

        // --- 상수 및 유틸리티 함수 ---
        const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
        const MAX_PLAYERS = 12;
        
        /*
         * ===================================================================
         *  [핵심 추가 1] 그리드에 사용될 16개의 색상 배열
         *  - 기존 플레이어 색상 8개 + 신규 색상 8개 = 총 16개
         * ===================================================================
         */
        const GRID_COLORS = [
            '#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8',
            '#f06292', '#a1887f', '#90a4ae', '#4db6ac', '#ff8a65', '#aed581', '#795548', '#dce775'
        ];

        function getGameState(roomCode) { return textGameRooms[roomCode] || null; }
        
        function shuffleArray(array) {
            const newArray = [...array];
            for (let i = newArray.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
            }
            return newArray;
        }

        // 새로운 라운드를 시작하는 함수
        function startNewRound(room, nextTurnPlayerId) {
            const newTurnIndex = room.turnOrder.indexOf(nextTurnPlayerId);
            if (newTurnIndex > -1) room.turnIndex = newTurnIndex;
            room.currentTurnPlayerId = nextTurnPlayerId;
            room.state = 'playing_input';
            room.currentGuesserId = null;
            room.incorrectGuessers = [];
            // [핵심 추가 2] 새 라운드마다 그리드 색상을 섞어서 저장
            room.gridColors = shuffleArray(GRID_COLORS);
        }

        // --- 소켓 이벤트 핸들러 ---
        socket.on('createRoom', ({ playerName, profileImageSrc }) => {
            const roomCode = generateRoomCode();
            textGameRooms[roomCode] = { 
                code: roomCode, players: {}, state: 'waiting', maxPlayers: MAX_PLAYERS, 
                turnOrder: [], turnIndex: 0, currentTurnPlayerId: null, 
                currentWord: null, currentGuesserId: null, incorrectGuessers: [],
                gridColors: shuffleArray(GRID_COLORS) // 방 생성 시 초기 색상 배치
            };
            socket.join(roomCode);
            textGameRooms[roomCode].players[socket.id] = { id: socket.id, name: playerName, color: PLAYER_COLORS[0], imageSrc: profileImageSrc, isHost: true, cumulativeScore: 0 };
            socket.emit('roomCreated', { roomCode });
            textGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });

        socket.on('joinRoom', ({ roomCode, playerName, profileImageSrc }) => {
            const room = textGameRooms[roomCode];
            if (!room) return socket.emit('error', { message: '해당하는 방이 없습니다.' });
            if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('error', { message: '방이 가득 찼습니다.' });
            if (room.state !== 'waiting') return socket.emit('error', { message: '이미 시작된 게임입니다.' });
            socket.join(roomCode);
            const usedColors = new Set(Object.values(room.players).map(p => p.color));
            const availableColor = PLAYER_COLORS.find(c => !usedColors.has(c)) || PLAYER_COLORS[0];
            room.players[socket.id] = { id: socket.id, name: playerName, color: availableColor, imageSrc: profileImageSrc, isHost: false, cumulativeScore: 0 };
            socket.emit('roomJoined', { roomCode });
            socket.to(roomCode).emit('playerJoined', { playerName });
            textGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });
        
        socket.on('startGame', ({ roomCode }) => {
            const room = textGameRooms[roomCode];
            if (!room || !room.players[socket.id]?.isHost || room.state !== 'waiting') return;
            room.turnOrder = shuffleArray(Object.keys(room.players));
            startNewRound(room, room.turnOrder[0]);
            room.currentWord = null;
            textGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            textGameNsp.to(roomCode).emit('gameStarted');
        });

        socket.on('submitWord', ({ roomCode, word }) => {
            const room = textGameRooms[roomCode];
            if (!room || socket.id !== room.currentTurnPlayerId || !word || word.length > 16) return;
            
            /*
             * ===================================================================
             *  [핵심 수정] 글자 섞기를 서버에서 처리하여 동기화
             * ===================================================================
             */
            // 1. 입력된 단어를 글자 배열로 만듦
            const wordChars = word.split('');
            // 2. 16칸에서 부족한 만큼 빈칸('')을 채움
            const emptySlots = 16 - wordChars.length;
            for (let i = 0; i < emptySlots; i++) {
                wordChars.push('');
            }
            // 3. 글자와 빈칸이 섞인 배열을 서버에서 생성
            const shuffledGrid = shuffleArray(wordChars);

            // 4. 생성된 배열을 room 정보에 저장하여 모든 클라이언트에게 전달
            room.currentWord = {
                text: word,
                submitterId: socket.id,
                shuffledGrid: shuffledGrid 
            };
            room.state = 'playing_guessing';
            room.currentGuesserId = null;
            room.incorrectGuessers = [];
            textGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });

        socket.on('buzzIn', ({ roomCode }) => {
            const room = textGameRooms[roomCode];
            if (!room || room.state !== 'playing_guessing' || room.currentGuesserId || room.incorrectGuessers.includes(socket.id)) return;
            room.state = 'playing_judging';
            room.currentGuesserId = socket.id;
            textGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });

        socket.on('judgeAnswer', ({ roomCode, isCorrect }) => {
            const room = textGameRooms[roomCode];
            const submitterId = room.currentWord.submitterId;
            if (!room || socket.id !== submitterId || room.state !== 'playing_judging') return;
            
            const guesserId = room.currentGuesserId;
            if (isCorrect) {
                const winner = room.players[guesserId];
                if(winner) winner.cumulativeScore += 1;
                // 정답을 맞추면 다음 라운드로 바로 넘어가지 않고, 정답 공개 상태(round_end)를 거침
                room.state = 'round_end';
                room.currentTurnPlayerId = guesserId;
            } else {
                room.incorrectGuessers.push(guesserId);
                room.currentGuesserId = null;
                room.state = 'playing_guessing';
            }
            textGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });
        
        socket.on('resetRound', ({ roomCode }) => {
            const room = textGameRooms[roomCode];
            if (room && room.players[socket.id]?.isHost) {
                room.state = 'waiting';
                Object.values(room.players).forEach(p => { p.cumulativeScore = 0; });
                room.turnOrder = []; room.turnIndex = 0; room.currentTurnPlayerId = null; room.currentWord = null; room.currentGuesserId = null; room.incorrectGuessers = [];
                room.gridColors = shuffleArray(GRID_COLORS); // 초기화 시 색상도 재배치
                textGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            }
        });
        
        socket.on('disconnect', () => {
            for (const roomCode in textGameRooms) { 
                const room = textGameRooms[roomCode]; 
                if (room.players[socket.id]) { 
                    const wasHost = room.players[socket.id].isHost; 
                    const wasTurnPlayer = socket.id === room.currentTurnPlayerId; 
                    const playerName = room.players[socket.id].name;
                    delete room.players[socket.id]; 

                    if (Object.keys(room.players).length === 0) { 
                        delete textGameRooms[roomCode]; 
                        return; 
                    } 
                    socket.to(roomCode).emit('playerLeft', { playerName });

                    const playerIndex = room.turnOrder.indexOf(socket.id); 
                    if (playerIndex > -1) room.turnOrder.splice(playerIndex, 1); 
                    
                    if (wasHost && Object.keys(room.players).length > 0) { 
                        const newHostId = Object.keys(room.players)[0]; 
                        if(room.players[newHostId]) {
                            room.players[newHostId].isHost = true;
                            socket.to(roomCode).emit('newHost', { playerName: room.players[newHostId].name });
                        }
                    } 

                    if (room.state.startsWith('playing') && wasTurnPlayer) { 
                        if (room.turnOrder.length > 0) { 
                            if (room.turnIndex >= room.turnOrder.length) room.turnIndex = 0; 
                            startNewRound(room, room.turnOrder[room.turnIndex]); 
                            room.currentWord = null; 
                        } else { 
                            room.state = 'waiting'; 
                        } 
                    } 
                    textGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode)); 
                    break; 
                } 
            }
        });
    });
};