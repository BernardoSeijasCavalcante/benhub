const fs = require('fs');
const dotenv = require('dotenv');

const envConfig = dotenv.parse(fs.readFileSync('.env'));
console.log('KOLMEYA_WEBHOOK_URL via dotenv.parse:', envConfig.KOLMEYA_WEBHOOK_URL);
console.log('Length:', envConfig.KOLMEYA_WEBHOOK_URL.length);
