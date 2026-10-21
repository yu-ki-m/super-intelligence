// 定義の解析を別スレッドで動かす。その間に、メインスレッドはリンクの要らないページを書き出す。
// Java(別プロセスの JDK)と TypeScript(このスレッド)は並行して解析する。

import { parentPort, workerData } from 'node:worker_threads';
import { buildXref, mergeXref } from './xref.mjs';
import { buildJavaXref } from './xref-java.mjs';

const log = message => parentPort.postMessage({ log: message });
const failed = (lang, err) => ({ status: 'skip', reason: `${lang} の定義の解析が失敗した: ${err?.message || err}` });

const javaPending = buildJavaXref({ root: workerData.root, files: workerData.files, java: workerData.java, log }).catch(err => failed('Java', err));
let ts;
try {
  ts = buildXref({ root: workerData.root, files: workerData.files, typescript: workerData.typescript, log });
} catch (err) {
  ts = failed('TypeScript', err);
}
parentPort.postMessage({ result: mergeXref([ts, await javaPending]) });
