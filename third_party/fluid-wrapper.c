// Chip Swap: 「元の音源で聴く」(MIDI) 用の FluidLite ラッパー。
// chiptune.app (Chip Player JS) の src/tinyplayer.c の FluidLite 部分と同じ設定にしている
// (reverb 0.33・chorus なし・gain 0.5・線形補間・10ch はドラム)。
// GPL-3.0 (FluidLite 本体は LGPL-2.1)。
#include <emscripten.h>
#include "fluidlite.h"

static fluid_synth_t *g_synth = 0;
static int g_sfont = -1;

EMSCRIPTEN_KEEPALIVE int fw_init(int sampleRate) {
  fluid_settings_t *settings = new_fluid_settings();
  fluid_settings_setstr(settings, "synth.reverb.active", "yes");
  fluid_settings_setstr(settings, "synth.chorus.active", "no");
  fluid_settings_setint(settings, "synth.threadsafe-api", 0);
  fluid_settings_setnum(settings, "synth.gain", 0.5);
  fluid_settings_setnum(settings, "synth.sample-rate", sampleRate);
  fluid_settings_setstr(settings, "synth.drums-channel.active", "yes");
  g_synth = new_fluid_synth(settings);
  fluid_synth_set_interp_method(g_synth, -1, FLUID_INTERP_LINEAR);
  return g_synth ? 0 : -1;
}

// MEMFS に置いた SoundFont を読み込む (前のものは外す)
EMSCRIPTEN_KEEPALIVE int fw_load_soundfont(const char *path) {
  if (fluid_synth_sfcount(g_synth) > 0) {
    fluid_sfont_t *sf = fluid_synth_get_sfont(g_synth, 0);
    fluid_synth_remove_sfont(g_synth, sf);
  }
  g_sfont = fluid_synth_sfload(g_synth, path, 1);
  return g_sfont;
}

EMSCRIPTEN_KEEPALIVE void fw_set_reverb(double level) {
  fluid_synth_set_reverb_on(g_synth, level > 0.01);
  fluid_synth_set_reverb(g_synth, 0.2 + level * 0.8, 0.0 + level * 0.4, 1.0, 1.0);
  for (int i = 0; i < 16; i++) fluid_synth_cc(g_synth, i, 91, 64);
}

EMSCRIPTEN_KEEPALIVE void fw_note_on(int ch, int key, int vel) { fluid_synth_noteon(g_synth, ch, key, vel); }
EMSCRIPTEN_KEEPALIVE void fw_note_off(int ch, int key) { fluid_synth_noteoff(g_synth, ch, key); }
EMSCRIPTEN_KEEPALIVE void fw_program_change(int ch, int prog) { fluid_synth_program_change(g_synth, ch, prog); }
EMSCRIPTEN_KEEPALIVE void fw_pitch_bend(int ch, int value) { fluid_synth_pitch_bend(g_synth, ch, value); }
EMSCRIPTEN_KEEPALIVE void fw_control_change(int ch, int cc, int value) { fluid_synth_cc(g_synth, ch, cc, value); }

// 10ch をドラムに (chiptune.app の既定)
EMSCRIPTEN_KEEPALIVE void fw_drums_on_ch10(void) { fluid_synth_bank_select(g_synth, 9, 127); }

EMSCRIPTEN_KEEPALIVE void fw_panic(void) {
  for (int i = 0; i < 16; i++) fluid_synth_all_notes_off(g_synth, i);
}
EMSCRIPTEN_KEEPALIVE void fw_reset(void) {
  fluid_synth_system_reset(g_synth);
  fluid_synth_program_reset(g_synth);
}

// frames 個のステレオ (インターリーブ) float を buffer に書く
EMSCRIPTEN_KEEPALIVE void fw_render(float *buffer, int frames) {
  fluid_synth_write_float(g_synth, frames, buffer, 0, 2, buffer, 1, 2);
}
