// public/09.name-game/client.js
// '얘의 이름은?' 클라이언트 로직

const socket = io('/name-game');

// --- 전역 변수 ---
let myRoomCode = '';
let myPlayerId = '';
let myProfileImageSrc = document.getElementById('lobby-profile-preview').src;
let currentGameState = null;
let countdownInterval = null;

// --- DOM Elements ---
const lobbyContainer = document.getElementById('lobby-container');
const gameContainer = document.getElementById('game-container');
const playerNameInput = document.getElementById('player-name-input');
const playerBoard = document.getElementById('player-board');
const startGameButton = document.getElementById('start-game-button');
const resetGameButton = document.getElementById('reset-game-button');
const deckArea = document.getElementById('deck-area');
const deckInfoText = document.getElementById('deck-info-text');
const graveyardCountText = document.getElementById('graveyard-count');
const gamePopup = document.getElementById('game-popup');

// --- 이벤트 리스너 통합 관리 ---
document.addEventListener('click', (event) => {
    const target = event.target;
    if (target.id === 'lobby-profile-preview') document.getElementById('lobby-profile-input').click();
    if (target.id === 'create-room-btn') handleCreateRoom();
    if (target.id === 'join-room-btn') handleJoinRoom();
    if (target.id === 'copy-code-btn') handleCopyCode();
    if (!currentGameState || !currentGameState.players[myPlayerId]) return;
    const me = currentGameState.players[myPlayerId];
    if (me.isHost) {
        if (target.id === 'start-game-button' && currentGameState.state === 'waiting') socket.emit('startGame', { roomCode: myRoomCode });
        if (target.id === 'reset-game-button') socket.emit('resetGame', { roomCode: myRoomCode });
    }
    if (target.closest('#card-mountain')) {
        socket.emit('drawCard', { roomCode: myRoomCode });
    }
});

playerBoard.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !event.target.matches('.player-name-input')) return;
    event.preventDefault();
    const inputElement = event.target;
    const monsterName = inputElement.value.trim();
    if (!currentGameState || !currentGameState.lastDrawnCard) return;
    if (currentGameState.isNamingPhase) {
        if (monsterName.length >= 4 && /^[가-힣]+$/.test(monsterName)) {
            socket.emit('nameMonster', { roomCode: myRoomCode, monsterName });
            inputElement.value = '';
        } else {
            showToast('이름은 4글자 이상의 한글로만 지어주세요.', 'error');
        }
    } else {
        if (monsterName) {
            socket.emit('guessName', { roomCode: myRoomCode, guess: monsterName });
            inputElement.value = '';
        }
    }
});

// --- 로비 관련 함수들 ---
playerNameInput.addEventListener('input', () => { document.getElementById('room-actions').classList.toggle('hidden', !playerNameInput.value.trim()); });
document.getElementById('lobby-profile-input').addEventListener('change', (event) => { if (event.target.files[0]) { const reader = new FileReader(); reader.onload = (e) => { myProfileImageSrc = e.target.result; document.getElementById('lobby-profile-preview').src = myProfileImageSrc; }; reader.readAsDataURL(event.target.files[0]); }});
function handleCreateRoom() { const playerName = playerNameInput.value.trim(); if (!playerName) return showToast('이름을 입력하세요!', 'error'); socket.emit('createRoom', { playerName, profileImageSrc: myProfileImageSrc }); }
function handleJoinRoom() { const playerName = playerNameInput.value.trim(); const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase(); if (!playerName || !roomCode) return showToast('이름과 초대 코드를 모두 입력하세요!', 'error'); socket.emit('joinRoom', { roomCode, playerName, profileImageSrc: myProfileImageSrc }); }
function handleCopyCode() { navigator.clipboard.writeText(myRoomCode).then(() => showToast('초대 코드가 복사되었습니다!')); }

// --- 소켓 이벤트 핸들러 ---
socket.on('connect', () => { myPlayerId = socket.id; });
socket.on('roomCreated', onRoomJoined);
socket.on('roomJoined', onRoomJoined);
socket.on('playerJoined', ({ playerName }) => showToast(`${playerName} 님이 입장했습니다.`, 'join'));
socket.on('playerLeft', ({ playerName }) => showToast(`${playerName} 님이 퇴장했습니다.`, 'leave'));
socket.on('error', ({ message }) => showToast(message, 'error'));
socket.on('newHost', ({ playerName }) => showToast(`${playerName} 님이 새로운 방장이 되었습니다.`, 'info'));
socket.on('gameStarted', () => { showToast('게임이 시작되었습니다!', 'info'); });
socket.on('monsterNamed', ({ namer, imagePath, assignedName }) => {
    const popupContent = `<div class="popup-content-box name-reveal-popup"><p>${namer} 님이 이름을 지었습니다!</p><img src="${imagePath}" class="popup-monster-image"><h2 class="popup-monster-name">"${assignedName}"</h2></div>`;
    showPopup(popupContent, 1000); 
});
socket.on('correctGuess', ({ winnerName, correctName, imagePath, points }) => {
    const popupContent = `<div class="popup-content-box correct-guess-popup"><p>🎉 정답! 🎉</p><img src="${imagePath}" class="popup-monster-image"><h2 class="popup-monster-name">"${correctName}"</h2><p class="winner-info">${winnerName} 님이 ${points}점 획득!</p></div>`;
    showPopup(popupContent, 2500);
});
socket.on('timeUp', ({ namer }) => { showToast(`${namer} 님이 시간 내에 입력하지 못했습니다.`, 'info'); });

