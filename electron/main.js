const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  shell,
  ipcMain,
} = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

let mainWindow;
let tray;
let backendProcess;

const BACKEND_PORT = 8000;
const ROOT_DIR = path.join(__dirname, "..");

// ── Path resolution (dev vs packaged vs system install) ────────────────────────
//
// Three modes:
//   dev:           __dirname = <repo>/electron/, ROOT_DIR = <repo>/
//   electron-builder AppImage/pacman:
//                  app.isPackaged = true, process.resourcesPath = <app>/resources/
//   system install (AUR): SHRIMP_APP_PATH env var set by /usr/bin/shrimp launcher
//                  app.isPackaged = false but SHRIMP_APP_PATH is set

const SYSTEM_APP_PATH = process.env.SHRIMP_APP_PATH || null;
const IS_PACKAGED = app.isPackaged || !!SYSTEM_APP_PATH;

const BACKEND_DIR = SYSTEM_APP_PATH
  ? path.join(SYSTEM_APP_PATH, "backend")
  : app.isPackaged
    ? path.join(process.resourcesPath, "backend")
    : path.join(ROOT_DIR, "backend");

const VENV_PYTHON = path.join(BACKEND_DIR, ".venv", "bin", "python");

// User-writable dir for config.py — avoids writing to root-owned system paths.
// Set lazily after app is ready (app.getPath requires app.whenReady).
let USER_CONFIG_DIR = null;

function setupUserConfig() {
  USER_CONFIG_DIR = path.join(app.getPath("userData"), "config");
  fs.mkdirSync(USER_CONFIG_DIR, { recursive: true });
  const userConfig = path.join(USER_CONFIG_DIR, "config.py");
  const systemConfig = path.join(BACKEND_DIR, "config.py");
  if (!fs.existsSync(userConfig) && fs.existsSync(systemConfig)) {
    fs.copyFileSync(systemConfig, userConfig);
  }
}

const ICON_PATH = SYSTEM_APP_PATH
  ? "/usr/share/icons/hicolor/512x512/apps/shrimp.png"
  : path.join(ROOT_DIR, "frontend", "public", "icons", "shrimp(1).png");

// ── Logging setup (packaged mode writes to OS log dir) ─────────────────────────

function getLogStream(filename) {
  if (!IS_PACKAGED) return null; // dev mode logs to console
  const logDir = app.getPath("logs");
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (_) {}
  return fs.createWriteStream(path.join(logDir, filename), { flags: "a" });
}


// ── Backend ────────────────────────────────────────────────────────────────────

function isBackendRunning() {
  return new Promise((resolve) => {
    http
      .get(`http://127.0.0.1:${BACKEND_PORT}/health`, (res) => {
        resolve(res.statusCode === 200);
      })
      .on("error", () => resolve(false));
  });
}

function startBackend() {
  const python = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";
  const backendArgs = [
    "-m", "uvicorn", "main:app",
    "--host", "127.0.0.1",
    "--port", String(BACKEND_PORT),
  ];
  const backendEnv = {
    ...process.env,
    ...(USER_CONFIG_DIR ? { SHRIMP_CONFIG_DIR: USER_CONFIG_DIR } : {}),
    SHRIMP_DATA_DIR: app.getPath("userData"),
  };

  const backendLog = getLogStream("backend.log");
  if (IS_PACKAGED) {
    const logPath = path.join(app.getPath("logs"), "backend.log");
    console.log(`[backend] log -> ${logPath}`);
  }

  const logLine = (msg) => {
    if (backendLog) backendLog.write(msg + "\n");
    else console.log("[backend]", msg);
  };

  logLine(`=== backend start ${new Date().toISOString()} ===`);
  logLine(`python:  ${python}`);
  logLine(`args:    ${backendArgs.join(" ")}`);
  logLine(`cwd:     ${BACKEND_DIR}`);
  logLine(`venv ok: ${fs.existsSync(VENV_PYTHON)}`);

  backendProcess = spawn(python, backendArgs, { cwd: BACKEND_DIR, env: backendEnv });

  backendProcess.stdout.on("data", (d) => {
    const line = d.toString().trimEnd();
    if (backendLog) backendLog.write(line + "\n");
    else console.log("[backend]", line);
  });

  backendProcess.stderr.on("data", (d) => {
    const line = d.toString().trimEnd();
    // Filter known-noisy Electron/GTK/GPU stderr noise
    if (
      line.includes("dbus/bus.cc") ||
      line.includes("Failed to connect to the bus") ||
      line.includes("colorreload-gtk-module") ||
      line.includes("radv is not a conformant") ||
      line.includes("allow_glsl_extension_directive")
    )
      return;
    if (backendLog) backendLog.write("[stderr] " + line + "\n");
    else console.error("[backend stderr]", line);
  });

  backendProcess.on("exit", (code) => {
    const msg = `=== backend exit code ${code} ===`;
    if (backendLog) backendLog.write(msg + "\n");
    if (code !== 0 && !app.isQuitting) console.error(`[backend] exited with code ${code}`);
  });
}

