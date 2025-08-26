// AmbientChat minimal API server
// Node 18+
// npm i express cors
// (Опционально для локальной отладки: persist в файл data.json)

const express = require("express");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "15mb" })); // для аватаров/вложений (dataURL)

const DATA_FILE = process.env.DATA_FILE || "./data.json";

// ============ In-Memory Store (с простым persist в файл) ============
let store = {
  users: [],        // { id, name, nickname, avatar, privacy:{showOnline,allowNick,allowId,lastSeen}, createdAt, lastSeen }
  chats: {},        // key -> { id, users:[idA,idB], messages:[{from,text,ts,reactions:[]}] }
};

// Загрузка из файла при старте (если есть)
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") store = parsed;
    console.log("✅ Loaded data from", DATA_FILE);
  }
} catch (e) {
  console.warn("⚠️ Failed to load data.json:", e.message);
}

// Периодическое сохранение
function persist() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (e) {
    console.warn("⚠️ Persist error:", e.message);
  }
}
setInterval(persist, 5000);

// ============ Helpers ============
const NICK_RE = /^@([A-Za-z0-9_]{1,11})$/;

function genId() {
  // Формат: две заглавные буквы + 8 цифр (пример: AC12345678)
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const L1 = letters[Math.floor(Math.random()*letters.length)];
  const L2 = letters[Math.floor(Math.random()*letters.length)];
  const digits = Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
  return `${L1}${L2}${digits}`;
}
function uniqueId() {
  let id;
  do { id = genId(); } while (store.users.some(u => u.id === id));
  return id;
}
function nowTs(){ return Date.now(); }

function getUserPublic(user){
  if (!user) return null;
  const { id, name, nickname, avatar, privacy, lastSeen, createdAt } = user;
  return { id, name, nickname, avatar: avatar || null, privacy, lastSeen, createdAt };
}
function makeChatKey(a,b){
  const [x,y] = [a,b].sort();
  return `${x}__${y}`;
}
function getOrCreateChat(a,b){
  const key = makeChatKey(a,b);
  if (!store.chats[key]) {
    store.chats[key] = { id: key, users: [a,b].sort(), messages: [] };
  }
  return store.chats[key];
}
function isNickUnique(nickname, excludeId=null){
  return !store.users.some(u => u.nickname === nickname && u.id !== excludeId);
}

// ============ Routes ============

// Health
app.get("/", (req,res)=>res.json({ ok:true, service:"AmbientChat API" }));

// Регистрация
app.post("/api/register", (req, res) => {
  try {
    const { nickname, name } = req.body || {};
    if (!nickname || !name) return res.status(400).json({ error: "nickname and name required" });
    if (!NICK_RE.test(nickname)) return res.status(400).json({ error: "Invalid nickname format (@name, up to 11 [A-Za-z0-9_])" });
    if (name.length === 0 || name.length > 20) return res.status(400).json({ error: "Name length must be 1..20" });
    if (!isNickUnique(nickname)) return res.status(400).json({ error: "Nickname already taken" });

    const id = uniqueId();
    const user = {
      id, name, nickname,
      avatar: null,
      privacy: {
        showOnline: true,
        allowNick: true,
        allowId: true,
        lastSeen: nowTs(),
      },
      createdAt: nowTs(),
      lastSeen: nowTs(),
    };
    store.users.push(user);
    persist();
    return res.json(getUserPublic(user));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:"register failed" });
  }
});

// Вход по ID (и проверка ника)
app.post("/api/login", (req, res) => {
  try {
    const { id, nickname } = req.body || {};
    if (!id || !nickname) return res.status(400).json({ error: "id and nickname required" });
    const u = store.users.find(x => x.id === id && x.nickname === nickname);
    if (!u) return res.status(404).json({ error: "User not found" });
    u.lastSeen = nowTs();
    persist();
    return res.json(getUserPublic(u));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:"login failed" });
  }
});

// Получить юзера по id
app.get("/api/users/:id", (req, res) => {
  const { id } = req.params;
  const u = store.users.find(x => x.id === id);
  if (!u) return res.status(404).json({ error:"not found" });
  return res.json(getUserPublic(u));
});

