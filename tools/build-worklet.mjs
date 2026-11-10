// AudioWorklet 用に、音源エンジン一式を 1 ファイル (js/worklet.bundle.js) にまとめる。
// Safari (iPhone) などでは AudioWorklet の中で import が使えないことがあるため。
// 使い方: node tools/build-worklet.mjs   (js/ の音源まわりを変えたら実行してコミット)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');
const ORDER = ['chips.js', 'vgmin.js', 'engine.js', 'zx.js', 'regplay.js', 'worklet.js'];

let out = '// 自動生成ファイル: tools/build-worklet.mjs で作成。直接編集しないでください。\n';
for (const file of ORDER) {
  let src = fs.readFileSync(path.join(root, file), 'utf8');
  const id = '__m_' + file.replace(/\W/g, '_');
  const exports = [];
  // import { A, B } from './x.js';  →  const { A, B } = __m_x_js;
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w.-]+)';?\s*$/gm, (_, names, f) => {
    if (!ORDER.includes(f) || ORDER.indexOf(f) >= ORDER.indexOf(file)) throw new Error(`${file}: ${f} を先に並べてください`);
    return `const {${names}} = __m_${f.replace(/\W/g, '_')};`;
  });
  if (/^import\s/m.test(src)) throw new Error(`${file}: 対応していない import があります`);
  // export const X / export function X / export class X / export async function X
  src = src.replace(/^export\s+((?:async\s+)?function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => { exports.push(name); return `${kind} ${name}`; });
  if (/^export\s/m.test(src)) throw new Error(`${file}: 対応していない export があります`);
  out += `\n// ---- ${file} ----\nconst ${id} = (() => {\n${src}\nreturn { ${exports.join(', ')} };\n})();\n`;
}
fs.writeFileSync(path.join(root, 'worklet.bundle.js'), out);
console.log('js/worklet.bundle.js', (out.length / 1024).toFixed(1) + ' KB');
