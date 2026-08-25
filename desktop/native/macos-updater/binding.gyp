{
  "variables": {
    "sparkle_framework_dir%": "",
    "sparkle_headers_root%": ""
  },
  "targets": [
    {
      "target_name": "redeven_sparkle",
      "sources": ["redeven_sparkle.mm"],
      "include_dirs": ["<(sparkle_headers_root)"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
            "MACOSX_DEPLOYMENT_TARGET": "12.0",
            "OTHER_LDFLAGS": [
              "-F<(sparkle_framework_dir)/..",
              "-framework",
              "Sparkle",
              "-framework",
              "AppKit",
              "-Wl,-rpath,@loader_path/../../Frameworks"
            ]
          }
        }]
      ]
    }
  ]
}
