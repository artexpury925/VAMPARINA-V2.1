import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fetch from 'node-fetch';
import ytdl from 'ytdl-core';
import yts from 'yt-search';
import { Sticker } from 'wa-sticker-formatter';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

app.use(express.static(__dirname));
app.use(express.json());

// SUDO & OWNER
const SUDO_NUMBERS = ["254703110780@s.whatsapp.net"];

// YOUR GROUP & CHANNEL
const MY_GROUP_CODE = "BZNDaKhvMFo5Gmne3wxt9n";
const MY_CHANNEL_JID = "120363297306443357@newsletter";

// Auto Status List
const statusList = [
    "VAMPARINA V1 • MULTI-SESSION GOD",
    "Owner: Arnold +254703110780",
    "1000+ Commands • Sessions Folder Active",
    "Upload creds.json to /sessions → Bot is yours!",
    "Kenya's Most Powerful Bot Ever"
];
let statusIndex = 0;

// Ensure sessions folder exists
fs.ensureDirSync('./sessions');

// Active bots storage
const activeBots = new Map(); // jid → sock

async function startBotFromSession(sessionPath) {
    const sessionId = path.basename(sessionPath, '.json');
    if (activeBots.has(sessionId)) return;

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath.replace('creds.json', ''));

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        connectTimeoutMs: 60000,
    });

    activeBots.set(sessionId, sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`QR for ${sessionId}: Scan now!`);
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log(`BOT ONLINE → ${sock.user?.id || sessionId}`);

            // Auto-join your group
            try { await sock.groupAcceptInvite(MY_GROUP_CODE); } catch {}
            // Auto-follow your channel
            try { await sock.newsletterSubscribe(MY_CHANNEL_JID); } catch {}

            // Auto status
            setInterval(() => {
                if (sock.user) sock.sendMessage(sock.user.id, { text: statusList[statusIndex++ % statusList.length] });
            }, 25 * 60 * 1000);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(() => startBotFromSession(sessionPath), 5000);
            else activeBots.delete(sessionId);
        }
    });

    // Shared message handler for all bots
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const isSudo = SUDO_NUMBERS.includes(sender);

        // AI Chat (no prefix)
        if (!text.startsWith('.')) {
            try {
                const res = await fetch(`https://api.yanzapi.com/v1/chat?message=${encodeURIComponent(text)}&name=VAMPARINA`);
                const json = await res.json();
                if (json.result) await sock.sendMessage(from, { text: json.result });
            } catch {}
            return;
        }

        const args = text.slice(1).trim().split(/ +/);
        const cmd = args.shift()?.toLowerCase();

        try {
            if (cmd === 'menu') {
                await sock.sendMessage(from, { text: `*VAMPARINA V1 — MULTI-SESSION*\n\nOwner: +254703110780\nSessions: Active from /sessions folder\n\n1000+ COMMANDS\n.sticker .imagine .tt .song .video\n.truth .dare .antilink .antibadword\n.mpesa .news .stock .covid .github\n\nJust type anything → I reply!\nUpload creds.json to sessions/ → Bot is yours forever!` });
            }
            // Add all your other commands here (antilink, sticker, etc.) — same as before
            // For brevity, keeping core ones — you can paste the rest from previous version

            else if (cmd === 'owner') {
                await sock.sendMessage(from, { text: "Creator & God: Arnold +254703110780" });
            }
            else if (cmd === 'ping') {
                await sock.sendMessage(from, { text: `Pong! ${process.uptime().toFixed(1)}s` });
            }
            else if (cmd === 'restart' && isSudo) {
                await sock.sendMessage(from, { text: "Restarting all bots..." });
                process.exit(1);
            }
            else {
                await sock.sendMessage(from, { text: "Unknown command. Type .menu" });
            }
        } catch (err) {
            console.error("Error:", err);
        }
    });
}

// Scan sessions folder on startup + watch for new files
function loadAllSessions() {
    const files = fs.readdirSync('./sessions');
    files.forEach(file => {
        if (file === 'creds.json') {
            startBotFromSession('./sessions/creds.json');
        } else if (fs.statSync(`./sessions/${file}`).isDirectory()) {
            const credPath = `./sessions/${file}/creds.json`;
            if (fs.existsSync(credPath)) {
                startBotFromSession(credPath);
            }
        }
    });
}

// Watch for new sessions
fs.watch('./sessions', { recursive: true }, (event, filename) => {
    if (filename && filename.endsWith('creds.json')) {
        const fullPath = path.join('./sessions', filename);
        setTimeout(() => startBotFromSession(fullPath), 3000); // Delay to avoid race
    }
});

// Initial load
loadAllSessions();

// Web routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pair.html')));
app.get('/qr', (req, res) => res.sendFile(path.join(__dirname, fs.existsSync('latest_qr.html') ? 'latest_qr.html' : 'pair.html')));

app.listen(PORT, () => {
    console.log(`VAMPARINA V1 MULTI-SESSION BOT RUNNING ON PORT ${PORT}`);
    console.log(`Upload creds.json to /sessions folder → Bot becomes alive!`);
    console.log(`Supports: sessions/creds.json OR sessions/2547xxx/creds.json`);
});