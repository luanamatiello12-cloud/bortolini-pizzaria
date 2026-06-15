const { app, BrowserWindow, session, shell } = require("electron");
const path = require("path");

// User-agent de Chrome. Sem isto o WhatsApp Web mostra "atualize seu navegador".
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "Bortolini · Central de Atendimento",
    backgroundColor: "#1f2937",
    webPreferences: {
      webviewTag: true,       // habilita as <webview>
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Sessão persistente do WhatsApp (sobrevive a fechar/reabrir o app)
  const waSession = session.fromPartition("persist:whatsapp");
  waSession.setUserAgent(CHROME_UA);
  // Permite notificações/áudio do WhatsApp Web
  waSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(["notifications", "media", "clipboard-sanitized-write"].includes(permission));
  });

  win.loadFile(path.join(__dirname, "index.html"));
  // win.webContents.openDevTools();
}

// Links/popups (abrir imagem, "abrir no navegador" etc.) vão pro navegador padrão
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