function waitForBackend(maxAttempts = 60, onProgress = null) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function check() {
      http
        .get(`http://127.0.0.1:${BACKEND_PORT}/health`, (res) => {
          if (res.statusCode === 200) return resolve();
          retry();
        })
        .on("error", retry);
    }
    function retry() {
      if (++attempts >= maxAttempts)
        return reject(new Error("Backend did not start in time"));
      if (onProgress) onProgress(attempts, maxAttempts);
      setTimeout(check, 500);
    }
    check();
  });
}

// ── Window ─────────────────────────────────────────────────────────────────────

function createWindow() {
  const icon = fs.existsSync(ICON_PATH)
    ? nativeImage.createFromPath(ICON_PATH)
    : nativeImage.createEmpty();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    icon,
    title: "SHRIMP*",
    backgroundColor: "#0D0F17",
    frame: false,          // custom title bar
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenu(null);

  // Window control IPC
  ipcMain.on("window-minimize", () => mainWindow.minimize());
  ipcMain.on("window-maximize", () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window-close", () => mainWindow.close()); // close handler hides to tray

  // Notify renderer of maximize state changes
  mainWindow.on("maximize",   () => mainWindow.webContents.send("window-maximized"));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("window-unmaximized"));

  mainWindow.webContents.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12" || (input.control && input.shift && input.key === "I")) {
      mainWindow.webContents.toggleDevTools();
    } else if (input.control && input.key === "r") {
      mainWindow.webContents.reload();
    } else if (input.control && input.shift && input.key === "r") {
      mainWindow.webContents.reloadIgnoringCache();
    }
  });

  // Forward all renderer console messages to the terminal
  if (!IS_PACKAGED) {
    const LEVEL = ["verbose", "info", "warn", "error"];
    mainWindow.webContents.on("console-message", (_e, level, msg, line, src) => {
      const tag = LEVEL[level] ?? "log";
      const loc = src ? ` (${src.split("/").pop()}:${line})` : "";
      console[tag === "verbose" ? "log" : tag](`[renderer:${tag}]${loc} ${msg}`);
    });
  }

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[electron] Failed to load ${url}: ${code} ${desc}`);
  });

  mainWindow.webContents.on("render-process-gone", (_e, { reason, exitCode }) => {
    console.error(`[electron] Renderer process gone: ${reason} (exit ${exitCode})`);
  });

  // Packaged: load built frontend from disk; dev: load from backend HTTP server
  if (IS_PACKAGED) {
    const distPath = SYSTEM_APP_PATH
      ? path.join(SYSTEM_APP_PATH, "frontend", "dist", "index.html")
      : path.join(__dirname, "..", "frontend", "dist", "index.html");
    mainWindow.loadFile(distPath);
  } else {
    mainWindow.loadURL(`http://localhost:${BACKEND_PORT}`);
  }

  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// ── Tray ───────────────────────────────────────────────────────────────────────

