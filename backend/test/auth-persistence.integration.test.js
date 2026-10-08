import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('auth: stored credentials verify, survive restarts and sessions keep their full lifetime', { skip: !process.env.DATABASE_URL }, async (t) => {
  const { pool } = await import('../db.js');
  const auth = await import('../auth.js');
  const tag = `ap${Date.now()}`;
  const demo = `${tag}-demo@example.test`;
  const emails = [demo];
  const req = { secure: true, headers: { 'x-forwarded-proto': 'https' } };
  const cookieOf = () => { const h = {}; return { h, res: { setHeader: (k, v) => { h[k] = v; } } }; };
  const mkUser = async (email, hashOrPlain, verified = 1) => {
    emails.push(email);
    const [r] = await pool.query('INSERT INTO app_users (name,email,password_hash,email_verified,role) VALUES (?,?,?,?,?)', ['T', email, hashOrPlain, verified, 'USER']);
    return r.insertId;
  };
  t.after(async () => {
    await pool.query('DELETE FROM app_users WHERE email IN (?)', [emails]);
    await pool.query('DELETE FROM auth_otps WHERE email IN (?)', [emails]);
    delete process.env.DEMO_EMAIL; delete process.env.DUMMY_PASSWORD; delete process.env.SYNC_DEMO_PASSWORD;
    await pool.end();
  });
  const signIn = (email, password, rememberMe = true) => { const c = cookieOf(); return auth.signIn(req, c.res, { email, password, rememberMe }).then((r) => ({ ...r, cookie: c.h['Set-Cookie']?.split(';')[0] })); };

  await t.test('a password chosen through the reset OTP flow survives a server restart', async () => {
    process.env.DEMO_EMAIL = demo; process.env.DUMMY_PASSWORD = 'EnvPassword#1'; delete process.env.SYNC_DEMO_PASSWORD;
    await mkUser(demo, await auth.hashPassword('EnvPassword#1'));
    await pool.query("INSERT INTO auth_otps (email,purpose,otp_hash,expires_at,attempts,created_at) VALUES (?,?,?,NOW() + INTERVAL 5 MINUTE,0,NOW())", [demo, 'password_reset', sha('123456')]);
    const c = cookieOf();
    const reset = await auth.resetPassword(req, c.res, { email: demo, otp: '123456', password: 'ChosenNew#2' });
    assert.equal(reset.ok, true);
    await auth.ensureDemoAccount(); await auth.ensureDemoAccount();   // two "restarts"
    assert.equal((await signIn(demo, 'ChosenNew#2')).ok, true, 'chosen password still works');
    assert.equal((await signIn(demo, 'EnvPassword#1')).ok, false, 'environment password is not forced back');
  });

  await t.test('SYNC_DEMO_PASSWORD=true deliberately pushes the environment password', async () => {
    process.env.SYNC_DEMO_PASSWORD = 'true';
    await auth.ensureDemoAccount();
    assert.equal((await signIn(demo, 'EnvPassword#1')).ok, true);
    assert.equal((await signIn(demo, 'ChosenNew#2')).ok, false);
    delete process.env.SYNC_DEMO_PASSWORD;
  });

  await t.test('missing demo settings do not stop the API from starting', async () => {
    const keep = [process.env.DEMO_EMAIL, process.env.DUMMY_PASSWORD];
    delete process.env.DEMO_EMAIL; delete process.env.DUMMY_PASSWORD;
    assert.equal(await auth.ensureDemoAccount(), null);
    [process.env.DEMO_EMAIL, process.env.DUMMY_PASSWORD] = keep;
  });

  await t.test('sign-in checks the database row: right password in, wrong or unverified out', async () => {
    const email = `${tag}-a@example.test`;
    await mkUser(email, await auth.hashPassword('GoodPassword#3'));
    const ok = await signIn(email.toUpperCase(), 'GoodPassword#3');
    assert.equal(ok.ok, true, 'email match is case-insensitive');
    assert.equal((await auth.getSession({ headers: { cookie: ok.cookie } })).user.email, email);
    assert.equal((await signIn(email, 'wrong-password')).ok, false);
    const unv = `${tag}-u@example.test`;
    await mkUser(unv, await auth.hashPassword('GoodPassword#3'), 0);
    assert.equal((await signIn(unv, 'GoodPassword#3')).ok, false);
    assert.equal((await signIn(`${tag}-nobody@example.test`, 'GoodPassword#3')).ok, false);
  });

  await t.test('a hand-inserted plaintext row is rejected with a clear server-side reason, and the repair script fixes it', async () => {
    const email = `${tag}-hand@example.test`;
    await mkUser(email, 'plain-pass-1');
    const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
    try { assert.equal((await signIn(email, 'plain-pass-1')).ok, false); } finally { console.log = orig; }
    assert.ok(logs.some((l) => l.includes(email) && l.includes('not a scrypt hash')), 'reason is logged');
    execFileSync('node', ['scripts/set-password.js', email], { env: { ...process.env, NEW_PASSWORD: 'Repaired#Pass4' }, stdio: 'pipe' });
    assert.equal((await signIn(email, 'plain-pass-1')).ok, false);
    assert.equal((await signIn(email, 'Repaired#Pass4')).ok, true);
  });

  await t.test('session and OTP lifetimes come from the database clock, not the Node/DB timezone gap', async () => {
    const email = `${tag}-b@example.test`;
    const id = await mkUser(email, await auth.hashPassword('GoodPassword#3'));
    await signIn(email, 'GoodPassword#3', true);
    await signIn(email, 'GoodPassword#3', false);
    const [rows] = await pool.query('SELECT TIMESTAMPDIFF(MINUTE, NOW(), expires_at) m FROM app_sessions WHERE user_id=? ORDER BY created_at,expires_at', [id]);
    const mins = rows.map((r) => Number(r.m)).sort((a, b) => a - b);
    assert.ok(mins[0] >= 24 * 60 - 2 && mins[0] <= 24 * 60, `temporary session ~24h, got ${mins[0]}`);
    assert.ok(mins[1] >= 30 * 24 * 60 - 2 && mins[1] <= 30 * 24 * 60, `remembered session ~30 days, got ${mins[1]}`);

    const reg = `${tag}-new@example.test`; emails.push(reg);
    assert.equal((await auth.requestRegistrationOtp({ name: 'N', email: reg, password: 'GoodPassword#3' })).ok, true);
    const [[o]] = await pool.query('SELECT TIMESTAMPDIFF(SECOND, NOW(), expires_at) s FROM auth_otps WHERE email=?', [reg]);
    assert.ok(o.s > 590 && o.s <= 600, `OTP valid ~10 minutes, got ${o.s}s`);
    assert.equal((await auth.requestRegistrationOtp({ name: 'N', email: reg, password: 'GoodPassword#3' })).ok, false, 'resend cooldown');
  });
});
