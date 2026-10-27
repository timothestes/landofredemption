import { describe, it, expect } from 'vitest';
import { canScan } from '../gate';
const no = async () => false, yes = async () => true;
const env = (e: Record<string, string>) => e as NodeJS.ProcessEnv;
describe('canScan', () => {
  it('superuser always', async () => expect(await canScan('u1', { isSuperuser: yes, env: env({}) })).toBe(true));
  it('allowlist by id', async () => { expect(await canScan('u1', { isSuperuser: no, env: env({ SCANNER_ALLOWLIST: 'u0, u1' }) })).toBe(true); expect(await canScan('u2', { isSuperuser: no, env: env({ SCANNER_ALLOWLIST: 'u0, u1' }) })).toBe(false); });
  it('open flag', async () => expect(await canScan('anyone', { isSuperuser: no, env: env({ SCANNER_OPEN: '1' }) })).toBe(true));
  it('closed by default', async () => expect(await canScan('anyone', { isSuperuser: no, env: env({}) })).toBe(false));
});
