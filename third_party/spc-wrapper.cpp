// Chip Swap: スーパーファミコンの SPC を鳴らす / 読み取るためのラッパー。
// game-music-emu (blargg の snes_spc, LGPL-2.1) の Snes_Spc を使う。GPL-3.0。
//  - sp_play: 32kHz ステレオの 16bit を作る (元の音で聴く用)
//  - sp_dsp / sp_ram / sp_kon: DSP のレジスタ・64KB RAM (音色サンプル)・キーオンを読む (別の音源で鳴らす用)
#include <emscripten.h>
#include <string.h>
#define private public   // Snes_Spc の DSP と RAM を読むため (このファイルの中だけ)
#include "Snes_Spc.h"
#undef private
#include "Spc_Filter.h"

unsigned g_spc_kon_written = 0;
static Snes_Spc g_spc;
static Spc_Filter g_filter;
static bool g_inited = false;

extern "C" {

EMSCRIPTEN_KEEPALIVE int sp_load(const unsigned char *data, int size) {
  if (!g_inited) { if (g_spc.init()) return 1; g_inited = true; }
  if (g_spc.load_spc(data, size)) return 2;
  g_spc.clear_echo();
  g_filter.clear();
  g_spc_kon_written = 0;
  return 0;
}

// count: 出力するサンプル数 (左右合わせて。偶数)
EMSCRIPTEN_KEEPALIVE int sp_play(short *out, int count) {
  if (g_spc.play(count, out)) return 0;
  g_filter.run(out, count);
  return count;
}

EMSCRIPTEN_KEEPALIVE int sp_skip(int count) { return g_spc.skip(count) ? 0 : count; }
EMSCRIPTEN_KEEPALIVE int sp_dsp(int addr) { return g_spc.dsp.read(addr & 0x7f); }
EMSCRIPTEN_KEEPALIVE unsigned char *sp_ram(void) { return g_spc.m.ram.ram; }
EMSCRIPTEN_KEEPALIVE int sp_kon(void) { int k = g_spc_kon_written; g_spc_kon_written = 0; return k; }

}
