// public/js/nav.js

// 모든 게임 목록을 여기에서 관리합니다.
const games = [
    { name: '평균값 게임', path: '/01.average-game' },
    { name: '소수결 게임', path: '/02.minority-game' },
    { name: '워드 마피아', path: '/03.word-mafia' }
];

const currentPagePath = window.location.pathname;

function createNavBar() {
    const navBar = document.createElement('nav');
    navBar.className = 'game-nav';

    const homeLink = document.createElement('a');
    homeLink.href = '/';
    homeLink.className = 'nav-home-button';
    homeLink.innerHTML = '🏠 홈으로';
    
    const navLinksContainer = document.createElement('div');
    navLinksContainer.className = 'nav-links';

    games.forEach(game => {
        const gameLink = document.createElement('a');
        gameLink.href = game.path;
        gameLink.className = 'nav-link';
        gameLink.textContent = game.name;

        if (game.path === currentPagePath) {
            gameLink.classList.add('active');
        }
        navLinksContainer.appendChild(gameLink);
    });

    // --- [추가] 햄버거 버튼 생성 ---
    const hamburgerButton = document.createElement('button');
    hamburgerButton.className = 'nav-hamburger';
    hamburgerButton.innerHTML = '☰'; // 햄버거 아이콘 (≡)

    // --- [수정] 네비게이션 바에 요소 추가 순서 변경 ---
    navBar.appendChild(homeLink);
    navBar.appendChild(navLinksContainer);
    navBar.appendChild(hamburgerButton); // 햄버거 버튼을 마지막에 추가

    document.body.prepend(navBar);

    // --- [추가] 햄버거 버튼 클릭 이벤트 ---
    hamburgerButton.addEventListener('click', () => {
        // .nav-links 컨테이너에 'active' 클래스를 토글(추가/제거)합니다.
        navLinksContainer.classList.toggle('active');
    });
}

document.addEventListener('DOMContentLoaded', createNavBar);