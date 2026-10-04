/**
 * Builds dist-artifact/index.html from dist/index.html for hosting as a
 * claude.ai Artifact: the host adds its own <!doctype>/<html>/<head>/<body>
 * skeleton, so only the <title>, <style>, body markup and module script are kept.
 * Assets stay in dist/assets and are published alongside (see README).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const pick = (re) => (html.match(re) ?? [''])[0];
const title = pick(/<title>[\s\S]*?<\/title>/);
const style = pick(/<style>[\s\S]*?<\/style>/).replace(/:root\s*\{/, ':root{color-scheme:dark;');
const script = pick(/<script type="module"[^>]*><\/script>/);
const body = (html.match(/<body>([\s\S]*?)<\/body>/) ?? ['', ''])[1].replace(/<script type="module"[^>]*><\/script>/, '');
mkdirSync('dist-artifact', { recursive: true });
writeFileSync('dist-artifact/index.html', `${title}\n${style}\n${body.trim()}\n${script}\n`);
const assets = readdirSync('dist/assets');
console.log('dist-artifact/index.html written; assets:', assets.join(', '));
