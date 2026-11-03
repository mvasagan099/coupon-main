import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// This build is used only by coupon-5mul. The main app keeps its normal Vite build.
const output = resolve(process.argv[2] || 'dist');
const primary = 'https://coupon-frontend-e8b3.onrender.com/';
const policy = "default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; object-src 'none'";
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>Continue to CouponVault</title>
<link rel="canonical" href="${primary}">
<link rel="stylesheet" href="/redirect.css">
<script src="/redirect.js" defer></script></head>
<body><main><h1>Continue to CouponVault</h1>
<p>Opening the secure CouponVault application…</p>
<a href="${primary}">Continue to CouponVault</a></main></body></html>\n`);
await writeFile(resolve(output, 'redirect.js'), `// Preserve links without allowing the incoming path to change the destination host.
const destination = new URL(${JSON.stringify(primary)});
destination.pathname = window.location.pathname;
destination.search = window.location.search;
destination.hash = window.location.hash;
window.location.replace(destination.href);
`);
await writeFile(resolve(output, 'redirect.css'), 'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#11111b;color:#f5f5fa;font:18px/1.5 system-ui,sans-serif}main{max-width:36rem;padding:2rem}a{color:#b9a4ff}h1{font-size:2rem}\n');
