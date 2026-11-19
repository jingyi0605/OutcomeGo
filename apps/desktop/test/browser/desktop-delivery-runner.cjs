const { app, BrowserWindow, ipcMain } = require("electron");
const { join } = require("node:path");
const { writeFileSync } = require("node:fs");
const directory = process.argv[2];
const url = process.argv[3];
app.setPath("userData", join(directory, "profile"));
const { DurableSendJournalStore } = require(join(directory, "journal.cjs"));
let journals = new DurableSendJournalStore(join(directory, "journals"));
ipcMain.handle("fixture:journal:read", (_event, scope) => journals.read(scope));
ipcMain.handle("fixture:journal:write", (_event, scope, record) => journals.write(scope, record));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1000, height: 800,
    webPreferences: { backgroundThrottling: false, preload: join(__dirname, "desktop-delivery-preload.cjs") } });
  const js = (source) => window.webContents.executeJavaScript(source);
  const errors = [];
  window.webContents.on("console-message", (_event, details) => {
    if (details.level === "error" && !details.message.includes("503")) errors.push(details.message);
  });
  const until = async (source) => {
    for (let i = 0; i < 240; i++) {
      if (await js(source)) return;
      await pause(25);
    }
    throw new Error(`Timed out: ${source}`);
  };
  const check = async (source, message) => { if (!await js(source)) throw new Error(message); };
  const control = (value) => fetch(new URL("/__delivery-fixture/control", url), {
    method: "POST", body: JSON.stringify(value),
  });
  const writes = async () => (await fetch(new URL("/__delivery-fixture/status", url)).then((r) => r.json())).writes;
  const enabled = "!document.querySelector('.draft-button-primary')?.disabled";
  const status = (value) => `document.querySelector('[role="status"]')?.textContent.trim() === ${JSON.stringify(value)}`;
  const click = (label) => js(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)})?.click()`);
  const setBody = (value) => js(`(() => {
    const body = document.querySelector('[aria-label="Message body"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(body, ${JSON.stringify(value)});
    body.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const passed = [];
  let current = "startup";
  try {
    for (const kind of ["email", "imessage"]) for (const action of ["send", "cancel"]) for (const lost of [false, true]) {
      current = `${kind} ${action} (${lost ? "lost" : "received"} reply): remount, offline restart and durable receipt`;
      console.log(current);
      await window.loadURL("about:blank");
      journals = new DurableSendJournalStore(join(directory, "journals"));
      await control({ reset: true, kind, loseReply: lost });
      await window.loadURL(`${url}?kind=${kind}`);
      await until("Boolean(window.deliveryQA) && Boolean(document.querySelector('.draft-button-primary'))");
      await until(enabled);
      if (kind === "email") await setBody("Edited body retained");
      await control({ offline: true });
      await click(action === "send" ? "Send" : "Discard");
      await until("document.querySelector('.draft-button-primary')?.disabled");
      await js("deliveryQA.show(false)"); await pause(30);
      await js("deliveryQA.show(true)");
      await pause(350);
      if (await writes() !== 1) throw new Error("Action was replayed on remount");
      if (!lost) await until(status(action === "send" ? "Sent" : "Discarded"));
      // Recreate both journal reader and renderer. Bootstrap is intentionally stale.
      journals = new DurableSendJournalStore(join(directory, "journals"));
      await window.loadURL(window.webContents.getURL());
      if (lost) {
        await until("Boolean(window.deliveryQA) && Boolean(document.querySelector('.draft-button-primary'))");
        await pause(200);
        await check("document.querySelector('.draft-button-primary').disabled", "Unconfirmed action reopened Send");
        if (kind === "email") await check("document.querySelector('[aria-label=\"Message body\"]').value === 'Edited body retained'", "Body was lost on restart");
        await control({ offline: false });
        await js("window.dispatchEvent(new Event('online'))");
      }
      await until(status(action === "send" ? "Sent" : "Discarded"));
      await window.loadURL(window.webContents.getURL());
      await until(status(action === "send" ? "Sent" : "Discarded"));
      if (await writes() !== 1) throw new Error("Recovery replayed a mutation");
      passed.push(current);
    }
    current = "definite failure keeps edited body and reply reference";
    await window.loadURL("about:blank");
    journals = new DurableSendJournalStore(join(directory, "journals"));
    await control({ reset: true, kind: "email", failSend: true });
    await window.loadURL(url);
    await until("Boolean(document.querySelector('.draft-button-primary'))");
    await until(enabled);
    await setBody("Keep on failure");
    await click("Send"); await pause(350);
    await until(enabled);
    await check("document.querySelector('[aria-label=\"Message body\"]').value === 'Keep on failure' && document.body.textContent.includes('Original thread')", "Failure discarded body or reply reference");
    passed.push(current);
    current = "account change fences delayed mutation response";
    await control({ failSend: false, latency: 500 });
    await click("Send");
    await until("document.querySelector('.draft-button-primary')?.disabled");
    for (let i = 0; i < 100 && await writes() < 2; i++) await pause(10);
    if (await writes() !== 2) throw new Error("Delayed send did not reach the stand-in server");
    await js("deliveryQA.changeAccount()");
    await pause(700);
    await check(`!(${status("Sent")})`, "Old account completion changed the card");
    passed.push(current);
    current = "measurement growth/shrink preserves row anchor and following latest";
    await window.loadURL(`${url}?measurement`);
    await until("window.measurementQA?.ready");
    const position = () => js("document.querySelector('[data-row=\"30\"]').getBoundingClientRect().top");
    const before = await position();
    await js("measurementQA.grow()"); await pause(250);
    if (Math.abs(await position() - before) > 1) throw new Error("Growth above shifted the visible row");
    await js("measurementQA.grow()"); await pause(250);
    if (Math.abs(await position() - before) > 1) throw new Error("Shrink above shifted the visible row");
    await js("measurementQA.follow()"); await pause(250);
    await check("Math.abs(document.querySelector('[data-row=\"79\"]').getBoundingClientRect().bottom - 400) < 2", "Following latest lost the bottom");
    passed.push(current);
    if (errors.length) throw new Error(errors.join("\n"));
    writeFileSync(join(directory, "result.json"), JSON.stringify({ passed: passed.length, scenarios: passed }, null, 2));
    app.exit(0);
  } catch (error) {
    writeFileSync(join(directory, "result.json"), JSON.stringify({ error: `${current}: ${error.message}`, passed, errors }, null, 2));
    app.exit(1);
  }
});
