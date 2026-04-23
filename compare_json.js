const fs = require('fs');
const path = require('path');
const util = require('util');

// 비교할 두 폴더 경로 (역슬래시 \ 는 \\ 로 이스케이프 처리)
const dir1 = 'C:\\PL\\moniExtension\\Small-Basic-Extension\\src\\SB_DB_json';
const dir2 = 'C:\\PL\\moniExtension\\Small-Basic-Extension\\src\\SB_DB_TS1_json';

// 폴더가 존재하는지 확인
if (!fs.existsSync(dir1) || !fs.existsSync(dir2)) {
    console.error("폴더 경로를 찾을 수 없습니다. 경로를 확인해주세요.");
    process.exit(1);
}

// dir1의 파일 목록을 가져옴 (.json 파일만)
const files1 = fs.readdirSync(dir1).filter(file => file.endsWith('.json'));

console.log(`[비교 시작] ${dir1}  <-->  ${dir2}\n`);

let matchCount = 0;
let mismatchCount = 0;
let missingCount = 0;

files1.forEach(fileName => {
    const file1Path = path.join(dir1, fileName);
    const file2Path = path.join(dir2, fileName);

    // dir2에도 같은 파일이 있는지 확인
    if (!fs.existsSync(file2Path)) {
        console.log(`[누락] ${fileName} 파일이 두 번째 폴더에 없습니다.`);
        missingCount++;
        return;
    }

    try {
        // 파일 읽기 및 JSON 파싱
        const json1 = JSON.parse(fs.readFileSync(file1Path, 'utf8'));
        const json2 = JSON.parse(fs.readFileSync(file2Path, 'utf8'));

        // 깊은 비교 (Deep Comparison)
        // util.isDeepStrictEqual은 객체의 구조와 값이 정확히 일치하는지 검사
        // 배열 내부의 순서까지 일치해야 같다고 판단
        const isMatch = util.isDeepStrictEqual(json1, json2);

        if (isMatch) {
            console.log(`[일치] ${fileName}`);
            matchCount++;
        } else {
            console.log(`[불일치] ${fileName}`);
            compareObjects(json1, json2); 
            mismatchCount++;
        }

    } catch (err) {
        console.error(`[에러] ${fileName} 처리 중 오류 발생:`, err.message);
    }
});

console.log('---------------------------------------------------');
console.log(`결과 요약: 일치(${matchCount}), 불일치(${mismatchCount}), 누락(${missingCount})`);

// 불일치 시 차이점을 간단히 출력하는 함수
function compareObjects(obj1, obj2) {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    // 키 개수 비교
    if (keys1.length !== keys2.length) {
        console.log(`   -> 키 개수가 다릅니다. (Folder1: ${keys1.length}, Folder2: ${keys2.length})`);
    }

    // 각 키의 값 비교 (일부만 샘플링)
    keys1.forEach(key => {
        if (!util.isDeepStrictEqual(obj1[key], obj2[key])) {
            console.log(`   -> Key "${key}"의 값이 다릅니다.`);
            console.log(`      File1: ${JSON.stringify(obj1[key]).substring(0, 50)}...`);
            console.log(`      File2: ${JSON.stringify(obj2[key] || "undefined").substring(0, 50)}...`);
        }
    });
}