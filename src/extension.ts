/**
 * @file extension.ts
 * @brief Small Basic VS Code 확장 프로그램의 메인 진입점
 * * 이 확장은 크게 두 단계로 동작한다:
 * Step 1. [Ctrl+Space] -> 'extension.promptkey': 현재 커서 위치를 파싱하여 '구조적 후보'를 도출 (C++ Addon)
 * Step 2. [Callback]   -> 'extension.subpromptkey': 도출된 구조를 바탕으로 LLM에게 코드를 요청하고 자동완성 목록에 표시
 */

import * as vscode from "vscode";
import { SbCompletionService } from "./sbCompletionService";

// document : Open text document in VSCode
// position : Current cursor position
let CompletionProvider: any;
let candidatesData: CompletionItem[];
let currentCompletionService: SbCompletionService | undefined;

// 구조적 후보 데이터 타입 정의
type CompletionItem = {
  key: string;      // 예: "[ID, =, STR]"
  value: number;    // 빈도수
  sortText: string; // 정렬 순위
};

/**
 * @brief 확장 프로그램 활성화 함수 (VS Code가 실행될 때 최초 1회 호출)
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("Running the VSC Extension");

  // =============================================================================
  // [Helper Functions] 전처리 및 유틸리티
  // =============================================================================
  /**
   * [Helper 1] 패턴 가독성 변환 (Humanize)
   * 파서의 원시 토큰(Raw Token)을 LLM이 이해하기 쉬운 자연어 힌트로 변환한다.
   * 예: "[ID, =, STR]" -> "Identifier = String"
   */
  function humanizePattern(pattern: string): string {
    return pattern
      .replace(/^\[|\]$/g, "") // 대괄호 제거
      .replace(/,/g, "")       // 쉼표 제거
      .replace(/\bID\b/g, "Identifier")
      .replace(/\bSTR\b/g, "String")
      .replace(/\bNUM\b/g, "Number")
      .replace(/\bExpr\b/g, "Expression")
      .replace(/\bCR\b/g, "\n") // 줄바꿈 명시
      .replace(/\s+/g, " ")     // 공백 정리
      .trim();
  }

  /**
   * [Helper 2] 코드 정규화 (Normalization)
   * 사용자의 입력 스타일(띄어쓰기 등)과 AI의 출력 스타일을 비교하기 위해
   * 공백을 제거하고 표준 형태로 만든다.
   */
  function normalizeCode(text: string): string {
    return text
      .replace(/\s*\(\s*/g, "(")
      .replace(/\s*\)\s*/g, ")")
      .replace(/\s*=\s*/g, "=")
      .replace(/\s*>\s*/g, ">")
      .replace(/\s*<\s*/g, "<")
      .trim();
  }

  /**
   * [Helper 3] LLM 응답 후처리 (Refinement)
   * AI가 생성한 코드에서 중복된 접두사나 의미 없는 반복을 제거한다.
   * @param responseText LLM이 생성한 원본 응답
   * @param normalizedFullContext 비교용 전체 문맥 (정규화됨)
   * @param normalizedLineContext 비교용 현재 라인 (정규화됨)
   * @param structuralHint AI에게 주었던 힌트 (단순 반복 체크용)
   */
  function refineLLMResponse(
    responseText: string,
    normalizedFullContext: string,
    normalizedLineContext: string,
    structuralHint: string
  ): string | null {
      // 1. 응답 정규화
      const normalizedResponse = normalizeCode(responseText);

      // 2. 힌트 단순 반복 체크 (AI가 힌트를 그대로 뱉는 경우 필터링)
      const normalizedHint = structuralHint.replace(/\s/g, "");
      if (normalizedResponse.replace(/\s/g, "") === normalizedHint) {
          console.log("-> Skipped: LLM just repeated the hint.");
          return null;
      }

      // 3. 접두어 중복 제거 로직
      let finalText = responseText;

      // case 1: 전체 문맥과 겹치는 경우
      if (normalizedResponse.includes(normalizedFullContext)) {
          finalText = normalizedResponse.replace(normalizedFullContext, '');
      }
      // case 2: 현재 라인과 겹치는 경우
      else if (normalizedResponse.includes(normalizedLineContext)) {
          finalText = normalizedResponse.replace(normalizedLineContext, '');
      }

      // 4. 최종 포맷팅 (연산자 공백 추가 등)
      finalText = finalText
          .replace(/=/g, " = ")
          .replace(/</g, " < ")
          .replace(/>/g, " > ")
          .trim();

      return finalText;
  }

  /**
   * [Helper 4] VS Code CompletionItem 생성
   * 최종 텍스트를 VS Code 자동완성 UI 객체로 포장한다.
   */
  function createCompletionItem(
    finalText: string,
    cleanKey: string,
    value: number,
    sortText: string,
    lineContext: string
  ): vscode.CompletionItem {
      const item = new vscode.CompletionItem(finalText);

      item.kind = vscode.CompletionItemKind.Snippet;
      item.sortText = sortText;       // 빈도수 기반 정렬 순위 강제
      item.filterText = lineContext;  // 타이핑 중 사라짐 방지

      item.insertText = new vscode.SnippetString(finalText);

      // 우측 상세 설명창
      item.documentation = new vscode.MarkdownString()
        .appendMarkdown(`**Structure:** \`${cleanKey}\`\n\n`)
        .appendMarkdown(`**Frequency:** ${value}\n\n`)
        .appendCodeblock(finalText, "smallbasic");
      
      return item;
  }


  // =============================================================================
  // [Step 2] LLM 기반 텍스트 생성 및 자동완성 UI 표시 ("extension.subpromptkey")
  // =============================================================================
  // * 실행 시점: 파서가 구조적 후보를 찾은 직후 (Step 1의 Callback)
  const promptCommand = vscode.commands.registerCommand(
    "extension.subpromptkey",
    () => {
      // 1. 기존 리소스 정리 (이전 자동완성 공급자 해제)
      const disposable = vscode.Disposable.from(CompletionProvider);
      disposable.dispose();

      // 2. 새로운 자동완성 공급자 등록
      CompletionProvider = vscode.languages.registerCompletionItemProvider(
        ["smallbasic"],
        {
          async provideCompletionItems(
            document: vscode.TextDocument,
            position: vscode.Position
          ):Promise<any> {
            const completionItems: vscode.CompletionItem[] = [];
            let scroll = 0;
            const maxScroll = 3;  // 상위 3개만 LLM 요청

            // --- 구조적 후보 순회 및 LLM 요청 ---
            for (const { key, value, sortText } of candidatesData) {
              if (scroll >= maxScroll) { break;}

              // 2-1. 구조적 후보를 LLM 프롬프트 용으로 변환
              const cleanKey = key.replace(/^\[|\]$/g, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
              const structCandidate = humanizePattern(key);
              console.log(`[Processing Candidate ${scroll + 1}] Key: ${cleanKey}, Hint: ${structCandidate}`);

              // 2-2. 문맥 수집
              // 현재 커서 앞쪽의 전체 텍스트 수집
              const fullContext = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
              const normalizedFullContext = normalizeCode(fullContext);

              // 현재 라인의 텍스트만 별도로 수집
              const lineContext = document.lineAt(position).text.slice(0, position.character);
              const normalizedLineContext = normalizeCode(lineContext);

              // 2-3. LLM 코드 생성 요청 (Service 호출)
              let responseText = "";
              if (currentCompletionService) {
                  responseText = await currentCompletionService.getTextCandidate(structCandidate, fullContext);
              }

              // 2-4. 응답 정제
              // : AI가 생성한 코드에서 사용자가 이미 타이핑한 부분을 제거
              if (responseText) {
                console.log(`[LLM Raw Response] ${responseText}`);

                const finalText = refineLLMResponse(
                  responseText,
                  normalizedFullContext,
                  normalizedLineContext,
                  structCandidate
                );
                
                if (!finalText) continue;
                
                console.log(`[Final Text Candidate] ${finalText}`);

                // 2-5. UI 아이템 생성 및 추가
                const completionItem = createCompletionItem(
                  finalText,
                  cleanKey,
                  value,
                  sortText,
                  lineContext
                );
                completionItems.push(completionItem);
              }
              scroll++;
            }
            return completionItems;
          },

          // 3. 아이템 선택 시 처리 (Resolution)
          // : 사용자가 추천 리스트에서 엔터를 눌러 항목을 선택했을 때 호출
          async resolveCompletionItem(item: vscode.CompletionItem) {
            return item;
          }
        }
      );
      // // VS Code에게 자동완성 창 띄우기 지시
      vscode.commands.executeCommand("editor.action.triggerSuggest");
    }
  );

  // =============================================================================
  // [Step 1] 진입점: 파싱 요청 및 워크플로우 시작 ("extension.promptkey")
  // =============================================================================
  // * 실행 시점: 사용자가 단축키(Ctrl+Space)를 눌렀을 때
  const PromptKeyProvider = vscode.commands.registerCommand(
      "extension.promptkey",
      () => {
          const activeEditor = vscode.window.activeTextEditor;

          if (activeEditor) {
              const document = activeEditor.document;

              // 1. 현재 에디터 상태 수집
              const cursorPosition = activeEditor.selection.active;
              const fullText = document.getText(); // 전체 소스 코드
              const row = cursorPosition.line + 1;      // 커서 행
              const col = cursorPosition.character + 1; // 커서 열

              // 2. Service 인스턴스 생성 (파서 및 LLM 클라이언트 초기화)
              const completionService = new SbCompletionService(
                context.extensionPath,
                fullText, 
                row, 
                col
              );
              currentCompletionService = completionService;

              // 3. 콜백 설정: 파싱이 완료되면 실행될 로직 정의
              completionService.onDataReceived((data: any) => {
                  candidatesData = data;  // 전역 변수에 구조 후보 데이터 저장
                  
                  // 5. Step 2 (자동완성 로직 트리거) 실행
                  vscode.commands.executeCommand("extension.subpromptkey"); 
              });

              // 4. 파싱 시작 (구조적 후보 도출 요청)
              completionService.getStructCandidates();

          } else {
              console.log("There are currently no open editors.");
          }
      }
  );  
  // 확장 프로그램에 명령어 등록
  context.subscriptions.push(
    promptCommand,
    PromptKeyProvider
  );
}

// 확장 비활성화 시 호출
export function deactivate() {}
