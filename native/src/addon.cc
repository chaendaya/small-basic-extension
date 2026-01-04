#include <napi.h>
#include <iostream>
#include <string>
#include <vector>
#include <algorithm>

// tree_sitter/api.h를 포함합니다. (binding.gyp의 include_dirs 덕분에 경로 인식)
#include "tree_sitter/api.h"

// ================= [외부 함수 선언] =================

// 1. SmallBasic 파서 (정적 링크)
extern "C" TSLanguage *tree_sitter_smallbasic();

// 2. 사용자 커스텀 엔진 함수 (api.h에 선언이 없다면 extern 필요)
//    lib/src/parser.c 내부에 구현된 그 함수입니다.
extern "C" {
    TSStateId TsParserFindClosestRecoverState(TSParser *self, uint32_t StopRow, uint32_t StopColumn, TSLoggedAction *OutLog);
}


// ================= [헬퍼 함수: 위치 -> 바이트 오프셋] =================
// TreeSitterCutFile.cpp 에서 가져옴
// (VS Code의 행/열 좌표를 소스코드 문자열의 바이트 인덱스로 변환)
size_t FindByteOffsetForPosition(const std::string& text, uint32_t target_row, uint32_t target_col) {
    size_t current_offset = 0;
    uint32_t current_row = 0; 
    uint32_t current_col = 0; 
    const uint32_t tab_width = 4;

    while (current_offset < text.length()) {
        if (current_row > target_row || (current_row == target_row && current_col >= target_col)) {
             return current_offset;
        }

        unsigned char current_char = static_cast<unsigned char>(text[current_offset]);

        if (current_char == '\n') {
            current_row++;
            current_col = 0;
            current_offset++;
        } else if (current_char == '\r' && (current_offset + 1 < text.length() && text[current_offset + 1] == '\n')) {
            current_row++;
            current_col = 0;
            current_offset += 2;
        } else if (current_char == '\t') {
            current_col = ((current_col / tab_width) + 1) * tab_width;
            current_offset++;
        } else {
             current_col++;
             current_offset++;
             // UTF-8 멀티바이트 처리
             if (current_char >= 0xC0) { 
                 while (current_offset < text.length() && (static_cast<unsigned char>(text[current_offset]) & 0xC0) == 0x80) {
                     current_offset++;
                 }
             }
        }
    }
    return text.length();
}


// ================= [메인 함수] =================
// JS 호출: getPhysicalState(sourceCode, row, col)
Napi::Value GetPhysicalState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // 1. 인자 확인 (3개만 있으면 됨)
    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Args: sourceCode, row, col").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string source_code = info[0].As<Napi::String>().Utf8Value();
    uint32_t stop_row_in = info[1].As<Napi::Number>().Uint32Value();
    uint32_t stop_col_in = info[2].As<Napi::Number>().Uint32Value();

    // 2. 언어 가져오기 (이미 정적 링크되어 있으므로 바로 호출)
    // ★ 수정 포인트: 다른 언어 확장이면 여기 함수명만 바꾸면 됩니다.
    TSLanguage *language = tree_sitter_smallbasic();

    // 3. 파서 설정
    TSParser *parser = ts_parser_new();
    ts_parser_set_language(parser, language);

    // 4. 커스텀 설정
    uint32_t target_row = stop_row_in > 0 ? stop_row_in - 1 : 0;
    uint32_t target_col = stop_col_in > 0 ? stop_col_in - 1 : 0;

    TSPoint stop_point = {stop_row_in, stop_col_in};
    ts_parser_set_stop_position(parser, stop_point);
    ts_parser_set_find_state_mode(parser, false); 

    // 5. 파싱
    size_t effective_length = FindByteOffsetForPosition(source_code, target_row, target_col);
    if (effective_length > source_code.length()) effective_length = source_code.length();

    TSTree *tree = ts_parser_parse_string(
        parser, NULL, source_code.c_str(), static_cast<uint32_t>(effective_length)
    );

    // 6. 결과 추출
    TSLoggedAction temp_log; 
    TSStateId found_state = TsParserFindClosestRecoverState(parser, stop_row_in, stop_col_in, &temp_log);

    // 7. 정리
    if (tree) ts_tree_delete(tree);
    ts_parser_delete(parser);

    return Napi::Number::New(env, found_state);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "getPhysicalState"), Napi::Function::New(env, GetPhysicalState));
    return exports;
}

NODE_API_MODULE(sb_parser_addon, Init)