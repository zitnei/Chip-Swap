# 同梱しているサードパーティのソフトウェア

Chip Swap 全体は GPL-3.0 で公開しています (リポジトリ直下の `LICENSE`)。

## 「元の音源で聴く」の再生エンジン (`js/vendor/libvgm.js`)

VGM をページ内で元の音源チップのまま再生するため、次の 2 つを Emscripten で WebAssembly にビルドして使っています。

| ソフトウェア | 作者 | ライセンス | ソース |
|---|---|---|---|
| **libvgm** (VGM プレイヤー・各音源チップのエミュレーター) | Valley Bell ほか (エミュレーター部分は MAME・Nuked・Genesis Plus GX などの作者) | エミュレーターごとに異なる (BSD-3-Clause / GPL / LGPL など。各ソースの先頭を参照) | https://github.com/ValleyBell/libvgm (commit `c5c03a2c2514d38d2ab7b7e8dbd021af0b8292cb`) |
| **libvgm-wrapper.cpp** (JavaScript から libvgm を呼ぶ部分) | Matt Montag (Chip Player JS / chiptune.app) | GPL-3.0 | https://github.com/mmontag/chip-player-js (commit `9455a8bc8bfe83eeacc54874d76ef74c8f77961c`) の `src/bindings/libvgm-wrapper.cpp`。このフォルダにも同梱 (`chip-player-js/libvgm-wrapper.cpp`、変更なし) |
| zlib (Emscripten 同梱) | Jean-loup Gailly, Mark Adler | zlib License | https://zlib.net/ |

## スーパーファミコン (SPC) のエンジン (`js/vendor/snesspc.js`)

SPC を元の音で鳴らす・別の音源用に音程を読み取るため、game-music-emu の SPC 部分 (blargg の snes_spc) を Emscripten でビルドして使っています。

| ソフトウェア | 作者 | ライセンス | ソース |
|---|---|---|---|
| **game-music-emu の SPC 部分** (`game-music-emu-spc/`) | Shay Green (blargg) ほか | LGPL-2.1 (`game-music-emu-spc/LICENSE-LGPL-2.1.txt`) | https://github.com/mmontag/chip-player-js の `game-music-emu/gme/` (commit `9455a8bc8bfe83eeacc54874d76ef74c8f77961c`)。**変更点**: `Spc_Dsp.h` の `Spc_Dsp::write` に、KON (キーオン) レジスタへの書き込みを `g_spc_kon_written` に記録する 1 行を追加 |
| **spc-wrapper.cpp** (JavaScript から呼ぶ部分) | Chip Swap | GPL-3.0 | このフォルダの `spc-wrapper.cpp` |

### ビルド手順 (`js/vendor/snesspc.js` を作り直す時)

```bash
em++ third_party/spc-wrapper.cpp third_party/game-music-emu-spc/Snes_Spc.cpp third_party/game-music-emu-spc/Spc_Cpu.cpp   third_party/game-music-emu-spc/Spc_Dsp.cpp third_party/game-music-emu-spc/Spc_Filter.cpp   third_party/game-music-emu-spc/blargg_common.cpp third_party/game-music-emu-spc/blargg_errors.cpp   -I third_party/game-music-emu-spc -Oz -DNDEBUG -sMODULARIZE=1 -sEXPORT_NAME=SnesSpc -sENVIRONMENT=web,worklet   -sSINGLE_FILE=1 -sWASM_ASYNC_COMPILATION=0 -sALLOW_MEMORY_GROWTH=1 -sMALLOC=emmalloc -sASSERTIONS=0 -sSTACK_OVERFLOW_CHECK=0   -sEXPORTED_FUNCTIONS='["_sp_load","_sp_play","_sp_skip","_sp_dsp","_sp_ram","_sp_kon","_malloc","_free"]'   -sEXPORTED_RUNTIME_METHODS='["HEAPU8","HEAP16"]' -o js/vendor/snesspc.js

node tools/build-worklet.mjs   # js/original-spc-worklet.bundle.js を作り直す
```

## 「元の音源で聴く」(MIDI) の再生エンジン (`js/vendor/fluidlite.js`)

MIDI を chiptune.app と同じ音で鳴らすため、FluidLite (SoundFont シンセサイザー) を Emscripten でビルドして使っています。
設定は Chip Player JS の `src/tinyplayer.c` と同じにしています。音色データ (SoundFont) は同梱せず、chiptune.app と同じ配信元 (gifx.co) から読み込みます (既定は GMGSx Plus)。

| ソフトウェア | 作者 | ライセンス | ソース |
|---|---|---|---|
| **FluidLite** | Robin Lobel ほか (FluidSynth 由来) | LGPL-2.1 | https://github.com/mmontag/chip-player-js の `fluidlite/` (commit `9455a8bc8bfe83eeacc54874d76ef74c8f77961c`)、元は https://github.com/divideconcept/FluidLite |
| **fluid-wrapper.c** (JavaScript から FluidLite を呼ぶ部分) | Chip Swap | GPL-3.0 | このフォルダの `fluid-wrapper.c` |

### ビルド手順 (`js/vendor/fluidlite.js` を作り直す時)

```bash
cd chip-player-js/fluidlite
emcmake cmake -S . -B build -G Ninja -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_BUILD_TYPE=Release -DDISABLE_SF3=ON -DCMAKE_C_FLAGS="-Oz"
ninja -C build fluidlite-static
cd ../..

emcc third_party/fluid-wrapper.c chip-player-js/fluidlite/build/libfluidlite.a   -I chip-player-js/fluidlite/include -I chip-player-js/fluidlite/build -Oz   -sMODULARIZE=1 -sEXPORT_NAME=FluidLite -sENVIRONMENT=web,worklet -sSINGLE_FILE=1 -sWASM_ASYNC_COMPILATION=0   -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMALLOC=emmalloc -sASSERTIONS=0 -sSTACK_OVERFLOW_CHECK=0 -sFORCE_FILESYSTEM=1   -sEXPORTED_FUNCTIONS='["_fw_init","_fw_load_soundfont","_fw_set_reverb","_fw_note_on","_fw_note_off","_fw_program_change","_fw_pitch_bend","_fw_control_change","_fw_drums_on_ch10","_fw_panic","_fw_reset","_fw_render","_malloc","_free"]'   -sEXPORTED_RUNTIME_METHODS='["HEAPF32","FS","stringToNewUTF8"]'   -o js/vendor/fluidlite.js

node tools/build-worklet.mjs   # js/original-midi-worklet.bundle.js を作り直す
```

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
