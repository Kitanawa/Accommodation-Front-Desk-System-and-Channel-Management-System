// Password hashing and password rules (S056, S058).
// The SRS does not set a password policy, so the rules below are assumptions (listed in the contract).
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const PARAMS = { N: 32768, r: 8, p: 1, keylen: 32 };       // scrypt, about 32 MiB per hash
const MAXMEM = 128 * 1024 * 1024;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAXMEM });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: MAXMEM });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
const needsRehash = stored => { const [alg, N, r, p] = String(stored).split('$'); return alg !== 'scrypt' || +N < PARAMS.N || +r < PARAMS.r || +p < PARAMS.p; };
let dummy;   // used so an unknown email takes as long as a known one (no timing leak)
const verifyDummy = async pw => { dummy = dummy || await hashPassword('not-a-real-password'); await verifyPassword(pw, dummy); };

const POLICY = {
  min_length: 10, max_length: 128, require_letter: true, require_digit: true,
  rules: ['At least 10 characters (up to 128).', 'Contains at least one letter and one number.',
    'Is not a very common password (for example "password" or "qwerty" with numbers added).',
    'Does not contain your email name or a part of your name that is 4 or more letters long.'],
};
const COMMON_BASES = ['password', 'passw0rd', 'qwerty', 'qwertyuiop', 'letmein', 'welcome', 'admin', 'administrator', 'changeme', 'iloveyou', 'abc', 'abcdef', 'monkey', 'dragon', 'football', 'login', 'master'];

// returns an array of messages; empty array = acceptable
function validatePassword(pw, { email, full_name } = {}) {
  if (typeof pw !== 'string') return ['Password is required.'];
  const out = [];
  if (pw.length < POLICY.min_length) out.push(`Password must be at least ${POLICY.min_length} characters.`);
  if (pw.length > POLICY.max_length) out.push(`Password must be at most ${POLICY.max_length} characters.`);
  if (!/[A-Za-z]/.test(pw)) out.push('Password must contain at least one letter.');
  if (!/[0-9]/.test(pw)) out.push('Password must contain at least one number.');
  const lower = pw.toLowerCase(), lettersOnly = lower.replace(/[^a-z]/g, '');
  if (COMMON_BASES.includes(lettersOnly) || /^(.)\1+$/.test(pw)) out.push('Password is too common or too simple.');
  const bits = [];
  if (email) { const local = String(email).toLowerCase().split('@')[0]; if (local.length >= 4) bits.push(local); }
  if (full_name) String(full_name).toLowerCase().split(/[^a-z]+/).filter(t => t.length >= 4).forEach(t => bits.push(t));
  if (bits.some(b => lower.includes(b))) out.push('Password must not contain your name or email name.');
  return out;
}
module.exports = { hashPassword, verifyPassword, needsRehash, verifyDummy, validatePassword, POLICY };
