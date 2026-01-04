import * as vscode from "vscode";
import * as fs from "fs";
import OpenAI from "openai";
import * as path from "path";

interface StructCandidate {
  key: string;
  value: number;
}

interface CandidateDB {
  [stateId: string]: StructCandidate[];
}

export class SbCompletionService {
    private parserAddon: any;
    private fullText: string;
    private row: number;
    private col: number;
    private dataReceivedCallback: ((data: any) => void) | null = null;
    private static candidateDB: CandidateDB | null = null;
    private openai: OpenAI | undefined;

    // 생성자: 전체 텍스트와 커서 위치를 받습니다.
    // 생성자에서 extensionPath(확장 프로그램의 실제 설치 경로)를 받습니다.
    constructor(extensionPath: string, fullText: string, row: number, col: number) {
        this.fullText = fullText;
        this.row = row;
        this.col = col;

        let apiKey = "";
        try {
            // secrets.json 경로 설정 (확장 프로그램 루트 폴더 기준)
            const secretPath = path.join(extensionPath, 'secrets.json');
            
            if (fs.existsSync(secretPath)) {
                const secretData = fs.readFileSync(secretPath, 'utf8');
                const secrets = JSON.parse(secretData);
                apiKey = secrets.apiKey;
                console.log("[Info] Loaded API Key from secrets.json");
            } else {
                console.error(`[Error] secrets.json not found at: ${secretPath}`);
            }
        } catch (err) {
            console.error("[Error] Failed to read secrets.json:", err);
        }

        // 키 검증 및 초기화
        if (!apiKey) {
            vscode.window.showErrorMessage("API Key가 없습니다. 프로젝트 루트에 secrets.json을 생성하고 키를 넣어주세요.");
            console.error("[Error] OpenAI API Key is missing.");
        } else {
            this.openai = new OpenAI({
                apiKey: apiKey, 
            });
        }

        // Addon 로딩
        // extensionPath/build/Release/sb_parser_addon.node 경로를 만듭니다.
        const addonPath = path.join(extensionPath, 'build', 'Release', 'sb_parser_addon.node');
        try {
            // 동적 require 실행
            this.parserAddon = require(addonPath);
        } catch (e) {
            console.error(`[CRITICAL] Addon 로딩 실패! 경로: ${addonPath}`, e);
            vscode.window.showErrorMessage("파서 모듈을 찾을 수 없습니다.");
        }

        // 생성자에서 DB 로딩 시도
        if (!SbCompletionService.candidateDB) {
          this.loadCandidateDB(extensionPath);
        }
      }
      
      // JSON 파일 로드 함수
      private loadCandidateDB(extensionPath: string) {
        try {
          const jsonPath = path.join(extensionPath, 'src', 'smallbasic_candidates_small.json');
          console.log(`[Info] Loading Candidate DB from: ${jsonPath}`);
          if (fs.existsSync(jsonPath)) {
                const rawData = fs.readFileSync(jsonPath, 'utf8');
                SbCompletionService.candidateDB = JSON.parse(rawData);
                console.log("[Info] Candidate DB loaded successfully.");
          } else {
                console.error(`[Error] Candidate JSON not found at: ${jsonPath}`);
                vscode.window.showErrorMessage("자동완성 데이터 파일을 찾을 수 없습니다.");
          }
        } catch (e) {
            console.error("[Error] Failed to load Candidate DB:", e);
        }
      }

    // 콜백 등록 함수 (기존 유지)
    public onDataReceived(callback: (data: any) => void) {
        this.dataReceivedCallback = callback;
    }