socket.on('updateGameState', (gameState) => {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    gamePopup.classList.remove('show');
    currentGameState = gameState;
    renderAll(gameState);
});

function onRoomJoined({ roomCode }) { myRoomCode = roomCode; lobbyContainer.classList.add('hidden'); gameContainer.classList.remove('hidden'); document.body.classList.remove('in-lobby'); }

// --- 렌더링 함수 ---
function renderAll(gameState) {
    const me = gameState.players[myPlayerId];
    if (!me) return;
    document.getElementById('player-count-display').textContent = `참가 인원: ${Object.keys(gameState.players).length} / ${gameState.maxPlayers}`;
    const isWaitingHost = me.isHost && gameState.state === 'waiting';
    startGameButton.classList.toggle('hidden', !isWaitingHost);
    resetGameButton.classList.toggle('hidden', !me.isHost);
    renderPlayerBoard(gameState);
    renderGameBoard(gameState);
}

function renderPlayerBoard(gameState) {
    playerBoard.innerHTML = ''; 
    const { players, turnOrder, currentTurnIndex, state, isNamingPhase, lastDrawnCard } = gameState;
    const currentTurnPlayerId = state === 'playing' ? turnOrder[currentTurnIndex] : null;
    const sortedPlayers = Object.values(players).sort((a, b) => b.score - a.score);

    sortedPlayers.forEach(player => {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.style.borderColor = player.color;
        if (player.id === currentTurnPlayerId) card.classList.add('current-turn');
        const hostBadge = player.isHost ? '<span class="host-badge">👑</span>' : '';
        let inputHtml = '<input type="text" class="player-name-input" placeholder="이름을 입력 (Enter)" maxlength="15" disabled>';
        
        if (state === 'playing' && lastDrawnCard) {
            if (player.id === myPlayerId && player.id === currentTurnPlayerId && isNamingPhase) {
                inputHtml = '<input type="text" class="player-name-input" placeholder="이름 짓기 (4글자 이상 한글)" maxlength="15" autofocus>';
            } else if (!isNamingPhase) {
                inputHtml = '<input type="text" class="player-name-input" placeholder="정답 입력!" maxlength="15">';
            }
        }
        card.innerHTML = `<div class="profile-section"><img src="${player.imageSrc}" class="profile-image-preview"></div><div class="content-section"><div class="player-name">${player.name}${hostBadge}</div><div class="player-action-area">${inputHtml}</div><div class="player-score">🏆 ${player.score}</div></div>`;
        playerBoard.appendChild(card);
    });
}

function renderGameBoard(gameState) {
    const { state, deck, graveyard, lastDrawnCard, isNamingPhase, turnOrder, currentTurnIndex, players, timeLimitStartedAt } = gameState;
    deckArea.innerHTML = '';
    
    if (state === 'playing' && lastDrawnCard && timeLimitStartedAt) {
        deckArea.innerHTML = `<div class="card-front"><img src="${lastDrawnCard.path}" alt="뽑은 몬스터"></div>`;
        
        if (isNamingPhase) {
            const currentNamer = players[turnOrder[currentTurnIndex]];
            deckInfoText.textContent = `${currentNamer.name}님이 몬스터 이름을 짓고 있습니다...`;
        } else {
            deckInfoText.textContent = '모두가 몬스터의 이름을 떠올리고 있습니다!';
        }
        
        countdownInterval = setInterval(() => {
            const elapsed = (Date.now() - timeLimitStartedAt);
            // [핵심 수정] 타이머 계산 기준을 15초로 변경
            const remainingSeconds = Math.max(0, 15 - Math.floor(elapsed / 1000));
            showCountdownPopup(remainingSeconds);
            
            if (remainingSeconds <= 0) {
                clearInterval(countdownInterval);
                countdownInterval = null;
                gamePopup.classList.remove('show');
            }
        }, 1000);

    } else if (state === 'playing' && deck.length > 0) {
        deckArea.innerHTML = `<div id="card-mountain" class="card-stack card-mountain"><div class="card-back"></div><div class="card-back"></div><div class="card-back"></div></div>`;
        const currentTurnPlayer = players[turnOrder[currentTurnIndex]];
        deckInfoText.textContent = `${currentTurnPlayer.name}님이 카드를 뽑을 차례입니다. (${deck.length}장 남음)`;
    } else {
        deckArea.innerHTML = `<div class="card-placeholder"></div>`;
        deckInfoText.textContent = '';
        if (state === 'game_over') {
            deckInfoText.textContent = '게임 종료! 초기화 버튼을 눌러 다시 시작하세요.';
        } else if (state === 'waiting') {
            deckInfoText.textContent = '방장이 게임을 시작할 때까지 기다려주세요.';
        }
    }
    graveyardCountText.textContent = `무덤: ${graveyard.length}`;
}

// --- 유틸리티 함수들 ---
function showCountdownPopup(count) {
    if (count > 0) {
        gamePopup.innerHTML = `<div class="countdown-popup"><div class="countdown-circle"><span class="countdown-text">${count}</span></div></div>`;
        gamePopup.classList.add('show');
    } else {
        gamePopup.classList.remove('show');
    }
}
function showPopup(content, duration) {
    gamePopup.innerHTML = content;
    gamePopup.classList.add('show');
    setTimeout(() => { gamePopup.classList.remove('show'); }, duration);
}
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 500); }, 2500);
}