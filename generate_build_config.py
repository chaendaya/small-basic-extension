#!/usr/bin/env python3
"""
binding.gyp와 addon.cc의 언어별 설정을 자동 생성한다.
resources/ 디렉토리에 존재하는 언어를 기반으로,
실제 tree-sitter-{lang} 소스가 존재하는 언어만 생성한다.

사용법: python3 generate_build_config.py
"""

import json
import os
import re

# ============================================================
# 설정
# ============================================================
EXT_DIR = os.path.dirname(os.path.abspath(__file__))
RESOURCES_DIR = os.path.join(EXT_DIR, "resources")

# addon 이름 예외 (디렉토리명과 다른 경우)
ADDON_NAME_OVERRIDES = {
    "smallbasic": "sb_parser_addon",
}

# parser.c 경로가 표준(src/)이 아닌 경우
PARSER_PATH_OVERRIDES = {
    "php": "php/src",
    "typescript": "typescript/src",
}


# ============================================================
# 언어 탐색
# ============================================================
def discover_languages():
    languages = []

    for lang in sorted(os.listdir(RESOURCES_DIR)):
        lang_res = os.path.join(RESOURCES_DIR, lang)
        if not os.path.isdir(lang_res):
            continue
        if not os.path.exists(os.path.join(lang_res, "candidates.json")):
            continue

        ts_dir = os.path.join(os.path.dirname(EXT_DIR), f"tree-sitter-{lang}")
        if not os.path.isdir(ts_dir):
            print(f"  [SKIP] {lang}: tree-sitter-{lang} 디렉토리 없음")
            continue

        sub = PARSER_PATH_OVERRIDES.get(lang, "src")
        parser_c = os.path.join(ts_dir, sub, "parser.c")
        if not os.path.exists(parser_c):
            print(f"  [SKIP] {lang}: {parser_c} 없음")
            continue

        scanner_c = os.path.join(ts_dir, sub, "scanner.c")
        has_scanner = os.path.exists(scanner_c)

        func_name = None
        with open(parser_c, "r", errors="replace") as f:
            for line in f:
                m = re.search(r"TSLanguage\s*\*\s*(tree_sitter_\w+)", line)
                if m:
                    func_name = m.group(1)
                    break
        if not func_name:
            print(f"  [SKIP] {lang}: tree_sitter_* 함수를 찾을 수 없음")
            continue

        rel_sub = f"../tree-sitter-{lang}/{sub}"
        addon_name = ADDON_NAME_OVERRIDES.get(lang, f"{lang}_parser_addon")
        macro_name = f"LANG_{lang.upper()}"

        languages.append({
            "lang": lang,
            "addon_name": addon_name,
            "macro_name": macro_name,
            "func_name": func_name,
            "rel_parser": f"{rel_sub}/parser.c",
            "rel_scanner": f"{rel_sub}/scanner.c" if has_scanner else None,
            "rel_include": rel_sub,
        })
        status = "+ scanner" if has_scanner else ""
        print(f"  [OK] {lang}: {addon_name} ({func_name}) {status}")

    return languages


# ============================================================
# binding.gyp 생성
# ============================================================
def generate_binding_gyp(languages):
    targets = []
    for info in languages:
        sources = [
            "native/src/addon.cc",
            "../tree-sitter/lib/src/lib.c",
            info["rel_parser"],
        ]
        if info["rel_scanner"]:
            sources.append(info["rel_scanner"])

        targets.append({
            "target_name": info["addon_name"],
            "cflags!": ["-fno-exceptions"],
            "cflags_cc!": ["-fno-exceptions"],
            "sources": sources,
            "include_dirs": [
                "<!@(node -p \"require('node-addon-api').include\")",
                "../tree-sitter/lib/include",
                "../tree-sitter/lib/src",
                info["rel_include"],
            ],
            "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", info["macro_name"]],
            "msvs_settings": {
                "VCCLCompilerTool": {"ExceptionHandling": 1}
            },
        })

    out_path = os.path.join(EXT_DIR, "binding.gyp")
    with open(out_path, "w") as f:
        json.dump({"targets": targets}, f, indent=2)
        f.write("\n")
    print(f"\n  -> binding.gyp 생성 완료 ({len(targets)}개 타겟)")


# ============================================================
# addon.cc 언어 분기 생성
# ============================================================
def generate_addon_lang_block(languages):
    addon_path = os.path.join(EXT_DIR, "native", "src", "addon.cc")
    with open(addon_path, "r") as f:
        content = f.read()

    pattern = r"// 언어 정의 함수.*?#endif"
    match = re.search(pattern, content, re.DOTALL)
    if not match:
        print("  [ERROR] addon.cc에서 언어 정의 블록을 찾을 수 없음")
        return

    lines = ["// 언어 정의 함수 — generate_build_config.py에 의해 자동 생성됨"]
    for i, info in enumerate(languages):
        directive = "#if" if i == 0 else "#elif"
        lines.append(f'{directive} defined({info["macro_name"]})')
        lines.append(f'    extern "C" TSLanguage *{info["func_name"]}();')
        lines.append(f'    #define GET_LANGUAGE() {info["func_name"]}()')
    lines.append('#else')
    lines.append('    #error "언어 정의 없음: generate_build_config.py를 실행하세요."')
    lines.append('#endif')

    new_block = "\n".join(lines)
    content = content[:match.start()] + new_block + content[match.end():]

    with open(addon_path, "w") as f:
        f.write(content)
    print(f"  -> addon.cc 언어 블록 생성 완료 ({len(languages)}개 언어)")


# ============================================================
# main
# ============================================================
if __name__ == "__main__":
    print("[1/3] 언어 탐색...")
    languages = discover_languages()

    if not languages:
        print("  지원 가능한 언어를 찾지 못했습니다.")
        exit(1)

    print(f"\n[2/3] binding.gyp 생성...")
    generate_binding_gyp(languages)

    print(f"\n[3/3] addon.cc 언어 블록 생성...")
    generate_addon_lang_block(languages)

    print(f"\n완료. node-gyp rebuild를 실행하세요.")
