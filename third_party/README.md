# 同梱しているサードパーティのソフトウェア

Chip Swap 全体は GPL-3.0 で公開しています (リポジトリ直下の `LICENSE`)。

## 「元の音源で聴く」の再生エンジン (`js/vendor/libvgm.js`)

VGM をページ内で元の音源チップのまま再生するため、次の 2 つを Emscripten で WebAssembly にビルドして使っています。

| ソフトウェア | 作者 | ライセンス | ソース |
|---|---|---|---|
| **libvgm** (VGM プレイヤー・各音源チップのエミュレーター) | Valley Bell ほか (エミュレーター部分は MAME・Nuked・Genesis Plus GX などの作者) | エミュレーターごとに異なる (BSD-3-Clause / GPL / LGPL など。各ソースの先頭を参照) | https://github.com/ValleyBell/libvgm (commit `c5c03a2c2514d38d2ab7b7e8dbd021af0b8292cb`) |
| **libvgm-wrapper.cpp** (JavaScript から libvgm を呼ぶ部分) | Matt Montag (Chip Player JS / chiptune.app) | GPL-3.0 | https://github.com/mmontag/chip-player-js (commit `9455a8bc8bfe83eeacc54874d76ef74c8f77961c`) の `src/bindings/libvgm-wrapper.cpp`。このフォルダにも同梱 (`chip-player-js/libvgm-wrapper.cpp`、変更なし) |
| zlib (Emscripten 同梱) | Jean-loup Gailly, Mark Adler | zlib License | https://zlib.net/ |

### ビルド手順 (`js/vendor/libvgm.js` を作り直す時)

[Emscripten](https://emscripten.org/) (確認したのは 7.0.0) と cmake / ninja が必要です。

```bash
git clone https://github.com/ValleyBell/libvgm.git
cd libvgm
emcmake cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_LIBAUDIO=OFF -DBUILD_PLAYER=OFF -DBUILD_VGM2WAV=OFF -DBUILD_TESTS=OFF -DUSE_SANITIZERS=OFF \
  -DUTIL_CHARSET_CONV=ON -DUTIL_CHARCNV_ICONV=ON -DUTIL_CHARCNV_WINAPI=OFF \
  -DCMAKE_C_FLAGS="-Oz -sUSE_ZLIB=1" -DCMAKE_CXX_FLAGS="-Oz -sUSE_ZLIB=1"
ninja -C build
cd ..

em++ third_party/chip-player-js/libvgm-wrapper.cpp \
  libvgm/build/bin/libvgm-player.a libvgm/build/bin/libvgm-emu.a libvgm/build/bin/libvgm-utils.a \
  -I libvgm -std=c++17 -Oz -sUSE_ZLIB=1 -sMODULARIZE=1 -sEXPORT_NAME=LibVGM -sENVIRONMENT=web,worklet \
  -sSINGLE_FILE=1 -sWASM_ASYNC_COMPILATION=0 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 \
  -sWASM_BIGINT -sMALLOC=emmalloc -sASSERTIONS=0 -sSTACK_OVERFLOW_CHECK=0 \
  -sEXPORTED_FUNCTIONS='["_lvgm_init","_lvgm_load_data","_lvgm_start","_lvgm_stop","_lvgm_render","_lvgm_get_position_ms","_lvgm_get_duration_ms","_lvgm_seek_ms","_lvgm_get_voice_count","_lvgm_get_voice_name","_lvgm_get_voice_chip_name","_lvgm_set_voice_mask","_lvgm_get_metadata","_lvgm_set_enhanced_stereo","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8","HEAP32","UTF8ToString"]' \
  -o js/vendor/libvgm.js

node tools/build-worklet.mjs   # js/original-worklet.bundle.js を作り直す
```
