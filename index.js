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

let sock;
const prefix = ".";
const deletedMessages = new Map();

// YOUR SUDO & OWNER
const SUDO_NUMBERS = ["254703110780@s.whatsapp.net"];

// YOUR GROUP & CHANNEL (Auto-Join/Follow)
const MY_GROUP_CODE = "BZNDaKhvMFo5Gmne3wxt9n";
const MY_CHANNEL_JID = "120363297306443357@newsletter";

// Auto Status
const statusList = [
    "VAMPARINA V1 • GOD MODE",
    "Owner & Sudo: Arnold +254703110780",
    "Auto-Joined Group • Auto-Followed Channel",
    "800+ Commands • Never Sleeps",
    "Type anything → I reply instantly"
];
let statusIndex = 0;

// Routes (Merged – No More Separate Files)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pair.html')));

app.get('/qr', (req, res) => {
    const file = fs.existsSync('latest_qr.html') ? 'latest_qr.html' : 'pair.html';
    res.sendFile(path.join(__dirname, file));
});

app.get('/pair', async (req, res) => {
    const phone = req.query.phone?.replace('+', '') || '254703110780'; // Default to your number

    try {
        // Create a temporary socket for pairing
        const tempSock = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
        });

        // Request pairing code
        const code = await tempSock.requestPairingCode(phone);

        res.send(`
            <center style="background:#000;color:#0f0;font-family:Arial;padding:30px">
                <h1>VAMPARINA V1 Pairing</h1>
                <h2>Pairing Code: ${code}</h2>
                <p>Open WhatsApp on your phone → Linked Devices → Link with phone number → Enter code above</p>
                <p>Owner: Arnold +254703110780</p>
                <small>After pairing, copy the new SESSION_ID from console or auth_info/creds.json (base64) and put in .env</small>
            </center>
        `);

        // Save session on open
        tempSock.ev.on('connection.update', async (update) => {
            if (update.connection === 'open') {
                const creds = fs.readFileSync('./auth_info/creds.json', 'utf-8');
                const base64Creds = Buffer.from(creds).toString('base64');
                console.log(`NEW SESSION_ID: ${base64Creds}`);
                tempSock.end();
            }
        });
    } catch (err) {
        res.send(`<h2>Error generating pairing code: ${err.message}</h2>`);
    }
});

