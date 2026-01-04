{
  "targets": [
    {
      "target_name": "sb_parser_addon",
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "sources": [
        "native/src/addon.cc",
        "../../tree-sitter/lib/src/lib.c",
        "../../tree-sitter-smallbasic/src/parser.c"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "../../tree-sitter/lib/include",
        "../../tree-sitter/lib/src",
        "../../tree-sitter-smallbasic/src"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1
        }
      }
    }
  ]
}