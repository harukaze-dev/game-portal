// public/09.name-game/image_db.js

// 게임에서 사용할 이미지 목록 데이터베이스
// 0001.png부터 0559.png까지의 이미지 정보를 생성합니다.
const imageDB = [];
for (let i = 1; i <= 559; i++) {
    // 숫자를 4자리 문자열로 변환 (예: 1 -> '0001', 123 -> '0123')
    const id = String(i).padStart(4, '0');
    imageDB.push({
        id: i, // 고유 ID (숫자)
        path: `/assets/name-game-images/${id}.png` // 이미지 파일 경로
    });
}

// [수정] Node.js 환경(서버)과 브라우저 환경(클라이언트) 모두에서 작동하도록 수정
// 서버(server.js)에서 require()로 이 파일을 불러올 때 imageDB 배열을 정상적으로 인식하게 만듭니다.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { imageDB };
}


// 주의: 이 스크립트가 실행되려면 실제로 /public/assets/name-game-images/ 폴더 안에
// 0001.png, 0002.png, ..., 0559.png 파일들이 존재해야 합니다.
// 지금은 파일이 없으므로 이미지가 깨져 보일 수 있습니다.