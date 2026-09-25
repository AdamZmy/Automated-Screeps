#!/usr/bin/env python3
"""Configure the authorized Vercel project; never print or pass secrets as argv."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT.parent / 'dashboard'
sys.path.insert(0, str(ROOT))
from screeps_api import read_token, DEFAULT_TOKEN_FILE

EXPECTED = {'projectId': 'prj_cuwCiWWaf5RBdphW5cUTxReWNRhY',
            'orgId': 'team_es8bpWb8MWLmsGuuBTPTk6TR'}

def main():
    project = json.loads((DASHBOARD / '.vercel/project.json').read_text())
    if any(project.get(k) != v for k, v in EXPECTED.items()):
        raise RuntimeError('Unexpected Vercel project; no credential read or upload performed.')
    cli = ['npx', '--yes', 'vercel@60.0.1']
    check = subprocess.run(cli + ['whoami'], cwd=DASHBOARD, capture_output=True, text=True)
    if check.returncode or check.stdout.strip() != 'zhangmingyuadam-5614':
        raise RuntimeError('Vercel CLI must be logged into the verified project owner before configuring the secret.')
    if sys.argv[1:] != ['--apply']:
        print('Ready: sensitive production SCREEPS_TOKEN in verified screeps-energy-observatory project. Pass --apply to configure.')
        return
    token = read_token(DEFAULT_TOKEN_FILE)
    result = subprocess.run(cli + ['env', 'add', 'SCREEPS_TOKEN', 'production', '--sensitive', '--yes', '--force'],
                            cwd=DASHBOARD, input=token, capture_output=True, text=True)
    print((result.stdout + result.stderr).replace(token, '[REDACTED]').strip())
    if result.returncode:
        raise RuntimeError('Vercel environment configuration did not succeed; no deployment was attempted.')
    print('Sensitive production secret configured; redeploy production to activate it.')

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Avoid raw exception bodies, which could include process inputs.
        print('Dashboard configuration stopped. Check CLI login and the verified project link.', file=sys.stderr)
        sys.exit(1)