// Поиск пользователей (по q: id или nickname)
// Учитывает приватность:
//  - если allowNick=false, по нику не находится;
//  - если allowId=false, по id не находится.
// Пустой q: вернём 30 последних зарегистрированных (без приватных фильтров)
app.get("/api/users/search", (req, res) => {
  try {
    const q = (req.query.q || "").trim();

    // пустой запрос — выдаём ленту последних юзеров (ограничим 30)
    if (!q) {
      const latest = [...store.users]
        .sort((a,b)=>b.createdAt - a.createdAt)
        .slice(0,30)
        .map(getUserPublic);
      return res.json(latest);
    }

    // если q начинается с '@' — ищем по никнейму
    if (q.startsWith("@")) {
      const user = store.users.find(u => u.nickname === q);
      if (!user) return res.json([]);
      if (user.privacy && user.privacy.allowNick === false) return res.json([]); // скрыт от поиска по нику
      return res.json([getUserPublic(user)]);
    }

    // иначе пробуем точное совпадение по ID
    const user = store.users.find(u => u.id === q);
    if (!user) return res.json([]);
    if (user.privacy && user.privacy.allowId === false) return res.json([]); // скрыт от поиска по ID
    return res.json([getUserPublic(user)]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:"search failed" });
  }
});

// Обновление профиля
app.put("/api/users/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { name, nickname, avatar, privacy } = req.body || {};
    const user = store.users.find(u => u.id === id);
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    // валидации
    if (nickname && !NICK_RE.test(nickname)) {
      return res.status(400).json({ error:"Invalid nickname format (@name, up to 11 [A-Za-z0-9_])" });
    }
    if (nickname && !isNickUnique(nickname, id)) {
      return res.status(400).json({ error:"Ник уже занят" });
    }
    if (name && (name.length === 0 || name.length > 20)) {
      return res.status(400).json({ error:"Name length must be 1..20" });
    }

    if (name) user.name = name;
    if (nickname) user.nickname = nickname;
    if (avatar !== undefined) user.avatar = avatar;
    if (privacy && typeof privacy === "object") {
      user.privacy = {
        ...user.privacy,
        ...privacy,
        lastSeen: nowTs(),
      };
    }
    user.lastSeen = nowTs();

    persist();
    return res.json(getUserPublic(user));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:"update failed" });
  }
});

// Открыть/создать чат между двумя пользователями
app.post("/api/chats/open", (req, res) => {
  try {
    const { a, b } = req.body || {};
    if (!a || !b) return res.status(400).json({ error:"a and b required" });
    const ua = store.users.find(u => u.id === a);
    const ub = store.users.find(u => u.id === b);
    if (!ua || !ub) return res.status(404).json({ error:"user(s) not found" });

    const chat = getOrCreateChat(a, b);
    return res.json({
      id: chat.id,
      users: chat.users,
      messages: chat.messages || [],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:"open chat failed" });
  }
});

// Отправить сообщение в чат
app.post("/api/chats/:id/messages", (req, res) => {
  try {
    const { id } = req.params;
    const { from, text } = req.body || {};
    if (!from || typeof text !== "string") return res.status(400).json({ error:"from and text required" });

    const chat = store.chats[id];
    if (!chat) return res.status(404).json({ error:"chat not found" });
    if (!chat.users.includes(from)) return res.status(403).json({ error:"forbidden" });

    const msg = { from, text, ts: nowTs(), reactions: [] };
    chat.messages.push(msg);

    // обновим lastSeen отправителя
    const u = store.users.find(x => x.id === from);
    if (u) u.lastSeen = nowTs();

    persist();
    return res.json({ ok:true, message: msg });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:"send message failed" });
  }
});

// Реакция к сообщению
app.post("/api/chats/:id/react", (req, res) => {
  try {
    const { id } = req.params;
    const { index, emoji, from } = req.body || {};
    const chat = store.chats[id];
    if (!chat) return res.status(404).json({ error:"chat not found" });
    if (typeof index !== "number" || !emoji) return res.status(400).json({ error:"index and emoji required" });
    const msg = chat.messages[index];
    if (!msg) return res.status(404).json({ error:"message not found" });

    msg.reactions = msg.reactions || [];
    msg.reactions.push({ from, emoji, ts: nowTs() });
    persist();

    return res.json({ ok:true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:"react failed" });
  }
});

// ============ Start ============
app.listen(PORT, () => {
  console.log(`✅ AmbientChat server running on http://localhost:${PORT}`);
});
