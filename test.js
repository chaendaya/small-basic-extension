// test.js
const addon = require('./build/Release/sb_parser_addon');

console.log("==========================================");
console.log("   Small Basic Parser Addon Test Start");
console.log("==========================================\n");

// 1. 테스트할 Small Basic 소스 코드
// (일부러 완성되지 않은 문장을 넣어 Recover State를 잘 찾는지 봅니다)
const sourceCode = `TextWindow.Write("Hello")
If (x > 10) Then
  TextWindow.
EndIf
`;

// 2. 테스트 시나리오 설정
// 상황: 3번째 줄(index 2)의 "TextWindow." 뒤에 커서가 있다고 가정
// 목표: 여기서 어떤 상태(State ID)를 반환하는지 확인
const testRow = 2; // 3번째 줄이므로 2
const testCol = 13; // "TextWindow." 의 길이 (점 바로 뒤)

try {
    console.log(`[입력 데이터]`);
    console.log(`- 소스 코드 길이: ${sourceCode.length} 자`);
    console.log(`- 커서 위치: Row ${testRow}, Col ${testCol}`);
    console.log("------------------------------------------");

    // 3. 함수 실행 (addon.cc에 정의된 getPhysicalState 호출)
    // 인자 순서: (Code, Row, Col)
    const stateId = addon.getPhysicalState(sourceCode, testRow, testCol);

    // 4. 결과 출력
    console.log(`✅ [실행 성공]`);
    console.log(`👉 반환된 State ID: ${stateId}`);
    
    if (typeof stateId === 'number') {
        console.log("   (타입 확인: Number OK)");
    } else {
        console.warn("   (경고: 반환 타입이 Number가 아닙니다)");
    }

} catch (e) {
    console.error("❌ [실행 실패] 에러 발생:");
    console.error(e);
}

console.log("\n==========================================");