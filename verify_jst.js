const { getNowJST, getTodayJST, normalizeDateStr } = require('./app/utils/date.js');

console.log("--- JST Verification ---");
const nowJST = getNowJST();
console.log("Current JST Time (Date obj):", nowJST.toString());
console.log("Current JST Time (ISO):", nowJST.toISOString());

const todayJST = getTodayJST();
console.log("Today JST (YYYY-MM-DD):", todayJST);

const fakeDate = normalizeDateStr("2025/12/25");
console.log("Normalized 2025/12/25:", fakeDate);

// Verify mismatch check (emulate UTC server time)
const nowUTC = new Date();
console.log("Server System Time (UTC):", nowUTC.toISOString());

if (nowUTC.getHours() + 9 !== nowJST.getHours() && (nowUTC.getHours() + 9) % 24 !== nowJST.getHours()) {
    // Basic check, might fail near day boundary if not careful, but good enough for rough check
    console.log("NOTE: Hour difference check might look weird if running on local JST machine.");
}
