const crypto = require('crypto');

const password = 'admin123';
const salt = crypto.randomBytes(16);

crypto.scrypt(password, salt, 64, (err, hash) => {
    if (err) throw err;

    console.log(
        'scrypt$1$' +
        salt.toString('hex') +
        '$' +
        hash.toString('hex')
    );
});