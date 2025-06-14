// [신규 파일] game-logic/indian-poker.js
// '양세찬게임' 서버 로직 파일

module.exports = (io, generateRoomCode) => {
    const indianPokerNsp = io.of('/indian-poker');
    const indianPokerRooms = {};

    indianPokerNsp.on('connection', (socket) => {
        console.log(`[양세찬게임] 유저 접속: ${socket.id}`);

        const PLAYER_COLORS = ['#e57373', '#ffb74d', '#fff176', '#81c784', '#4dd0e1', '#64b5f6', '#7986cb', '#ba68c8'];
        const MAX_PLAYERS = 12;

        function getGameState(roomCode) { return indianPokerRooms[roomCode] || null; }
        function updateGameState(roomCode) { indianPokerNsp.to(roomCode).emit('updateGameState', getGameState(roomCode)); }

        // --- 방 생성 및 참가 로직 ---
        socket.on('createRoom', ({ playerName, profileImageSrc }) => {
            const roomCode = generateRoomCode();
            indianPokerRooms[roomCode] = {
                code: roomCode,
                players: {},
                state: 'waiting', // 'waiting', 'topic_submission', 'ready_to_start', 'playing', 'game_over'
                maxPlayers: MAX_PLAYERS,
                submittedTopics: {}, // { playerId: 'topic' }
                assignedTopics: {},  // { playerId: 'assignedTopic' }
                clearedPlayers: []   // [playerId]
            };
            socket.join(roomCode);
            indianPokerRooms[roomCode].players[socket.id] = { id: socket.id, name: playerName, color: PLAYER_COLORS[0], imageSrc: profileImageSrc, isHost: true };
            socket.emit('roomCreated', { roomCode });
            updateGameState(roomCode);
        });

        socket.on('joinRoom', ({ roomCode, playerName, profileImageSrc }) => {
            const room = indianPokerRooms[roomCode];
            if (!room) return socket.emit('error', { message: '해당하는 방이 없습니다.' });
            if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('error', { message: '방이 가득 찼습니다.' });
            if (room.state !== 'waiting') return socket.emit('error', { message: '이미 시작된 게임입니다.' });
            socket.join(roomCode);
            const usedColors = new Set(Object.values(room.players).map(p => p.color));
            const availableColor = PLAYER_COLORS.find(c => !usedColors.has(c)) || PLAYER_COLORS[0];
            room.players[socket.id] = { id: socket.id, name: playerName, color: availableColor, imageSrc: profileImageSrc, isHost: false };
            socket.emit('roomJoined', { roomCode });
            socket.to(roomCode).emit('playerJoined', { playerName });
            updateGameState(roomCode);
        });
        
        // --- 게임 진행 로직 ---
        // 1. 로비에서 게임 시작 -> 주제어 제출 단계로 이동
        socket.on('startGame', ({ roomCode }) => {
            const room = indianPokerRooms[roomCode];
            if (!room || !room.players[socket.id]?.isHost || room.state !== 'waiting') return;
            room.state = 'topic_submission';
            room.submittedTopics = {};
            room.assignedTopics = {};
            room.clearedPlayers = [];
            indianPokerNsp.to(roomCode).emit('gameStarted');
            updateGameState(roomCode);
        });
        
        // 2. 플레이어가 주제어 제출
        socket.on('submitTopic', ({ roomCode, topic }) => {
            const room = indianPokerRooms[roomCode];
            if (!room || room.state !== 'topic_submission' || !topic) return;
            room.submittedTopics[socket.id] = topic;
            
            // 모든 플레이어가 제출했는지 확인
            const allPlayersSubmitted = Object.keys(room.players).length === Object.keys(room.submittedTopics).length;
            if (allPlayersSubmitted) {
                room.state = 'ready_to_start';
            }
            updateGameState(roomCode);
        });

        // 3. 방장이 메인 게임 시작 -> 주제어 분배
        socket.on('startMainRound', ({ roomCode }) => {
            const room = indianPokerRooms[roomCode];
            if (!room || !room.players[socket.id]?.isHost || room.state !== 'ready_to_start') return;
            
            // 주제어 분배 로직 (순환 할당)
            const playerIds = Object.keys(room.players);
            const topics = playerIds.map(id => room.submittedTopics[id]);
            
            playerIds.forEach((playerId, index) => {
                const assignedTopicIndex = (index + 1) % playerIds.length; // 다음 사람의 주제어를 할당
                room.assignedTopics[playerId] = topics[assignedTopicIndex];
            });

            room.state = 'playing';
            updateGameState(roomCode);
        });

        // 4. 방장이 플레이어 공개
        socket.on('clearPlayer', ({ roomCode, targetPlayerId }) => {
            const room = indianPokerRooms[roomCode];
            if (!room || !room.players[socket.id]?.isHost || room.state !== 'playing') return;
            if (!room.clearedPlayers.includes(targetPlayerId)) {
                room.clearedPlayers.push(targetPlayerId);
            }

            // 모든 플레이어가 공개되었는지 확인
            if (room.clearedPlayers.length === Object.keys(room.players).length) {
                room.state = 'game_over';
            }
            updateGameState(roomCode);
        });
        
        // 게임 완전 초기화
        socket.on('resetGame', ({ roomCode }) => {
            const room = indianPokerRooms[roomCode];
            if (room && room.players[socket.id]?.isHost) {
                room.state = 'waiting';
                room.submittedTopics = {};
                room.assignedTopics = {};
                room.clearedPlayers = [];
                updateGameState(roomCode);
            }
        });
        
        socket.on('disconnect', () => {
             for (const roomCode in indianPokerRooms) {
                const room = indianPokerRooms[roomCode];
                if (room.players[socket.id]) {
                    const wasHost = room.players[socket.id].isHost;
                    const playerName = room.players[socket.id].name;
                    delete room.players[socket.id];
                    delete room.submittedTopics[socket.id];

                    if (Object.keys(room.players).length === 0) {
                        delete indianPokerRooms[roomCode];
                        return;
                    }
                    socket.to(roomCode).emit('playerLeft', { playerName });

                    if (wasHost && Object.keys(room.players).length > 0) {
                        const newHostId = Object.keys(room.players)[0];
                        if (room.players[newHostId]) {
                            room.players[newHostId].isHost = true;
                            socket.to(roomCode).emit('newHost', { playerName: room.players[newHostId].name });
                        }
                    }

                    // 주제 제출 단계에서 나갔을 경우, 모든 제출 완료 여부 재확인
                    if (room.state === 'topic_submission' && Object.keys(room.players).length > 0) {
                         const allPlayersSubmitted = Object.keys(room.players).every(id => room.submittedTopics[id]);
                         if (allPlayersSubmitted) {
                            room.state = 'ready_to_start';
                         }
                    }
                    updateGameState(roomCode);
                    break;
                }
            }
        });
    });
};