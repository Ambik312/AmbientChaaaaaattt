// AmbientChat API server with login/register
// npm i express cors

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "15mb" }));

// Простая база в памяти (для тестов). Для продакшена → Postgres.
let users = [];
let chats = {};

function genId() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const L1 = letters[Math.floor(Math.random()*letters.length)];
  const L2 = letters[Math.floor(Math.random()*letters.length)];
  const digits = Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
  return `${L1}${L2}${digits}`;
}
function uniqueId(){
  let id;
  do { id = genId(); } while (users.find(u=>u.id===id));
  return id;
}
function now(){ return Date.now(); }
const NICK_RE = /^@([A-Za-z0-9_]{1,11})$/;

function publicUser(u){
  if(!u) return null;
  return { id:u.id, name:u.name, nickname:u.nickname, avatar:u.avatar||null, lastSeen:u.lastSeen };
}

// Регистрация
app.post("/api/register",(req,res)=>{
  const {nickname,name} = req.body||{};
  if(!nickname||!name) return res.status(400).json({error:"nickname and name required"});
  if(!NICK_RE.test(nickname)) return res.status(400).json({error:"bad nickname"});
  if(users.find(u=>u.nickname===nickname)) return res.status(400).json({error:"nickname taken"});
  const id = uniqueId();
  const user={id,nickname,name,avatar:null,lastSeen:now()};
  users.push(user);
  res.json(publicUser(user));
});

// Вход
app.post("/api/login",(req,res)=>{
  const {id,nickname} = req.body||{};
  const u = users.find(x=>x.id===id && x.nickname===nickname);
  if(!u) return res.status(404).json({error:"not found"});
  u.lastSeen=now();
  res.json(publicUser(u));
});

// Поиск
app.get("/api/users/search",(req,res)=>{
  const q=(req.query.q||"").trim();
  if(!q) return res.json([]);
  if(q.startsWith("@")){
    const u=users.find(x=>x.nickname===q);
    return res.json(u?[publicUser(u)]:[]);
  }
  const u=users.find(x=>x.id===q);
  return res.json(u?[publicUser(u)]:[]);
});

// Обновить профиль
app.put("/api/users/:id",(req,res)=>{
  const {id}=req.params;
  const {name,nickname,avatar}=req.body||{};
  const u=users.find(x=>x.id===id);
  if(!u) return res.status(404).json({error:"not found"});
  if(nickname && (!NICK_RE.test(nickname) || users.some(x=>x.nickname===nickname && x.id!==id)))
    return res.status(400).json({error:"bad or taken nickname"});
  if(name) u.name=name;
  if(nickname) u.nickname=nickname;
  if(avatar!==undefined) u.avatar=avatar;
  u.lastSeen=now();
  res.json(publicUser(u));
});

// Открыть/создать чат
function chatKey(a,b){ return [a,b].sort().join("__"); }
app.post("/api/chats/open",(req,res)=>{
  const {a,b}=req.body||{};
  if(!a||!b) return res.status(400).json({error:"a,b required"});
  const key=chatKey(a,b);
  if(!chats[key]) chats[key]={id:key,users:[a,b].sort(),messages:[]};
  res.json(chats[key]);
});

// Отправить сообщение
app.post("/api/chats/:id/messages",(req,res)=>{
  const {id}=req.params;
  const {from,text}=req.body||{};
  const chat=chats[id];
  if(!chat) return res.status(404).json({error:"chat not found"});
  const msg={from,text,ts:now(),reactions:[]};
  chat.messages.push(msg);
  res.json({ok:true,message:msg});
});

// Реакция
app.post("/api/chats/:id/react",(req,res)=>{
  const {id}=req.params;
  const {index,emoji,from}=req.body||{};
  const chat=chats[id];
  if(!chat) return res.status(404).json({error:"chat not found"});
  const msg=chat.messages[index];
  if(!msg) return res.status(404).json({error:"msg not found"});
  msg.reactions.push({from,emoji,ts:now()});
  res.json({ok:true});
});

app.listen(PORT,()=>console.log("✅ Server on http://localhost:"+PORT));