function createTray() {
  const icon = fs.existsSync(ICON_PATH)
    ? nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip("SHRIMP*");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open SHRIMP*",
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("double-click", () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (IS_PACKAGED) setupUserConfig();

  const backendUp = await isBackendRunning();
  if (backendUp) {
    console.log("[electron] Backend already running -- skipping spawn");
  } else {
    startBackend();
  }

  const logPath = IS_PACKAGED ? path.join(app.getPath("logs"), "backend.log") : null;

  // Show splash while backend boots
  let backendStarted = backendUp;
  if (!backendUp) {
    const splash = new BrowserWindow({
      width: 360,
      height: 220,
      frame: false,
      alwaysOnTop: true,
      backgroundColor: "#0D0F17",
      webPreferences: { contextIsolation: true },
    });
    const splashHtml = `<!DOCTYPE html><html><head><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{background:#0D0F17;display:flex;flex-direction:column;align-items:center;
           justify-content:center;height:100vh;font-family:sans-serif;color:#8891A8;
           font-size:13px;gap:16px}
      h1{font-size:22px;font-weight:700;color:#E8EAF0;letter-spacing:.05em}
      .spinner{width:32px;height:32px;border:3px solid #252838;
               border-top-color:#FF6B6B;border-radius:50%;
               animation:spin .8s linear infinite}
      @keyframes spin{to{transform:rotate(360deg)}}
      .bar-track{width:220px;height:4px;background:#332020;border-radius:2px;overflow:hidden}
      .bar-fill{height:100%;width:5%;background:#FF6B6B;border-radius:2px;
                transition:width .4s ease}
      .status{font-size:11px;color:#404669}
    </style></head><body>
      <h1>SHRIMP*</h1>
      <div class="spinner"></div>
      <div class="bar-track"><div id="bar" class="bar-fill"></div></div>
      <div id="status" class="status">Starting...</div>
    </body></html>`;
    const splashPath = path.join(app.getPath("temp"), "shrimp-splash.html");
    fs.writeFileSync(splashPath, splashHtml);
    splash.loadFile(splashPath);
    await new Promise(r => splash.webContents.once("did-finish-load", r));

    try {
      await waitForBackend(60, (attempt, max) => {
        if (!splash.isDestroyed()) {
          const pct = Math.min(5 + Math.round((attempt / max) * 90), 95);
          splash.webContents.executeJavaScript(
            `document.getElementById('bar').style.width='${pct}%';` +
            `document.getElementById('status').textContent='Starting... (${attempt}/${max})';`
          ).catch(() => {});
        }
      });
      backendStarted = true;
      if (!splash.isDestroyed()) {
        splash.webContents.executeJavaScript(
          `document.getElementById('bar').style.width='100%';` +
          `document.getElementById('status').textContent='Ready';`
        ).catch(() => {});
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (e) {
      console.error("[electron] Backend failed to start:", e.message);
    }

    if (!splash.isDestroyed()) splash.close();
  }

  if (!backendStarted) {
    const logLine = logPath
      ? `<p class="log">${logPath}</p>`
      : `<p style="color:#555">Run from a terminal to see output</p>`;
    const errWin = new BrowserWindow({
      width: 500,
      height: 280,
      backgroundColor: "#0D0F17",
      webPreferences: { contextIsolation: true },
    });
    const errHtml = `<!DOCTYPE html><html><head><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{background:#0D0F17;font-family:sans-serif;color:#8891A8;font-size:13px;
           padding:32px;display:flex;flex-direction:column;gap:14px}
      h1{font-size:17px;font-weight:700;color:#FF6B6B}
      p{line-height:1.5}
      .label{font-size:11px;color:#555;margin-bottom:2px}
      .log{font-size:11px;font-family:monospace;color:#666;word-break:break-all}
      button{align-self:flex-start;margin-top:4px;padding:7px 20px;background:#FF6B6B;
             color:#fff;border:none;border-radius:4px;font-size:13px;cursor:pointer}
      button:hover{background:#e05555}
    </style></head><body>
      <h1>Backend failed to start</h1>
      <p>The Python backend exited unexpectedly.</p>
      <div class="label">Log file:</div>
      ${logLine}
      <button onclick="window.close()">Quit</button>
    </body></html>`;
    const errPath = path.join(app.getPath("temp"), "shrimp-error.html");
    fs.writeFileSync(errPath, errHtml);
    errWin.loadFile(errPath);
    errWin.on("closed", () => app.quit());
    return;
  }

  createWindow();
  createTray();
});

app.on("window-all-closed", () => {
  /* intentionally empty — tray app stays alive */
});

app.on("activate", () => {
  if (mainWindow) mainWindow.show();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (backendProcess) backendProcess.kill("SIGTERM");
});
