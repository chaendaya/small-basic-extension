/**
 * @file SbCompletionService.ts
 * @brief Small Basic 자동완성 서비스의 핵심 로직을 담당하는 클래스
 * * 이 클래스는 다음 3가지 핵심 모듈을 조율합니다:
 * 1. Native C++ Parser (Addon): 현재 커서 위치의 파싱 상태(State ID)를 분석
 * 2. JSON Database: 파싱 상태에 따른 구조적 후보군(Structual Candidates) 조회
 * 3. OpenAI LLM: 구조적 후보를 바탕으로 텍스트 후보(Textual Candidate) 생성
 */

import * as vscode from "vscode";
import * as fs from "fs";
import OpenAI from "openai";
import * as path from "path";
import { SYSTEM_ROLE, generateCompletionPrompt } from "./prompts";

// 구조적 후보 데이터 인터페이스 (DB 저장 형태)
interface StructCandidate {
  key: string;    // 예: "[ID, =, STR]"
  value: number;  // 빈도수
}

// 상태 ID를 키로 하는 후보군 DB 인터페이스
interface CandidateDB {
  [stateId: string]: StructCandidate[];
}

export class SbCompletionService {
    private parserAddon: any;
    private fullText: string;
    private row: number;
    private col: number;
    private dataReceivedCallback: ((data: any) => void) | null = null;
    
    // 모든 인스턴스가 공유하는 정적 DB
    private static candidateDB: CandidateDB | null = null;
    private openai: OpenAI | undefined;

    /** 생성자
     * @brief 서비스 초기화 및 리소스 로딩
     * @param extensionPath 확장 프로그램의 루트 경로 (리소스 파일 접근용)
     * @param fullText 에디터의 전체 소스 코드
     * @param row 커서 행
     * @param col 커서 열
     */
    constructor(extensionPath: string, fullText: string, row: number, col: number) {
        this.fullText = fullText;
        this.row = row;
        this.col = col;

        // ---------------------------------------------------------
        // 1. OpenAI API Key 로딩 (secrets.json)
        // ---------------------------------------------------------
        let apiKey = "";
        try {
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

        if (!apiKey) {
            vscode.window.showErrorMessage("API Key가 없습니다. 프로젝트 루트에 secrets.json을 생성하고 키를 넣어주세요.");
            console.error("[Error] OpenAI API Key is missing.");
        } else {
            this.openai = new OpenAI({
                apiKey: apiKey, 
            });
        }

        // ---------------------------------------------------------
        // 2. Native C++ Addon 로딩
        // ---------------------------------------------------------
        const addonPath = path.join(extensionPath, 'build', 'Release', 'sb_parser_addon.node');
        try {
            // .node 모듈은 동적으로 require
            this.parserAddon = require(addonPath);
        } catch (e) {
            console.error(`[CRITICAL] Addon 로딩 실패! 경로: ${addonPath}`, e);
            vscode.window.showErrorMessage("파서 모듈을 찾을 수 없습니다.");
        }

        // ---------------------------------------------------------
        // 3. 구조적 후보 DB 로딩
        // ---------------------------------------------------------
        if (!SbCompletionService.candidateDB) {
          this.loadCandidateDB(extensionPath);
        }
    }
    
    // =========================================================================
    // [DB] Database Management
    // =========================================================================  
    /**
     * @brief 로컬 JSON 파일에서 구조적 후보 데이터를 메모리로 로드한다.
     */
    private loadCandidateDB(extensionPath: string) {
      try {
        const jsonPath = path.join(extensionPath, 'src', 'smallbasic_candidates.json');
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

    /**
     * @brief 파서 상태(State ID)에 매핑되는 구조적 후보들을 조회한다.
     * @param states 파서가 반환한 상태 ID
     * @returns 정렬된 후보 목록
     */
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
                    // VS Code UI에서 빈도수 순서를 유지하기 위해 sortText 강제 설정
                    // "001", "002" ... 순으로 생성됨
                    sortText: (result.length + 1).toString().padStart(3, "0") 
              });
          });
        }
      }
      console.log("result", JSON.stringify(result));
      return result;
    }

    // =========================================================================
    // [Core Logic 1] Structural Candidates
    // =========================================================================
    /**
     * @brief 비동기 데이터 처리를 위한 콜백 등록
     * 구조적 후보 조회가 완료되면 호출된다.
     */
    public onDataReceived(callback: (data: any) => void) {
        this.dataReceivedCallback = callback;
    }

    /**
     * @brief [Step 1] 파서 상태 분석 및 구조적 후보 도출
     * C++ Addon을 호출하여 현재 커서 위치의 파싱 상태를 얻고,
     * DB에서 후보를 조회하여 콜백으로 전달한다.
     */
    public getStructCandidates() {
        try {
            console.log(`Requesting Parse: Row ${this.row}, Col ${this.col}`);

            // 1. C++ Addon 호출 (동기 방식이라 즉시 결과가 나옴)
            // Tree-sitter 파싱을 수행하고 현재 커서 위치의 State ID를 반환받음
            const stateNumber = this.parserAddon.getPhysicalState(this.fullText, this.row, this.col);
            console.log("Parsed State ID:", stateNumber);

            // 2. DB 조회 (State ID -> Structural Candidates)
            let currentState = typeof stateNumber === 'number' ? [stateNumber] : []; 
            const structCandidates = this.lookupDB(currentState);

            // 3. 후보 정렬 (빈도수 내림차순)
            structCandidates.sort((a: any, b: any) => b.value - a.value);

            // 4. 결과 전달 (extension.ts로 콜백)
            if (this.dataReceivedCallback) {
                let completionItems: any[] = [];
                
                for (const item of structCandidates) {
                    completionItems.push({
                        key: item.key,           // 예: "[ID, =, STR]"
                        value: item.value,       // 빈도수
                        sortText: item.sortText, // 정렬 순서
                    });
                }
                this.dataReceivedCallback(completionItems);
            }
        } catch (e) {
            console.error("Parser Error:", e);
        }
    }

    // =========================================================================
    // [Core Logic 2] Textual Candidates (LLM)
    // =========================================================================
    /**
     * @brief [Step 2] LLM을 이용한 실제 코드 생성
     * 구조적 후보와 문맥(Context)을 조합하여 OpenAI에 코드를 요청한다.
     * * @param structCandidate 구조적 후보 (예: "Identifier = String")
     * @param fullContext 커서 이전까지의 전체 코드 문맥
     * @returns LLM이 생성한 코드 문자열
     */
    public async getTextCandidate(
      structCandidate: string,
      fullContext: string
    ): Promise<string> {

        try {
            // 1. 프롬프트 구성 (prompts.ts)
            const prompt = generateCompletionPrompt(fullContext, structCandidate);
            console.log(`[LLM Prompt] ${prompt}`);

            // 2. OpenAI API 호출
            if (!this.openai) { return ""; }
            
            const chat_completion = await this.openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: SYSTEM_ROLE },
                    { role: "user", content: prompt }
                ]
            });

            const response = chat_completion.choices[0].message.content?.trim() || "";
            console.log(`[LLM Response] ${response}`);

            return response;
          
        } catch (error) {
            console.error("[LLM Error]", error);
            // 에러 발생 시 Extension이 멈추지 않도록 빈 문자열 반환
            return "";
        }
    }
}