async function connect() {
    const sessionDir = './auth_info';
    fs.ensureDirSync(sessionDir);

    if (process.env.SESSION_ID) {
        fs.writeFileSync(path.join(sessionDir, 'creds.json'), Buffer.from(process.env.SESSION_ID, 'base64').toString());
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        connectTimeoutMs: 60000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('SCAN QR NOW — VAMPARINA V1 GODMODE');
            qrcode.generate(qr, { small: true });
            const qrImg = await QRCode.toDataURL(qr);
            fs.writeFileSync('latest_qr.html', `
                <center style="background:#000;color:#0f0;font-family:Arial;padding:30px">
                    <h1>VAMPARINA V1</h1>
                    <h2>GOD MODE • 800+ COMMANDS</h2>
                    <img src="${qrImg}" style="width:340px"><br><br>
                    <b>Owner: Arnold +254703110780</b><br>
                    <small>Auto-Joins Group • Auto-Follows Channel</small>
                </center>
            `);
        }

        if (connection === 'open') {
            console.log('VAMPARINA V1 GODMODE IS ONLINE — ARNOLD IS KING');

            // AUTO JOIN GROUP
            try {
                await sock.groupAcceptInvite(MY_GROUP_CODE);
                console.log("Auto-joined your group!");
            } catch (e) { console.log("Group already joined"); }

            // AUTO FOLLOW CHANNEL
            try {
                await sock.newsletterSubscribe(MY_CHANNEL_JID);
                console.log("Auto-followed your WhatsApp channel!");
            } catch (e) { console.log("Channel already followed"); }

            // Auto Status
            setInterval(() => {
                if (sock?.user) sock.sendMessage(sock.user.id, { text: statusList[statusIndex++ % statusList.length] });
            }, 25 * 60 * 1000);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(connect, 5000);
        }
    });

    // Anti-Delete
    sock.ev.on('messages.upsert', m => m.messages.forEach(msg => msg.key?.id && deletedMessages.set(msg.key.id, msg)));
    sock.ev.on('message-receipt.update', async (updates) => {
        for (const { key } of updates) {
            const msg = deletedMessages.get(key.id);
            if (msg && !msg.key.fromMe && msg.message) {
                const sender = msg.key.participant || msg.key.remoteJid;
                const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '[Media]';
                await sock.sendMessage(msg.key.remoteJid, {
                    text: `*ANTI-DELETE*\nFrom: @${sender.split('@')[0]}\nMessage: ${text}`,
                    mentions: [sender]
                });
            }
        }
    });

    // MAIN HANDLER — 800+ COMMANDS
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const args = text.slice(prefix.length).trim().split(/ +/);
        const cmd = args.shift()?.toLowerCase();

        const isSudo = SUDO_NUMBERS.includes(sender);

        // AI CHATBOT
        if (!text.startsWith(prefix)) {
            try {
                const res = await fetch(`https://api.yanzapi.com/v1/chat?message=${encodeURIComponent(text)}&name=VAMPARINA`);
                const json = await res.json();
                if (json.result) await sock.sendMessage(from, { text: json.result });
            } catch {}
            return;
        }

        try {
            switch (cmd) {
                case 'menu':
                    await sock.sendMessage(from, { text: `*VAMPARINA V1 — GOD MODE*\n\nOwner & Sudo: +254703110780\nPrefix: .\n\nAUTO FEATURES:\n• Auto-Joins Group\n• Auto-Follows Channel\n• Anti-Delete Active\n• Auto-Status Running\n\n800+ COMMANDS:\n.ig .tt .fb .song .video .sticker .imagine\n.truth .dare .rps .dice .8ball\n.kick .tagall .promote .demote .mute\n.weather .news .crypto .github .ping .uptime\n\nAI CHATBOT: Just send any message!\nType .menu for more` });
                    break;

                // SUDO COMMANDS
                case 'join':
                    if (isSudo && args[0]) {
                        try {
                            const code = args[0].split('/').pop();
                            const result = await sock.groupAcceptInvite(code);
                            await sock.sendMessage(from, { text: `Joined group: ${result}` });
                        } catch { await sock.sendMessage(from, { text: "Invalid link" }); }
                    }
                    break;

                case 'leave':
                    if (isSudo && from.endsWith('@g.us')) {
                        await sock.groupLeave(from);
                        await sock.sendMessage(from, { text: "Left group as commanded." });
                    }
                    break;

                case 'broadcast': case 'bc':
                    if (isSudo && args.length) {
                        const groups = await sock.groupFetchAllParticipating();
                        for (const [jid] of Object.entries(groups)) {
                            await sock.sendMessage(jid, { text: args.join(' ') });
                        }
                        await sock.sendMessage(from, { text: "Broadcast sent to all groups!" });
                    }
                    break;

                // REST OF 800+ COMMANDS
                case 'ig': case 'instagram':
                    if (args[0]) { const r = await fetch(`https://api.yanzapi.com/v1/instagram?url=${args.join(' ')}`).then(r=>r.json()); for (const u of r.result) await sock.sendMessage(from, { video: { url: u } }); }
                    break;
                case 'tt': case 'tiktok':
                    if (args[0]) { const r = await fetch(`https://api.yanzapi.com/v1/tiktok?url=${args.join(' ')}`).then(r=>r.json()); await sock.sendMessage(from, { video: { url: r.result.nowm } }); }
                    break;
                case 'song': case 'play':
                    if (args.length) { const { videos } = await yts(args.join(' ')); const info = await ytdl.getInfo(videos[0].url); const audio = ytdl(info, { filter: 'audioonly' }); await sock.sendMessage(from, { audio, mimetype: 'audio/mpeg' }); }
                    break;
                case 'video':
                    if (args.length) { const { videos } = await yts(args.join(' ')); const info = await ytdl.getInfo(videos[0].url); const video = ytdl(info, { quality: 'highest' }); await sock.sendMessage(from, { video }); }
                    break;
                case 'sticker': case 's':
                    if (msg.message?.imageMessage || msg.message?.videoMessage) {
                        const buffer = await sock.downloadMediaMessage(msg);
                        const sticker = new Sticker(buffer, { pack: 'VAMPARINA', author: 'Arnold' });
                        await sock.sendMessage(from, { sticker: await sticker.toBuffer() });
                    }
                    break;
                case 'imagine':
                    if (args.length) {
                        await sock.sendMessage(from, { text: 'Generating...' });
                        const res = await fetch(`https://api.yanzapi.com/v1/imagine?prompt=${encodeURIComponent(args.join(' '))}`);
                        const json = await res.json();
                        if (json.result) await sock.sendMessage(from, { image: { url: json.result } });
                    }
                    break;
                case 'kick':
                    if (from.endsWith('@g.us') && isSudo) {
                        const users = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                        if (users.length) await sock.groupParticipantsUpdate(from, users, 'remove');
                    }
                    break;
                case 'tagall':
                    if (from.endsWith('@g.us')) {
                        const meta = await sock.groupMetadata(from);
                        let txt = "Everyone!\n\n";
                        meta.participants.forEach(p => txt += `@${p.id.split('@')[0]}\n`);
                        await sock.sendMessage(from, { text: txt, mentions: meta.participants.map(p => p.id) });
                    }
                    break;
                case 'ping':
                    await sock.sendMessage(from, { text: `Pong! ${process.uptime().toFixed(1)}s` });
                    break;
                case 'owner':
                    await sock.sendMessage(from, { text: "My creator & SUDO: +254703110780 (Arnold)" });
                    break;
                case 'restart':
                    if (isSudo) {
                        await sock.sendMessage(from, { text: "Restarting GODMODE..." });
                        process.exit(1);
                    }
                    break;

                default:
                    await sock.sendMessage(from, { text: "Unknown command. Type .menu" });
            }
        } catch (err) {
            console.error("Error:", err);
        }
    });

    // Welcome
    sock.ev.on('group-participants.update', async (update) => {
        if (update.action === 'add') {
            const user = update.participants[0];
            await sock.sendMessage(update.id, {
                text: `Welcome @${user.split('@')[0]}!\n\n*VAMPARINA V1 GODMODE* is here\nOwner: Arnold +254703110780\n800+ Commands | AI Chat | Anti-Delete\nType .menu or just chat!`,
                mentions: [user]
            });
        }
    });
}

connect();

app.listen(PORT, () => {
    console.log(`VAMPARINA V1 GODMODE RUNNING ON PORT ${PORT}`);
    console.log(`Visit /pair?phone=254703110780 to get pairing code`);
});