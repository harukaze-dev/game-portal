const gridGameData = require('../public/04.grid-game/database.js');
const gridGameTexts = gridGameData.TEXT_DATABASE;

module.exports = (io, generateRoomCode) => {
    // ===================================================================
    // --- 순발력 게임 네임스페이스 ---
    // ===================================================================
    const gridGameNsp = io.of('/grid-game');
    const gridGameRooms = {};

    gridGameNsp.on('connection', (socket) => {
        console.log(`[순발력 게임] 유저 접속: ${socket.id}`);
        const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
        const MAX_PLAYERS = 12;

        function getGameState(roomCode) { return gridGameRooms[roomCode] || null; }
        
        function shuffleArray(array) {
            const newArray = [...array];
            for (let i = newArray.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
            }
            return newArray;
        }

        function advanceTurn(room) {
            if (!room.turnOrder || room.turnOrder.length === 0) return;
            const currentIndex = room.turnOrder.indexOf(room.currentTurnPlayerId);
            const nextIndex = (currentIndex + 1) % room.turnOrder.length;
            room.turnIndex = nextIndex;
            room.currentTurnPlayerId = room.turnOrder[nextIndex];
            room.textChangeCount = 0; // 턴이 넘어갈 때 변경 횟수 초기화
        }

        function generateTriggerResult() {
            const diceResult = (Math.floor(Math.random() * 4) + 1) + (Math.floor(Math.random() * 4) + 1);
            const direction = ['▲', '▼'][Math.floor(Math.random() * 2)];
            return { dice: diceResult, direction };
        }

        function generateSpecialBoxMap() {
            const fiveColorsPalette = ['#ef5350', '#FDD835', '#66bb6a', '#1976D2', '#B39DDB'];
            const shapes = ['★', '●', '◆', '♠', '♥'];
            const topArrowSymbols = ['←', '↖', '↑', '↗', '→'];
            const bottomArrowSymbols = ['←', '↙', '↓', '↘', '→'];

            return {
                'box-r2c2': {
                    color: fiveColorsPalette[Math.floor(Math.random() * fiveColorsPalette.length)],
                    shape: shapes[Math.floor(Math.random() * shapes.length)],
                    arrow: topArrowSymbols[Math.floor(Math.random() * topArrowSymbols.length)]
                },
                'box-r4c2': {
                    color: fiveColorsPalette[Math.floor(Math.random() * fiveColorsPalette.length)],
                    shape: shapes[Math.floor(Math.random() * shapes.length)],
                    arrow: bottomArrowSymbols[Math.floor(Math.random() * bottomArrowSymbols.length)]
                }
            };
        }

        function updateGridForNextTurn(room) {
            const topTextBoxIds = ['box-r1c1', 'box-r1c2', 'box-r1c3', 'box-r2c1', 'box-r2c3'];
            const bottomTextBoxIds = ['box-r4c1', 'box-r4c3', 'box-r5c1', 'box-r5c2', 'box-r5c3'];
            
            room.gridState.highlightedBoxIds = [
                topTextBoxIds[Math.floor(Math.random() * topTextBoxIds.length)],
                bottomTextBoxIds[Math.floor(Math.random() * bottomTextBoxIds.length)]
            ];
            room.gridState.triggerResult = generateTriggerResult();
            room.gridState.specialBoxMap = generateSpecialBoxMap();
        }
        
        function createInitialGridState() {
            const fiveColorsPalette = ['#ef5350', '#FDD835', '#66bb6a', '#1976D2', '#B39DDB'];
            const shapes = ['★', '●', '◆', '♠', '♥'];
            const neutralTexts = ["방향", "컬러", "마크", "네온"];
            
            const topTextBoxIds = ['box-r1c1', 'box-r1c2', 'box-r1c3', 'box-r2c1', 'box-r2c3'];
            const bottomTextBoxIds = ['box-r4c1', 'box-r4c3', 'box-r5c1', 'box-r5c2', 'box-r5c3'];

            const colorShapeMap = {};
            const shuffledTopColors = shuffleArray(fiveColorsPalette);
            const shuffledTopShapes = shuffleArray(shapes);
            topTextBoxIds.forEach((id, i) => {
                colorShapeMap[id] = { color: shuffledTopColors[i], shape: shuffledTopShapes[i] };
            });

            const shuffledBottomColors = shuffleArray(fiveColorsPalette);
            const shuffledBottomShapes = shuffleArray(shapes);
            bottomTextBoxIds.forEach((id, i) => {
                colorShapeMap[id] = { color: shuffledBottomColors[i], shape: shuffledBottomShapes[i] };
            });
            
            const shuffledNeutralTexts = shuffleArray(neutralTexts);
            return {
                textMap: Object.fromEntries([...topTextBoxIds, ...bottomTextBoxIds].map((id) => [id, gridGameTexts[Math.floor(Math.random() * gridGameTexts.length)]])),
                colorShapeMap,
                specialBoxMap: generateSpecialBoxMap(),
                highlightedBoxIds: [
                    topTextBoxIds[Math.floor(Math.random() * topTextBoxIds.length)],
                    bottomTextBoxIds[Math.floor(Math.random() * bottomTextBoxIds.length)]
                ],
                neutralText1: shuffledNeutralTexts[0],
                neutralText2: shuffledNeutralTexts[1],
                triggerResult: generateTriggerResult()
            };
        }
        
        function continueNextRound(room, lastWinnerId) {
            room.state = 'playing';
            room.jackpotWinnerId = null;
            // textChangeCount는 advanceTurn에서 초기화되므로 여기서 할 필요 없음
            
            const winnerIndex = room.turnOrder.indexOf(lastWinnerId);
            const validWinnerIndex = winnerIndex > -1 ? winnerIndex : -1;
            let nextIndex = (validWinnerIndex + 1);

            if (nextIndex >= room.turnOrder.length) {
                nextIndex = 0;
            }

            room.turnIndex = nextIndex;
            room.currentTurnPlayerId = room.turnOrder[nextIndex];
            
            const shuffledNeutralTexts = shuffleArray(["방향", "컬러", "마크", "네온"]);
            room.gridState.neutralText1 = shuffledNeutralTexts[0];
            room.gridState.neutralText2 = shuffledNeutralTexts[1];
            updateGridForNextTurn(room);
            advanceTurn(room); // 턴 넘기기 및 textChangeCount 초기화
        }

        socket.on('createRoom', ({ playerName, profileImageSrc }) => {
            const roomCode = generateRoomCode();
            gridGameRooms[roomCode] = {
                code: roomCode, players: {}, state: 'waiting', maxPlayers: MAX_PLAYERS, gameMode: '나혼자 말해요', gridState: null,
                turnOrder: [], turnIndex: 0, currentTurnPlayerId: null, jackpotWinnerId: null, textChangeCount: 0,
            };
            socket.join(roomCode);
            gridGameRooms[roomCode].players[socket.id] = { id: socket.id, name: playerName, color: PLAYER_COLORS[0], imageSrc: profileImageSrc, isHost: true, cumulativeScore: 0 };
            socket.emit('roomCreated', { roomCode });
            gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });

        socket.on('joinRoom', ({ roomCode, playerName, profileImageSrc }) => {
            const room = gridGameRooms[roomCode];
            if (!room) return socket.emit('error', { message: '해당하는 방이 없습니다.' });
            if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('error', { message: '방이 가득 찼습니다.' });
            if (room.state !== 'waiting') return socket.emit('error', { message: '이미 시작된 게임입니다.' });

            socket.join(roomCode);
            const usedColors = new Set(Object.values(room.players).map(p => p.color));
            const availableColor = PLAYER_COLORS.find(c => !usedColors.has(c)) || PLAYER_COLORS[0];
            room.players[socket.id] = { id: socket.id, name: playerName, color: availableColor, imageSrc: profileImageSrc, isHost: false, cumulativeScore: 0 };
            socket.emit('roomJoined', { roomCode });
            socket.to(roomCode).emit('playerJoined', { playerName });
            gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });
        
        socket.on('changeMode', ({ roomCode, newMode }) => {
            const room = gridGameRooms[roomCode];
            if (room && room.players[socket.id]?.isHost && room.state === 'waiting') {
                room.gameMode = newMode;
                gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            }
        });

        socket.on('startGame', ({ roomCode, gameMode }) => {
            const room = gridGameRooms[roomCode];
            if (!room || !room.players[socket.id]?.isHost || room.state !== 'waiting') return;

            room.gameMode = gameMode;
            room.state = 'playing';
            room.turnOrder = shuffleArray(Object.keys(room.players).filter(id => room.players[id]));
            room.turnIndex = 0;
            room.currentTurnPlayerId = room.turnOrder[0];
            room.gridState = createInitialGridState();
            room.textChangeCount = 0;
            
            gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            gridGameNsp.to(roomCode).emit('gameStarted');
        });
        
        socket.on('changeTextBox', ({ roomCode, boxId }) => {
            const room = gridGameRooms[roomCode];
            // 변경 횟수를 2회 미만으로 체크
            if (!room || room.state !== 'playing' || socket.id !== room.currentTurnPlayerId || room.textChangeCount >= 2) return;
            
            const currentText = room.gridState.textMap[boxId];
            let newText;
            do { newText = gridGameTexts[Math.floor(Math.random() * gridGameTexts.length)]; } while (newText === currentText);
            
            room.gridState.textMap[boxId] = newText;
            updateGridForNextTurn(room);
            room.textChangeCount++; // 변경 횟수 증가
            
            setTimeout(() => {
                gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            }, 500);
        });
        
        socket.on('changeEmoji', ({ roomCode, boxId }) => {
            const room = gridGameRooms[roomCode];
            if (!room || room.state !== 'playing' || socket.id !== room.currentTurnPlayerId) return;

            const neutralTexts = ["방향", "컬러", "마크", "네온"];
            let newText;

            if (boxId === 'box-r3c1') {
                do { newText = neutralTexts[Math.floor(Math.random() * neutralTexts.length)]; } while (newText === room.gridState.neutralText1);
                room.gridState.neutralText1 = newText;
            } else if (boxId === 'box-r3c3') {
                do { newText = neutralTexts[Math.floor(Math.random() * neutralTexts.length)]; } while (newText === room.gridState.neutralText2);
                room.gridState.neutralText2 = newText;
            }

            if (room.gridState.neutralText1 === room.gridState.neutralText2) {
                room.state = 'jackpot';
                room.gridState.triggerResult = generateTriggerResult();
                room.gridState.specialBoxMap = generateSpecialBoxMap();
            } else {
                advanceTurn(room);
                updateGridForNextTurn(room);
            }
            
            setTimeout(() => {
                gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            }, 500);
        });

        socket.on('claimJackpot', ({ roomCode }) => {
            const room = gridGameRooms[roomCode];
            if (!room || room.state !== 'jackpot') return;
            room.state = 'jackpot_claimed';
            room.jackpotWinnerId = socket.id;
            gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });

        socket.on('releaseJackpot', ({ roomCode }) => {
            const room = gridGameRooms[roomCode];
            if (!room || room.state !== 'jackpot_claimed' || socket.id !== room.jackpotWinnerId) return;
            room.state = 'jackpot';
            room.jackpotWinnerId = null;
            gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });
        
        socket.on('claimPoint', ({ roomCode, targetPlayerId }) => { // targetPlayerId를 받도록 수정
            const room = gridGameRooms[roomCode];
            if (!room || room.state !== 'jackpot_claimed' || socket.id !== room.jackpotWinnerId || room.gameMode !== '나혼자 말해요') return;

            const player = room.players[targetPlayerId]; // 타겟 플레이어에게 점수 부여
            if (player) {
                player.cumulativeScore += 1;
            }
            
            continueNextRound(room, socket.id); // 잭팟 위너 기준으로 다음 턴 진행
            gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });

        socket.on('deductPoint', ({ roomCode, targetPlayerId }) => {
            const room = gridGameRooms[roomCode];
            if (!room || room.state !== 'jackpot_claimed' || socket.id !== room.jackpotWinnerId || room.gameMode !== '모두가 말해요') return;

            const targetPlayer = room.players[targetPlayerId];
            if (targetPlayer) {
                targetPlayer.cumulativeScore -= 1;
            }

            continueNextRound(room, socket.id);
            gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
        });

        socket.on('resetRound', ({ roomCode }) => {
            const room = gridGameRooms[roomCode];
            if (room && room.players[socket.id]?.isHost) {
                room.state = 'waiting';
                room.gridState = null;
                room.turnOrder = [];
                room.currentTurnPlayerId = null;
                room.jackpotWinnerId = null;
                room.gameMode = '나혼자 말해요';
                Object.values(room.players).forEach(p => { p.cumulativeScore = 0; });
                gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
            }
        });

        socket.on('disconnect', () => {
            console.log(`[순발력 게임] 유저 접속 종료: ${socket.id}`);
            for (const roomCode in gridGameRooms) {
                const room = gridGameRooms[roomCode];
                if (room.players[socket.id]) {
                    const wasHost = room.players[socket.id].isHost;
                    const wasTurnPlayer = socket.id === room.currentTurnPlayerId;
                    const playerIndex = room.turnOrder.indexOf(socket.id);
                    
                    delete room.players[socket.id];
                    
                    if (Object.keys(room.players).length === 0) {
                        delete gridGameRooms[roomCode];
                        console.log(`[순발력 게임] 방 ${roomCode}가 비어서 삭제되었습니다.`);
                        return;
                    }

                    if (playerIndex > -1) room.turnOrder.splice(playerIndex, 1);

                    if (wasHost && Object.keys(room.players).length > 0) {
                        const newHostId = Object.keys(room.players)[0];
                        if (room.players[newHostId]) room.players[newHostId].isHost = true;
                    }
                    
                    if (room.state !== 'waiting' && wasTurnPlayer) {
                        if (room.turnOrder.length > 0) {
                            if (room.turnIndex > playerIndex) room.turnIndex--;
                            if (room.turnIndex >= room.turnOrder.length) room.turnIndex = 0;
                            room.currentTurnPlayerId = room.turnOrder[room.turnIndex] || null;
                            room.textChangeCount = 0; // 나간 플레이어가 턴 플레이어였다면 횟수 초기화
                        } else { 
                           room.state = 'waiting';
                           room.currentTurnPlayerId = null;
                        }
                    }
                    
                    gridGameNsp.to(roomCode).emit('updateGameState', getGameState(roomCode));
                    break;
                }
            }
        });
    });
};