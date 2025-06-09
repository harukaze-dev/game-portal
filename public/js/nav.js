// public/js/nav.js

// 모든 게임 목록을 여기에서 관리합니다.
// 나중에 게임을 추가하면 이 배열에만 추가하면 됩니다.
const games = [
    { name: '평균값 게임', path: '/01.average-game' },
    { name: '소수결 게임', path: '/02.minority-game' },
    { name: '워드 마피아', path: '/03.word-mafia' }
    // { name: '새로운 게임', path: '/new-game' } // <-- 이런 식으로 추가
];

// 현재 페이지의 경로를 가져옵니다 (예: '/01.average-game')
const currentPagePath = window.location.pathname;

// 네비게이션 바를 생성하는 함수
function createNavBar() {
    // 네비게이션 바의 HTML 구조를 만듭니다.
    const navBar = document.createElement('nav');
    navBar.className = 'game-nav';

    const homeLink = document.createElement('a');
    homeLink.href = '/';
    homeLink.className = 'nav-home-button';
    homeLink.innerHTML = '🏠 홈으로';
    
    const navLinksContainer = document.createElement('div');
    navLinksContainer.className = 'nav-links';

    // games 배열을 순회하며 각 게임 링크를 생성합니다.
    games.forEach(game => {
        const gameLink = document.createElement('a');
        gameLink.href = game.path;
        gameLink.className = 'nav-link';
        gameLink.textContent = game.name;

        // 현재 페이지와 경로가 일치하면 'active' 클래스를 추가합니다.
        if (game.path === currentPagePath) {
            gameLink.classList.add('active');
        }
        navLinksContainer.appendChild(gameLink);
    });

    navBar.appendChild(homeLink);
    navBar.appendChild(navLinksContainer);

    // body의 가장 첫 번째 자식으로 네비게이션 바를 삽입합니다.
    document.body.prepend(navBar);
}

// HTML 문서가 로드되면 네비게이션 바 생성 함수를 실행합니다.
document.addEventListener('DOMContentLoaded', createNavBar);