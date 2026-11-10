# Chip Swap

シーケンスデータを、別の音源チップで鳴らすブラウザツールです。

**▶ ブラウザで使う: https://zitnei.github.io/Chip-Swap/**

[chiptune.app](https://chiptune.app/) にある MIDI 曲や ZX スペクトラムの曲（.ay）を読み込み、FM 音源・PSG 音源・波形メモリ音源など、昔のゲーム機やアーケード基板の音源に差し替えて再生できます。

## できること

- chiptune.app の曲をフォルダから選ぶ・検索して再生（MIDI と、Project AY フォルダの .ay）
- 手持ちの .mid / .ay ファイルの読み込み
- 音源の切り替え（再生中でも切り替え可能）
- MIDI パートごとのミュート・音色の変更
- WAV 書き出し
- VGM 書き出し（選んだチップへの命令列として保存。VGMPlay や chiptune.app で再生可能）

## 音源

| 種類 | 音源 |
|---|---|
| FM 音源 | セガ メガドライブ (YM2612 + SN76489) / カプコン CPS-1 (YM2151 + OKI MSM6295) / タイトー F2 (YM2610) |
| PSG 音源 | AY-3-8910 / ZX スペクトラム 128 (AY-3-8912) / セガ SN76489 / 任天堂 ファミコン (2A03) |
| 波形メモリ音源 | ナムコ WSG / ナムコ C30 / コナミ SCC / コナミ K005289 (グラディウス AC) / ハドソン PC エンジン (HuC6280) |

音はブラウザ内で合成した近似エミュレーションです。ナムコ WSG・C30、コナミ K005289 は VGM 形式に対応するチップが無いため VGM 書き出しはできません。

## アーケードの VGM (.vgm / .vgz)

VGM は基板の音源チップへの命令を記録したデータです。命令から各チャンネルの音程・音量・発音を読み取り、選んだ音源で鳴らし直します。

- 読み取れる音源: YM2151 / YM2203 / YM2608 / YM2610 / YM2612 / YM3812 / YM3526 / Y8950 / YMF262 / YM2413 / AY8910 / SN76489 (リズム音源と OKI MSM6295 はドラムとして)
- PCM だけで鳴らす基板 (QSound・X1-010・YMZ280B など) は非対応
- 公開ページでは chiptune.app の「VGM Rips / Arcade」(526 作品・18,445 曲) の一覧を `catalog/` に同梱して使います。
- chiptune.app の一覧 API と曲ファイルの配信元は chiptune.app と localhost からしか読めないため、公開ページでは Cloudflare Workers の中継 (`proxy/worker.js`、https://chip-swap-proxy.zitnei.workers.dev) を通して曲ファイルを読み込みます。中継は公開ページと localhost からの、chiptune.app の一覧・曲ファイルへのアクセスだけを通します。

### 中継の更新

```bash
cd proxy
npx wrangler deploy
```

## ZX チューン (.ay)

.ay ファイルに入っている Z80 の再生プログラムをエミュレートして、AY 音源への命令を取り出しています。「ZX スペクトラム 128」を選ぶと実機どおりの音で、他の音源を選ぶと AY の 3ch とノイズをそのチップに割り当てて鳴らします。ビーパー（AY を使わない）曲は非対応です。

## 使い方

上の公開ページを開けばそのまま使えます。手元で動かす場合は、AudioWorklet を使うため `file://` ではなく HTTP で開く必要があります。

```bash
node serve.js
```

ブラウザで http://localhost:5173 を開いてください。ビルドや依存パッケージは不要です。

## ファイル構成

| ファイル | 内容 |
|---|---|
| `index.html` / `style.css` | 画面 |
| `js/app.js` | 画面の動作・chiptune.app の参照 |
| `js/midi.js` | MIDI ファイルの読み込み |
| `js/chips.js` | 音源チップと音色の定義 |
| `js/engine.js` | 音源エンジン（MIDI を各チップのチャンネルに割り当てて合成） |
| `js/zx.js` / `js/ay.js` / `js/z80.js` | ZX チューンの再生・.ay 読み込み・Z80 CPU |
| `js/vgm.js` | VGM 書き出し |
| `js/worklet.js` / `js/export-worker.js` | 音声出力・書き出し処理 |

曲データは chiptune.app (Chip Player JS) から取得しています。