    // 소켓 통신 로직을 Addon 호출로 대체
    public getStructCandidates() {
        try {
            console.log(`Requesting Parse: Row ${this.row}, Col ${this.col}`);

            // 1. C++ Addon 호출 (동기 방식이라 즉시 결과가 나옴)
            const stateNumber = this.parserAddon.getPhysicalState(this.fullText, this.row, this.col);
            console.log("Parsed State ID:", stateNumber);

            // 2. 상태 번호로 후보군 조회 (기존 로직 재사용)
            // Addon은 숫자 하나만 줄 수도 있고, 에러시 예외를 던질 수도 있으니 배열 처리
            let stateList = typeof stateNumber === 'number' ? [stateNumber] : []; 
            
            const candidates = this.lookupDB(stateList);

            // 3. 후보 정렬 (빈도수 내림차순)
            candidates.sort((a: any, b: any) => b.value - a.value);

            // 4. 데이터 정제 및 반환
            if (this.dataReceivedCallback) {
                let completionItems: any[] = [];
                
                for (const item of candidates) {
                    let completionWord = item.key;
                    
                    // [변경 4] 정규식 대폭 축소
                    // Python 스크립트에서 이미 깔끔하게 처리했으므로 T/NT 제거 로직 삭제
                    // 입력 예: "[ID, =, Expr]" -> 출력 예: "ID = Expr"
                    completionWord = completionWord
                        .replace(/^\[|\]$/g, "") // 앞뒤 대괄호 제거
                        .replace(/,/g, "")       // 쉼표 제거
                        .replace(/\s+/g, " ")    // 공백 정리
                        .replace(/\bTO\b/g, " TO ")
                        .trim();

                    completionItems.push({
                        key: completionWord,     // 화면에 표시될 문자열
                        value: item.value,       // 빈도수
                        sortText: item.sortText, // 정렬 순서
                    });
                }

                // 콜백 실행
                this.dataReceivedCallback(completionItems);
            }

        } catch (e) {
            console.error("Parser Error:", e);
        }
    }

    //
    public lookupDB(states: number[]) {
      const result: any[] = [];
      const db = SbCompletionService.candidateDB;

      if (!db) {
        console.warn("[Warning] DB is not loaded yet.");
        return result;
      }

      for (const state of states) {
        const stateKey = state.toString();

        if (db[stateKey]) {
          const candidates = db[stateKey];

          // 해당 State의 후보들을 결과 배열에 추가
          candidates.forEach((item, index) => {
              result.push({
                    key: item.key,      // 예: "[ID, =, Expr]"
                    value: item.value,  // 예: 2119
                    // 순위 유지를 위한 sortText 생성
                    sortText: (result.length + 1).toString().padStart(3, "0") 
              });
          });
        }
      }
      console.log("result", JSON.stringify(result));
      return result;
    }

    /**
     *  A function that takes a completionItem and returns a code snippet conforming to Small Basic syntax.
     * @param completionItem
     * @returns placeholders
     */
    public async getInsertText(
      completionItem: string | vscode.CompletionItemLabel,
      resulted_prefix: string
    ): Promise<string> {

      // 1. 입력값 처리
      const rawKey = typeof completionItem === "string" ? completionItem : completionItem.label;

      // 2. 구조적 힌트 변환 (Humanize)
      // [ID, =, STR] -> Identifier = String 형태로 변환하여 LLM 이해도 향상
      const structuralHint = rawKey
            .replace(/^\[|\]$/g, "") // 대괄호 제거
            .replace(/,/g, "")       // 쉼표 제거
            .replace(/\bID\b/g, "Identifier")
            .replace(/\bSTR\b/g, "String")
            .replace(/\bNUM\b/g, "Number")
            .replace(/\bExpr\b/g, "Expression")
            .replace(/\bCR\b/g, "\n")
            .replace(/\s+/g, " ")
            .trim();
      console.log(`[LLM Request] Structure Hint: "${structuralHint}"`);

        try {
            // 3. 프롬프트 구성 (연구의 핵심: 구조 제약 조건 부여)
            const prompt = `
                You are a code completion assistant for Small Basic.

                [Context Code]
                ${resulted_prefix}

                [Task]
                Complete the code following the Context Code.
                Your completion MUST strictly follow this grammatical structure: "${structuralHint}"

                [Examples]
                Structure: "Identifier = String" -> Code: name = "John"
                Structure: "Identifier = Number" -> Code: age = 20
                Structure: "If Expression Then" -> Code: If x > 10 Then
                Structure: "Identifier . Identifier ( )" -> Code: TextWindow.Show()

                [Output]
                Provide ONLY the completed code snippet. No markdown, no explanation.
                `;
            
            // 4. OpenAI API 호출
            if (!this.openai) { return ""; }
            const chat_completion = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "You are a Small Basic expert." },
                    { role: "user", content: prompt }
                ]
            });

            const response = chat_completion.choices[0].message.content?.trim() || "";
            console.log(`[LLM Response] ${response}`);

            return response;
          
        } catch (error) {
            console.error("[LLM Error]", error);
            // 에러 발생 시 빈 문자열을 반환하여 Extension이 멈추지 않게 함
            return "";
        }
    }
}