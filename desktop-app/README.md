# Bortolini · App Desktop (Electron)

Janela única com o **sistema Bortolini** e o **WhatsApp Web** lado a lado.
O WhatsApp roda dentro do app via `<webview>` — conexão pelo **QR code** lido no celular.

## Rodar

Precisa de **Node 18+** instalado.

```bash
cd desktop-app
npm install      # baixa o Electron (~250 MB na 1ª vez)
npm start
```

## Como conectar o WhatsApp

1. Ao abrir, o painel direito carrega o WhatsApp Web e mostra o **QR code**.
2. No celular: **WhatsApp → Aparelhos conectados → Conectar aparelho** → escaneie o QR.
3. Pronto. A sessão fica salva (`partition="persist:whatsapp"`) — nas próximas vezes abre já conectado.

## Configurar o sistema

- Na barra de cima, o campo de URL aponta pro sistema. Padrão: `https://bortolini-pizzaria.onrender.com`.
- Para testar local, troque por `http://localhost:8000` e clique em **Abrir** (fica salvo).

## Observações

- É o **WhatsApp Web de verdade, manual** — você atende pela janela. Não envia mensagem automática nem integra com os pedidos.
- Para envio automático ligado aos pedidos, use o serviço **Baileys** em `../whatsapp-service`.
- Roda só no computador onde o app está aberto; mantenha-o ligado para receber mensagens.
- Use um número dedicado da pizzaria.

## Gerar instalador (.exe) — opcional

```bash
npm install --save-dev electron-builder
npx electron-builder --win
```
