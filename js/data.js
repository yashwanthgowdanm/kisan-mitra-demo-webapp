"use strict";
/* ---------- reference data ---------- */
const CROPS=["Paddy","Wheat","Maize","Ragi","Jowar","Bajra","Tur (Arhar)","Moong","Urad","Chickpea","Groundnut","Soybean","Mustard","Sunflower","Cotton","Sugarcane","Tomato","Onion","Potato","Chilli","Brinjal","Okra (Bhindi)","Cabbage","Banana","Mango","Coconut","Arecanut","Coffee","Turmeric","Grapes","Pomegranate"];
const STATES=["Andhra Pradesh","Bihar","Chhattisgarh","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Odisha","Punjab","Rajasthan","Tamil Nadu","Telangana","Uttar Pradesh","Uttarakhand","West Bengal","Assam","Other"];
/* MSP: Kharif marketing season 2026-27 (CCEA, 13 May 2026) and Rabi RMS 2026-27 (DES MSP statement) — ₹/quintal */
const MSP=[
["Paddy (Common)",2441,"Kharif 2026-27"],["Paddy (Grade A)",2461,"Kharif 2026-27"],["Jowar (Hybrid)",4023,"Kharif 2026-27"],["Jowar (Maldandi)",4073,"Kharif 2026-27"],["Bajra",2900,"Kharif 2026-27"],["Ragi",5205,"Kharif 2026-27"],["Maize",2410,"Kharif 2026-27"],["Tur (Arhar)",8450,"Kharif 2026-27"],["Moong",8780,"Kharif 2026-27"],["Urad",8200,"Kharif 2026-27"],["Groundnut",7517,"Kharif 2026-27"],["Sunflower seed",8343,"Kharif 2026-27"],["Soybean (Yellow)",5708,"Kharif 2026-27"],["Sesamum",10346,"Kharif 2026-27"],["Nigerseed",10052,"Kharif 2026-27"],["Cotton (Medium staple)",8267,"Kharif 2026-27"],["Cotton (Long staple)",8667,"Kharif 2026-27"],
["Wheat",2585,"Rabi RMS 2026-27"],["Barley",2150,"Rabi RMS 2026-27"],["Gram (Chickpea)",5875,"Rabi RMS 2026-27"],["Masur (Lentil)",7000,"Rabi RMS 2026-27"],["Rapeseed & Mustard",6200,"Rabi RMS 2026-27"],["Safflower",6540,"Rabi RMS 2026-27"]];
function mspFor(crop){const c=(crop||"").toLowerCase();const map={paddy:"Paddy (Common)",rice:"Paddy (Common)",wheat:"Wheat",maize:"Maize",ragi:"Ragi",jowar:"Jowar (Hybrid)",bajra:"Bajra",tur:"Tur (Arhar)",arhar:"Tur (Arhar)",moong:"Moong",urad:"Urad",chickpea:"Gram (Chickpea)",gram:"Gram (Chickpea)",groundnut:"Groundnut",soybean:"Soybean (Yellow)",mustard:"Rapeseed & Mustard",sunflower:"Sunflower seed",cotton:"Cotton (Medium staple)",barley:"Barley",lentil:"Masur (Lentil)",masur:"Masur (Lentil)",sesam:"Sesamum"};for(const k in map){if(c.includes(k))return MSP.find(m=>m[0]===map[k]);}return null;}

/* ---------- icons ---------- */
const P={
leaf:'<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7"/>',
cloud:'<path d="M7 17h10a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3 3 0 0 0 7 17z"/>',
rupee:'<path d="M7 5h10M7 9h10M9 5c5 0 5 8 0 8H7l7 7"/>',
cal:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
flask:'<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 15h9"/>',
chart:'<path d="M4 20h16M7 16v-5M12 16V7M17 16v-8"/>',
tree:'<path d="M12 21v-6M12 15c-4 0-6-2-6-5a6 6 0 0 1 12 0c0 3-2 5-6 5z"/>',
drop:'<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
calc:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2"/>',
sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
map:'<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14"/>',
book:'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16"/>',
cow:'<path d="M6 8c-2 0-3-1-3-3 2 0 3 1 3 3zm12 0c2 0 3-1 3-3-2 0-3 1-3 3zM6 8h12v6a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4zM10 15h.01M14 15h.01"/>',
shield:'<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
bag:'<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
tractor:'<circle cx="7" cy="17" r="3"/><circle cx="18" cy="18" r="2"/><path d="M4 14V8h7l2 6h7v4M11 8V5h4"/>',
drone:'<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 7l3 3h4l3-3M10 10v3h4v-3M12 13v4"/>',
users:'<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M18 15c2 .5 3 2 3 5"/>',
box:'<path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/>',
chat:'<path d="M4 5h16v11H9l-5 4z"/>',
radio:'<rect x="3" y="8" width="18" height="12" rx="2"/><circle cx="15" cy="14" r="3"/><path d="M6 12h4M6 16h4M7 8l10-5"/>',
bank:'<path d="M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/>',
flag:'<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
bot:'<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/>',
home:'<path d="M4 11l8-7 8 7v9H4zM10 20v-6h4v6"/>',
back:'<path d="M15 5l-7 7 7 7"/>',
cam:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
speaker:'<path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
};
const icon=(n,s=20)=>`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]||P.leaf}</svg>`;

/* ---------- tool registry ---------- */
const TOOLS=[
{id:"diagnose",g:"farm",i:"leaf"},{id:"weather",g:"farm",i:"cloud"},{id:"mandi",g:"farm",i:"rupee"},{id:"advisory",g:"farm",i:"cal"},{id:"soil",g:"farm",i:"flask"},{id:"planner",g:"farm",i:"chart"},{id:"agroforestry",g:"farm",i:"tree"},{id:"irrigation",g:"farm",i:"drop"},{id:"profit",g:"farm",i:"calc"},{id:"solar",g:"farm",i:"sun"},{id:"boundary",g:"farm",i:"map"},{id:"timeline",g:"farm",i:"book"},{id:"livestock",g:"farm",i:"cow"},{id:"safety",g:"farm",i:"shield"},
{id:"sell",g:"market",i:"bag"},{id:"equipment",g:"market",i:"tractor"},{id:"drone",g:"market",i:"drone"},{id:"jobs",g:"market",i:"users"},{id:"agribox",g:"market",i:"box"},{id:"clubs",g:"market",i:"users"},
{id:"forum",g:"comm",i:"chat"},{id:"courses",g:"comm",i:"book"},{id:"radio",g:"comm",i:"radio"},{id:"loans",g:"comm",i:"bank"},{id:"fpo",g:"comm",i:"flag"},
];
const FORYOU={farmer:["diagnose","weather","mandi","advisory","soil","sell","loans"],buyer:["sell","mandi","clubs","forum","agribox"],service:["drone","equipment","jobs","forum","mandi"],entre:["clubs","fpo","sell","planner","mandi","loans"],govt:["forum","courses","loans","fpo","radio","mandi"]};
const ROLES=["farmer","buyer","service","entre","govt"];

