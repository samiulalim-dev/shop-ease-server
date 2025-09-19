const fs = require("fs");
const key = fs.readFileSync("./shop-ease-fb-key.json");
const base64Key = Buffer.from(key).toString("base64");
console.log(base64Key);
