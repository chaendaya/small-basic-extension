import * as fs from 'fs';

// JSON 파일의 데이터 구조 정의
interface TokenInfo {
    type: "STRING" | "PATTERN" | "COMPLEX";
    content: string;
}

type TokenMapping = Record<string, TokenInfo>;

export class TokenMapper {
    private mapping: TokenMapping;

    constructor(jsonPath: string) {
        const rawData = fs.readFileSync(jsonPath, 'utf-8');
        this.mapping = JSON.parse(rawData);
    }

    /**
     * 내부 토큰 이름을 LLM에게 전달할 친숙한 이름으로 변환합니다.
     */
    public getHumanReadableName(tokenName: string): string {
        const info = this.mapping[tokenName];

        // 1. 매핑 정보가 없으면 원래 이름 반환
        if (!info) return tokenName;

        // 2. 단순 문자열 (String Literal)인 경우 내용 반환
        // 예: "=" -> "=", ":" -> ":"
        if (info.type === 'STRING') {
            return info.content;
        }

        // 3. 패턴(Regex)인 경우
        if (info.type === 'PATTERN') {
            // [핵심 로직] 이름이 "의미 있는 이름"인지 "자동 생성된 이름"인지 판단
            if (this.isGeneratedName(tokenName)) {
                // 자동 생성된 이름(Stmt_token1 등)이면 -> 정규식을 해석해서 단어로 변환
                // 예: [Ss][Tt][Ee][Pp] -> Step
                return this.cleanRegex(info.content, tokenName);
            } else {
                // 이미 의미 있는 이름(ID, STR, NUM 등)이면 -> 이름 그대로 사용
                // 예: ID -> ID
                return tokenName;
            }
        }

        // 4. 복잡한 타입(COMPLEX)은 그냥 이름 사용 (Comment 등)
        return tokenName;
    }

    /**
     * 토큰 이름이 Tree-sitter가 자동 생성한 익명 토큰인지 확인합니다.
     * 보통 "_token숫자"로 끝나는 경우입니다.
     */
    private isGeneratedName(name: string): boolean {
        // 예: Stmt_token1, OptStep_token1, CR_token1
        return /_token\d+$/.test(name);
    }

    /**
     * 정규표현식을 사람이 읽기 좋은 텍스트로 변환합니다.
     */
    private cleanRegex(regex: string, originalName: string): string {
        // Case A: [Ss][Tt][Ee][Pp] 형태의 대소문자 무시 패턴
        // 대괄호 [...] 패턴이 포함되어 있다면 변환 시도
        if (regex.includes('[')) {
            // \[ (.) [^\]]* \] : 대괄호 열고, 첫 글자 캡처($1), 나머지 무시, 대괄호 닫고
            // 예: [Ss] -> S, [Tt] -> T
            const simplified = regex.replace(/\[(.)[^\]]*\]/g, '$1');
            
            // 변환 결과가 깔끔한 알파벳 단어라면 반환 (특수문자 섞여있으면 보류)
            if (/^[a-zA-Z0-9]+$/.test(simplified)) {
                return simplified;
            }
        }

        // Case B: 이스케이프 문자 처리 (필요시)
        if (regex === "\\r\\n") return "<CRLF>";
        if (regex === "\\n") return "<LF>";

        // Case C: 변환하기 너무 복잡하거나 실패하면 원래 토큰 이름(혹은 다른 플레이스홀더) 반환
        return originalName; 
    }
}