// Records the deploy showcase posters from the running dev server (default http://127.0.0.1:5173) as
// PNG frames with timestamps, one folder per poster. Usage:
//   bun scripts/record-showcase-video.ts <outDir> [posterIndex ...]
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const out = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: record-showcase-video.ts <outDir> [posterIndex ...]");
const ids = ["assistant", "team", "computer", "decide", "outcome", "dock", "routines", "connect", "yours"];
const picked = process.argv.slice(3).map(Number);
const indexes = picked.length > 0 ? picked : ids.map((_, index) => index);
const base = process.env.SHOWCASE_BASE ?? "http://127.0.0.1:5173";
const seconds = Number(process.env.SHOWCASE_SECONDS ?? 7);
const WIDTH = 1440;
const HEIGHT = 1080;

await mkdir(out, { recursive: true });
const runner = join(out, "runner.cjs");
await writeFile(
  runner,
  `
const {app,BrowserWindow}=require('electron');const fs=require('node:fs');
app.setPath('userData',${JSON.stringify(join(out, "profile"))});
const ids=${JSON.stringify(ids)};const indexes=${JSON.stringify(indexes)};
app.whenReady().then(async()=>{
  for(const index of indexes){
    const dir=${JSON.stringify(out)}+'/'+String(index+1).padStart(2,'0')+'-'+ids[index];
    fs.mkdirSync(dir,{recursive:true});
    const win=new BrowserWindow({show:false,width:${WIDTH},height:${HEIGHT},useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}});
    win.webContents.setFrameRate(60);
    const frames=[];let started=0;
    win.webContents.on('paint',(_e,_r,image)=>{if(!started)return;const file=String(frames.length).padStart(5,'0')+'.png';fs.writeFileSync(dir+'/'+file,image.toPNG());frames.push({file,ms:Date.now()-started})});
    await win.loadURL(${JSON.stringify(base)}+'/test/browser/deploy-showcase.html?panel=0&size=fill&loop=0&poster='+ids[index]);
    await new Promise(r=>setTimeout(r,1200));
    started=Date.now();
    await new Promise(r=>setTimeout(r,${seconds * 1000}));
    started=0;
    fs.writeFileSync(dir+'/frames.json',JSON.stringify(frames));
    console.log(ids[index],frames.length,'frames',win.getContentSize().join('x'));
    win.destroy();
  }
  app.quit();
});`
);
const require = createRequire(import.meta.url);
const child = Bun.spawn([require("electron"), runner], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  stdout: "inherit",
  stderr: "inherit",
});
if (await child.exited) throw new Error("Recording failed");
