#!/usr/bin/env node
/*
 * 同梱の Mermaid（assets/vendor/mermaid.min.js）を指定バージョンに入れ替える（保守用）。
 *
 *   node update-mermaid.cjs <version>      例: node update-mermaid.cjs 11.17.2
 *
 * npm レジストリから mermaid の tarball を取得して dist/mermaid.min.js と LICENSE を取り出し、
 * scripts/lib/core.cjs の MERMAID_VERSION と assets/vendor/VENDOR.md を更新する。
 * 入れ替えた後は必ず examples をビルドして verify を通し、ビューアの対応付け（data-et 属性）が
 * 新しいバージョンでも成立することを確認すること。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  process.stderr.write('使い方: node update-mermaid.cjs <x.y.z>\n');
  process.exit(2);
}
const skill = path.resolve(__dirname, '..');
const vendor = path.join(skill, 'assets', 'vendor');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mermaid-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const pack = spawnSync(npm, ['pack', 'mermaid@' + version, '--silent'], { cwd: work, encoding: 'utf8', shell: process.platform === 'win32' });
if (pack.status !== 0) { process.stderr.write(pack.stderr || 'npm pack に失敗しました\n'); process.exit(1); }
const tgz = path.join(work, pack.stdout.trim().split(/\r?\n/).pop());
const untar = spawnSync('tar', ['-xzf', tgz, '-C', work, 'package/dist/mermaid.min.js', 'package/LICENSE'], { encoding: 'utf8' });
if (untar.status !== 0) { process.stderr.write(untar.stderr || 'tar の展開に失敗しました\n'); process.exit(1); }

fs.copyFileSync(path.join(work, 'package', 'dist', 'mermaid.min.js'), path.join(vendor, 'mermaid.min.js'));
fs.copyFileSync(path.join(work, 'package', 'LICENSE'), path.join(vendor, 'mermaid-LICENSE.txt'));
const buf = fs.readFileSync(path.join(vendor, 'mermaid.min.js'));
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
const sri = 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');

const corePath = path.join(skill, 'scripts', 'lib', 'core.cjs');
const core = fs.readFileSync(corePath, 'utf8').replace(/var MERMAID_VERSION = '[^']+';/, "var MERMAID_VERSION = '" + version + "';");
fs.writeFileSync(corePath, core);

const mdPath = path.join(vendor, 'VENDOR.md');
let md = fs.readFileSync(mdPath, 'utf8');
md = md.replace(/\| バージョン \| .* \|/, '| バージョン | ' + version + ' |')
  .replace(/\| SHA-256 \| .* \|/, '| SHA-256 | `' + sha256 + '` |')
  .replace(/\| SRI（CDN 用） \| .* \|/, '| SRI（CDN 用） | `' + sri + '` |')
  .replace(/\| サイズ \| .* \|/, '| サイズ | ' + buf.length.toLocaleString('en-US') + ' bytes |')
  .replace(/\| 更新日 \| .* \|/, '| 更新日 | ' + new Date().toISOString().slice(0, 10) + ' |');
fs.writeFileSync(mdPath, md);
fs.rmSync(work, { recursive: true, force: true });
process.stdout.write('Mermaid ' + version + ' に更新しました（sha256 ' + sha256 + '）。\n' +
  '次に examples/order-system をビルドし、verify がすべて OK になることを確認してください。\n');
