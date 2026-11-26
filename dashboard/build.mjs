import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
await build({entryPoints:['dashboard/login-client.js'],bundle:true,format:'esm',target:'es2022',outfile:'dashboard/public/login.js',minify:true});
await copyFile('Brief/schema.js','dashboard/public/schema.js');

await build({entryPoints:["dashboard/excel-export.js"],bundle:true,platform:"browser",format:"esm",target:"es2022",outfile:"dashboard/public/excel-export.js",minify:true});
