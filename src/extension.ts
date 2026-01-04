// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
// plz 'npm install' initial of cloneproject
import * as vscode from "vscode";
import { SbCompletionService } from "./sbCompletionService";

// document : Open text document in VSCode
// position : Current cursor position
// token : Whether the operation was canceled
// context : Context in which code completion is provided
// sendMessage : Text length
// cursorindex : Cursor position
// textArea : Entire text
let CompletionProvider: any;
let candidatesData: CompletionItem[];
let linePrefix: string;
let resulted_prefix: string;
let currentCompletionService: SbCompletionService | undefined;

type CompletionItem = {
  key: string;
  value: number;
  sortText: string;
};

export function activate(context: vscode.ExtensionContext) {
  console.log("Running the VSC Extension");

  // [Helper] 구조적 패턴을 LLM이 이해하기 쉬운 힌트로 변환
  // 예: "[ID, =, STR]" -> "Identifier = String"
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

  // [2] LLM을 통해 실제 삽입될 텍스트 생성
  const promptCommand = vscode.commands.registerCommand(
    "extension.subpromptkey",
    () => {
      // 1. 이전에 떠 있던 자동완성 창이나 공급자 제거
      const disposable = vscode.Disposable.from(CompletionProvider);
      disposable.dispose();

      // 2. 새 공급자 등록
      CompletionProvider = vscode.languages.registerCompletionItemProvider(
        ["smallbasic"],
        {
          // 구조적 후보를 실제 코드로 변환
          async provideCompletionItems(
            document: vscode.TextDocument,
            position: vscode.Position
          ):Promise<any> {
            const completionItems: vscode.CompletionItem[] = [];
            let scroll = 0;
            const maxScroll = 3;  // 상위 3개만 LLM 요청

            // 구조적 후보 순회 시작
            // candidatesData : 파싱 서버에서 받은 구조적 후보 리스트
            for (const { key, value, sortText } of candidatesData) {
              if (scroll >= maxScroll) { break;}

              // 2-1. 구조적 후보를 LLM 프롬프트 용으로 변환
              const cleanKey = key.replace(/^\[|\]$/g, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
              const structuralHint = humanizePattern(key);
              console.log(`[Processing Candidate ${scroll + 1}] Key: ${cleanKey}, Hint: ${structuralHint}`);

              // 2-2. 현재 커서 앞쪽의 전체 텍스트 수집
              resulted_prefix = document.getText(
                new vscode.Range(new vscode.Position(0, 0), position)
              );
              
              // 문맥 정규화
              // 정규식으로 괄호, 등호 주변 공백 제거 (비교를 위해)
              const normalizedresulted_prefix = resulted_prefix
                  .replace(/\s*\(\s*/g, "(")
                  .replace(/\s*\)\s*/g, ")")
                  .replace(/\s*=\s*/g, "=")
                  .replace(/\s*>\s*/g, ">")
                  .replace(/\s*<\s*/g, "<")
                  .trim();

              // 현재 라인의 텍스트만 별도로 수집 (비상용 비교군)
              // The value from the user's cursor position to the space. 
              // ex) If 'IF a = 10', it becomes 10. If 'IF a = 10 ', it becomes ''.
              linePrefix = document
                .lineAt(position)
                .text.slice(0, position.character);
              const normalizedlinePrefix = linePrefix
                .replace(/\s*\(\s*/g, "(")
                .replace(/\s*\)\s*/g, ")")
                .replace(/\s*=\s*/g, "=")
                .replace(/\s*>\s*/g, ">")
                .replace(/\s*<\s*/g, "<")
                .trim(); 

              // 2-3. LLM 코드 생성 요청
              // 구조적 후보(completion.label)와 현재 문맥(resulted_prefix)을 보냄
              let responseText = "";
              if (currentCompletionService) {
                  // ★ 중요: 단순 키워드가 아니라 "구조적 힌트"를 전달함
                  // SbSnippetGenerator 내부에서 "Complete code using structure: Identifier = String" 형태로 프롬프트 구성됨
                  responseText = await currentCompletionService.getInsertText(structuralHint, resulted_prefix);
              }

              // 2-4. 응답 정제 및 중복 제거
              // AI가 생성한 코드에서 사용자가 이미 타이핑한 부분을 제거
              if (responseText) {
                console.log(`[LLM Raw Response] ${responseText}`);

                // AI 응답도 정규화 (비교를 위해)
                const normalizedResponseText = responseText
                  .replace(/\s*\(\s*/g, "(")
                  .replace(/\s*\)\s*/g, ")")
                  .replace(/\s*=\s*/g, "=")
                  .replace(/\s*>\s*/g, ">")
                  .replace(/\s*<\s*/g, "<")
                  .trim();

                // 구조적 라벨 단순 반복 방지 (LLM이 힌트를 그대로 뱉는 경우)
                const normalizedHint = structuralHint.replace(/\s/g, "");
                if (normalizedResponseText.replace(/\s/g, "") === normalizedHint) {
                     console.log("-> Skipped: LLM just repeated the hint.");
                     continue; 
                }

                // 접두어 중복 제거 (Prefix Removal)
                // 예: 문맥이 "TextWindow." 이고 LLM이 "TextWindow.WriteLine"을 줬다면 "WriteLine"만 남김
                let finalText = responseText;

                // 전체 문맥과 겹치는 경우
                if (normalizedResponseText.includes(normalizedresulted_prefix)) {
                    finalText = normalizedResponseText.replace(normalizedresulted_prefix, '');
                } 
                // 현재 라인과 겹치는 경우 (보완책)
                else if (normalizedResponseText.includes(normalizedlinePrefix)) {
                    finalText = normalizedResponseText.replace(normalizedlinePrefix, '');
                }

                // 최종 포맷팅 (공백 예쁘게)
                finalText = finalText
                    .replace(/=/g, " = ")
                    .replace(/</g, " < ")
                    .replace(/>/g, " > ")
                    .trim();

                console.log(`[Final Insert Text] ${finalText}`);


                // 2-5. 최종적으로 VSCode에 띄울 아이템 생성
                const completionItem = new vscode.CompletionItem(finalText);
              
                completionItem.kind = vscode.CompletionItemKind.Snippet;
                completionItem.sortText = sortText; // 빈도수 순위 유지
                completionItem.filterText = linePrefix; // 타이핑해도 사라지지 않게 설정
                
                // 실제 삽입될 텍스트 (SnippetString 사용 가능)
                completionItem.insertText = new vscode.SnippetString(finalText);

                // 문서화 (우측 설명창): 어떤 구조에서 파생되었는지 설명
                completionItem.documentation = new vscode.MarkdownString()
                    .appendMarkdown(`**Structure:** \`${cleanKey}\`\n\n`)
                    .appendMarkdown(`**Frequency:** ${value}\n\n`)
                    .appendCodeblock(finalText, "smallbasic");

                completionItems.push(completionItem);
              }
              scroll++;
            }
            return completionItems;
          },

          // 3. 최종 선택 및 삽입 (Resolution)
          // 사용자가 추천 리스트에서 엔터를 눌러 항목을 선택했을 때 호출
          // 현재 커서 앞의 텍스트(prefix)와 선택한 코드(item)를 자연스럽게 결합
          async resolveCompletionItem(item: vscode.CompletionItem) {
            return item;
          }
        }
      );
      // 자동완성 창 띄우기
      vscode.commands.executeCommand("editor.action.triggerSuggest");
    }
  );

  // [1] Ctrl + C 진입점
  const PromptKeyProvider = vscode.commands.registerCommand(
      "extension.promptkey",
      () => {
          const activeEditor = vscode.window.activeTextEditor;

          if (activeEditor) {
              const document = activeEditor.document;

              // 1. 커서 위치 및 텍스트 정보 수집
              const cursorPosition = activeEditor.selection.active;
              
              // Tree-sitter에 필요한 핵심 정보 3가지
              const fullText = document.getText(); // 전체 소스 코드
              const row = cursorPosition.line + 1;     // 커서 행 (0-based)
              const col = cursorPosition.character + 1;// 커서 열 (0-based)

              // 2. Service 생성
              const completionService = new SbCompletionService(
                context.extensionPath,
                fullText, 
                row, 
                col
              );

              currentCompletionService = completionService;

              // 3. 결과를 받을 준비(Callback)
              completionService.onDataReceived((data: any) => {
                  candidatesData = data;
                  
                  // 3. LLM 커맨드 실행
                  vscode.commands.executeCommand("extension.subpromptkey"); 
              });

              // 4. 파스 상태 및 후보 요청
              completionService.getStructCandidates();

          } else {
              console.log("There are currently no open editors.");
          }
      }
  );  

  context.subscriptions.push(
    promptCommand,
    PromptKeyProvider
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
