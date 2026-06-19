require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
console.log('KOLMEYA_WEBHOOK_URL:', process.env.KOLMEYA_WEBHOOK_URL);
