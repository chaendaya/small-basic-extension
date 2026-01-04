// 프로그래밍 언어 명칭
const LANGUAGE_NAME = "Microsoft Small Basic programming language";

// 시스템 역할 (System Role)
// from ChatGPT-Code-Completion-Work/prompt engineering code completion.py
export const SYSTEM_ROLE = "You are a helpful assistant that provides programming code suggestions while typing code in an IDE (Integrated Development Environment). Just answer concisely and place your answer after the provided code.";

/**
 * 논문 Figure 5의 템플릿 기반
 * * @param fullContext 사용자가 작성 중인 코드 ({Program Prefix})
 * @param structCandidate 제안된 구조적 후보 ({Suggested Structural Candidate})
 * @returns 완성된 프롬프트 문자열
 */
export function generateCompletionPrompt(fullContext: string, structCandidate: string): string {
    // 논문 Figure 6의 예시처럼 구조적 후보를 명확히 하기 위해 작은따옴표(')로 감싸는 것이 안전합니다.
    // 예: '(Expr)' 
    const quotedHint = `'${structCandidate}'`;

    return `This is the incomplete ${LANGUAGE_NAME} code:
${fullContext}
${quotedHint}
Complete the ${quotedHint} part of the code
in the ${LANGUAGE_NAME}.
Just show your answer in place of ${quotedHint}.`;
}