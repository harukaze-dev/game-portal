document.addEventListener('DOMContentLoaded', () => {
    const socket = io('/average-game');

    // 글로벌 변수
    let myRoomCode = '';
    let myPlayerId = '';
    let myProfileImageSrc = document.getElementById('lobby-profile-preview').src;
    let currentGameState = null;
    let isHistoryView = false;
    
    // 이벤트 위임 (Event Delegation)을 사용한 통합 이벤트 핸들러
    document.addEventListener('click', (event) => {
        const target = event.target;

        if (target.id === 'lobby-profile-preview') document.getElementById('lobby-profile-input').click();
        if (target.id === 'create-room-btn') handleCreateRoom();
        if (target.id === 'join-room-btn') handleJoinRoom();
        if (target.id === 'copy-code-btn') handleCopyCode();
        if (target.id === 'confirm-question-btn') handleConfirmQuestion(target);
        if (target.id === 'view-results-button') socket.emit('viewResults', { roomCode: myRoomCode });
        if (target.id === 'reset-round-button') socket.emit('resetRound', { roomCode: myRoomCode });
        if (target.id === 'toggle-history-btn') handleToggleHistory();
        if (target.id === 'back-to-game-btn') renderGame(currentGameState);

        const submitButton = target.closest('.btn-submit');
        if (submitButton) handleSubmitValue(submitButton);

        const historyItem = target.closest('li[data-history-index]');
        if (historyItem) handleShowPastResults(historyItem);
    });

    const playerNameInput = document.getElementById('player-name-input');
    playerNameInput.addEventListener('input', () => {
        document.getElementById('room-actions').classList.toggle('hidden', !playerNameInput.value.trim());
    });

    document.getElementById('lobby-profile-input').addEventListener('change', handleProfileImageChange);
    
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        if (event.target.id === 'question-input' && !event.target.disabled) {
            event.preventDefault();
            document.getElementById('confirm-question-btn').click();
        }
        if (event.target.classList.contains('number-input')) {
            event.preventDefault();
            const card = event.target.closest('.player-card');
            if (card) card.querySelector('.btn-submit').click();
        }
    });
    
    document.addEventListener('input', (event) => {
        if (event.target.classList.contains('number-input')) {
            event.target.value = event.target.value.replace(/[^0-9]/g, '');
        }
    });

    function handleProfileImageChange(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                myProfileImageSrc = e.target.result;
                document.getElementById('lobby-profile-preview').src = myProfileImageSrc;
            };
            reader.readAsDataURL(file);
        }
    }

    function handleCreateRoom() {
        const playerName = playerNameInput.value.trim();
        if (!playerName) return alert('이름을 입력하세요!');
        socket.emit('createRoom', { playerName, profileImageSrc: myProfileImageSrc });
    }

    function handleJoinRoom() {
        const playerName = playerNameInput.value.trim();
        const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
        if (!playerName || !roomCode) return alert('이름과 초대 코드를 모두 입력하세요!');
        socket.emit('joinRoom', { roomCode, playerName, profileImageSrc: myProfileImageSrc });
    }
    
    function handleCopyCode() {
        navigator.clipboard.writeText(myRoomCode).then(() => showToast('초대 코드가 복사되었습니다!'));
    }
    
    function handleConfirmQuestion(button) {
        const questionInput = document.getElementById('question-input');
        if (questionInput.disabled) {
            socket.emit('updateQuestion', { roomCode: myRoomCode, question: '' });
        } else {
            const question = questionInput.value.trim();
            if (!question) return alert('질문을 입력해주세요.');
            socket.emit('updateQuestion', { roomCode: myRoomCode, question });
        }
    }

    function handleSubmitValue(button) {
        const card = button.closest('.player-card');
        if (!card || card.dataset.playerId !== myPlayerId) return;
        const numberInput = card.querySelector('.number-input');
        const isSubmitted = button.textContent === '취소';
        if (!isSubmitted && numberInput.value === '') return alert('숫자를 입력해주세요!');
        socket.emit('submitValue', { 
            roomCode: myRoomCode, 
            value: isSubmitted ? null : parseInt(numberInput.value, 10),
            submitted: !isSubmitted
        });
    }

    function handleToggleHistory() {
        isHistoryView = !isHistoryView;
        renderSidePanel(currentGameState);
    }
    
    function handleShowPastResults(historyItem) {
         if (currentGameState) {
            const index = parseInt(historyItem.dataset.historyIndex, 10);
            const pastRound = currentGameState.history[index];
            if (pastRound) renderPastResults(pastRound);
        }
    }

    // Socket Event Handlers
    socket.on('connect', () => { myPlayerId = socket.id; });
    socket.on('roomCreated', onRoomJoined);
    socket.on('roomJoined', onRoomJoined);
    socket.on('playerJoined', ({ playerName }) => showToast(`${playerName} 님이 입장했습니다.`, 'join'));
    socket.on('playerLeft', ({ playerName }) => showToast(`${playerName} 님이 퇴장했습니다.`, 'leave'));
    socket.on('error', ({ message }) => { alert(message); });
    socket.on('newHost', ({ playerName }) => showToast(`${playerName} 님이 새로운 방장이 되었습니다.`, 'info'));
    socket.on('updateGameState', (gameState) => {
        if (!gameState) return;
        currentGameState = gameState;
        if (gameState.state === 'waiting') {
            renderGame(gameState);
        } else if (gameState.state === 'results') {
            renderResults(gameState);
        }
    });

    function onRoomJoined({ roomCode }) {
        myRoomCode = roomCode;
        document.body.classList.remove('in-lobby');
        document.getElementById('lobby-container').classList.add('hidden');
        document.getElementById('game-container').classList.remove('hidden');
    }

    // 렌더링 함수들
    function renderGame(gameState) {
        const players = Object.values(gameState.players);
        const me = players.find(p => p.id === myPlayerId);
        if (!me) return;
        
        const amIHost = me.isHost;
        document.getElementById('player-count-display').textContent = `접속 인원: ${players.length} / ${gameState.maxPlayers}`;
        document.getElementById('main-game-area').classList.remove('hidden');
        document.getElementById('results').classList.add('hidden');
        document.getElementById('question-container').classList.remove('hidden');
        document.getElementById('host-controls').classList.toggle('hidden', !amIHost);
        document.getElementById('view-results-button').classList.toggle('hidden', !amIHost);
        document.getElementById('reset-round-button').classList.add('hidden');

        const questionInput = document.getElementById('question-input');
        const confirmQuestionBtn = document.getElementById('confirm-question-btn');
        const isQuestionConfirmed = !!gameState.question;
        questionInput.value = gameState.question;
        questionInput.classList.toggle('confirmed-question', isQuestionConfirmed);

        if (amIHost) {
            confirmQuestionBtn.classList.remove('hidden');
            confirmQuestionBtn.id = 'confirm-question-btn'; // ID를 명시적으로 유지
            questionInput.disabled = isQuestionConfirmed;
            confirmQuestionBtn.textContent = isQuestionConfirmed ? '질문 수정' : '질문 확정';
            confirmQuestionBtn.className = 'confirm-question-btn ' + (isQuestionConfirmed ? 'edit-mode' : 'confirm-mode');
        } else {
            confirmQuestionBtn.classList.add('hidden');
            questionInput.disabled = true;
            questionInput.placeholder = isQuestionConfirmed ? gameState.question : '질문 입력 중...';
        }

        const gameBoard = document.getElementById('game-board');
        gameBoard.innerHTML = '';
        players.forEach(player => gameBoard.appendChild(createPlayerCard(player, player.id === myPlayerId)));

        renderSidePanel(gameState);
        
        // [수정됨] 결과 보기 버튼 활성화/비활성화 로직 변경
        document.getElementById('view-results-button').disabled = !players.some(p => p.submitted);
    }
    
    function createPlayerCard(player, isMe) {
        const card = document.createElement('div');
        card.className = 'player-card';
        card.dataset.playerId = player.id;
        card.style.borderColor = player.color;
        card.style.setProperty('--tint-color', `${player.color}20`);
        card.classList.toggle('submitted', player.submitted);
        const textColor = (player.color === '#fff176') ? '#000000' : '#ffffff';
        const actionHtml = isMe ?
            `<div class="input-area">
                <input type="text" class="number-input" placeholder="-" value="${player.value || ''}" ${player.submitted ? 'disabled' : ''}>
                <button class="btn-submit" style="background-color: ${player.color}; color: ${textColor};">${player.submitted ? '취소' : '완료'}</button>
            </div>` :
            `<div class="player-status-display">${player.submitted ? '입력 완료!' : '입력 대기중...'}</div>`;
        card.innerHTML = `
            <div class="profile-section"><img src="${player.imageSrc}" class="profile-image-preview" alt="${player.name} profile"></div>
            <div class="content-section"><div class="player-info-text"><div class="player-name">${player.name}</div></div>${actionHtml}</div>`;
        return card;
    }

    function renderSidePanel(gameState) {
        document.getElementById('ranking-board').classList.toggle('hidden', isHistoryView);
        document.getElementById('history-board').classList.toggle('hidden', !isHistoryView);
        const title = isHistoryView ? '과거 질문' : '누적 랭킹';
        const buttonText = isHistoryView ? '랭킹 보기' : '과거 기록';
        document.getElementById('side-panel-title').textContent = title;
        document.getElementById('toggle-history-btn').textContent = buttonText;
        if (isHistoryView) renderHistoryBoard(gameState.history);
        else renderRankingBoard(Object.values(gameState.players));
    }

    function renderRankingBoard(players) {
        players.sort((a, b) => a.cumulativeScore - b.cumulativeScore);
        let rank = 1;
        players.forEach((p, i) => {
            if (i > 0 && players[i].cumulativeScore > players[i-1].cumulativeScore) rank = i + 1;
            p.cumulativeRank = rank;
        });
        const listItems = players.map(p => {
            const isFirst = p.cumulativeRank === 1;
            return `<li class="${isFirst ? 'first-place' : ''}" style="--rank-color: ${p.color}">
                <span class="rank">${isFirst ? '👑' : p.cumulativeRank}</span>
                <img src="${p.imageSrc}" class="profile-image-rank" alt="${p.name} profile">
                <span class="name">${p.name}</span>
                <span class="score">${p.cumulativeScore.toFixed(1)}%</span></li>`;
        }).join('');
        document.getElementById('ranking-board').innerHTML = `<ol>${listItems}</ol>`;
    }
    
    function renderHistoryBoard(history) {
        const historyBoard = document.getElementById('history-board');
        if (history.length === 0) {
            historyBoard.innerHTML = '<p style="text-align:center; color:#888;">기록이 없습니다.</p>';
            return;
        }
        const listItems = history.map((round, index) => `<li data-history-index="${index}">${round.question || '질문 없는 라운드'}</li>`).reverse().join('');
        historyBoard.innerHTML = `<ol>${listItems}</ol>`;
    }

    function renderResults(gameState) {
        const { question, average, players } = gameState.history[gameState.history.length-1];
        const rankingHtml = renderResultsHtml(players, average);
        const resultHtml = `
            <div id="result-summary">
                <div class="result-header"><h2>${question || '라운드 결과'}</h2></div>
                <p class="average-value">평균값: ${average.toFixed(2)}</p>
                <ol id="ranking-list">${rankingHtml}</ol>
            </div>`;
        document.getElementById('results').innerHTML = resultHtml;
        document.getElementById('main-game-area').classList.add('hidden');
        document.getElementById('question-container').classList.add('hidden');
        document.getElementById('results').classList.remove('hidden');
        document.getElementById('reset-round-button').classList.remove('hidden');
        document.getElementById('view-results-button').classList.add('hidden');
    }

    function renderPastResults(roundData) {
        const { question, average, players } = roundData;
        const rankingHtml = renderResultsHtml(players, average);
        const resultHtml = `
            <div id="result-summary">
                <div class="result-header">
                    <h2>${question || '지난 라운드 결과'}</h2>
                    <button id="back-to-game-btn">게임으로 돌아가기</button>
                </div>
                <p class="average-value">평균값: ${average.toFixed(2)}</p>
                <ol id="ranking-list">${rankingHtml}</ol>
            </div>`;
        document.getElementById('results').innerHTML = resultHtml;
        document.getElementById('main-game-area').classList.add('hidden');
        document.getElementById('question-container').classList.add('hidden');
        document.getElementById('results').classList.remove('hidden');
        document.getElementById('reset-round-button').classList.add('hidden');
        document.getElementById('view-results-button').classList.add('hidden');
    }

    function formatNumber(num) {
        return Number.isInteger(num) ? num : num.toFixed(1);
    }

    function renderResultsHtml(players, average) {
        players.sort((a, b) => a.diff - b.diff);
        const maxDiffRatio = Math.max(...players.map(p => p.diffRatio), 1);
        let rank = 1;
        return players.map((p, i) => {
            if (i > 0 && players[i].diff > players[i-1].diff) rank = i + 1;
            const isWinner = rank === 1;
            const barWidth = (p.diffRatio / maxDiffRatio) * 100;
            return `<li class="${isWinner ? 'winner' : ''}">
                <div class="player-info"><span class="rank-display">${isWinner ? '👑' : `${rank}위`}</span>
                <img src="${p.imageSrc}" class="profile-image-result" alt="${p.name} profile">
                <span>${p.name}</span></div>
                <div class="result-details"><span class="submitted-value">입력: <b>${p.value}</b></span>
                <span class="diff-value">(차이: ${formatNumber(p.diff)}, 비율: ${p.diffRatio.toFixed(1)}%)</span>
                <div class="diff-bar-wrapper"><div class="diff-bar" style="width: ${barWidth}%; background-color: ${p.color};"></div></div></div></li>`;
        }).join('');
    }

    function showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    }
});