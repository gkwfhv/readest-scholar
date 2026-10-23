#!/usr/bin/env python3
"""Exercise the isolated Scholar Web vault with two synthetic staging accounts."""

import http.client
import json
import os
from pathlib import Path
from urllib.parse import quote


def request(port, method, path, body=None, headers=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=20)
    try:
        payload = None if body is None else json.dumps(body).encode()
        all_headers = dict(headers or {})
        if payload is not None:
            all_headers['Content-Type'] = 'application/json'
        connection.request(method, path, body=payload, headers=all_headers)
        response = connection.getresponse()
        return response.status, response.read(), dict(response.getheaders())
    finally:
        connection.close()


def expect_status(actual, expected, action):
    if actual != expected:
        raise RuntimeError(f'{action}: HTTP {actual}, expected {expected}')


def main():
    env_file = Path(os.environ['SCHOLAR_STAGING_ENV_FILE'])
    values = dict(line.split('=', 1) for line in env_file.read_text().splitlines()
                  if '=' in line and not line.startswith('#'))
    primary = json.loads(Path(os.environ['SCHOLAR_VAULT_PRIMARY_ACCOUNT']).read_text())
    other = json.loads(Path(os.environ['SCHOLAR_VAULT_OTHER_ACCOUNT']).read_text())
    api_port = int(values['SCHOLAR_API_PORT'])
    web_port = int(os.environ.get('SCHOLAR_VAULT_WEB_PORT', '3157'))
    route = '/api/scholar/ai/credentials'
    kind = 'openrouterApiKey'

    def login(account):
        status, payload, _ = request(
            api_port, 'POST', '/auth/v1/token?grant_type=password',
            {'email': account['email'], 'password': account['password']},
            {'apikey': values['ANON_KEY']},
        )
        expect_status(status, 200, 'synthetic login')
        result = json.loads(payload)
        if result.get('user', {}).get('id') != account['user_id']:
            raise RuntimeError('synthetic account identity changed')
        return {'Authorization': 'Bearer ' + result['access_token']}

    a = login(primary)
    b = login(other)
    expect_status(request(web_port, 'GET', route)[0], 403, 'anonymous vault read')
    for headers in (a, b):
        status, payload, response_headers = request(web_port, 'GET', route, headers=headers)
        expect_status(status, 200, 'initial vault read')
        if json.loads(payload) != {}:
            raise RuntimeError('synthetic account vault was not initially empty')
        if response_headers.get('Cache-Control') != 'no-store':
            raise RuntimeError('vault response is cacheable')

    marker = 'synthetic-vault-probe-' + os.urandom(8).hex()
    saved = False
    try:
        status, _, _ = request(web_port, 'PUT', route, {'kind': kind, 'value': marker}, a)
        expect_status(status, 200, 'owner vault write')
        saved = True
        status, payload, _ = request(web_port, 'GET', route, headers=a)
        expect_status(status, 200, 'owner vault read')
        if json.loads(payload) != {kind: marker}:
            raise RuntimeError('owner vault round trip failed')
        status, payload, _ = request(web_port, 'GET', route, headers=b)
        expect_status(status, 200, 'other account vault read')
        if json.loads(payload) != {}:
            raise RuntimeError('cross-account vault read succeeded')

        admin = {'apikey': values['SERVICE_ROLE_KEY'],
                 'Authorization': 'Bearer ' + values['SERVICE_ROLE_KEY']}
        path = ('/rest/v1/scholar_ai_credentials?select=nonce,ciphertext,auth_tag'
                '&user_id=eq.' + quote(primary['user_id'], safe=''))
        status, payload, _ = request(api_port, 'GET', path, headers=admin)
        expect_status(status, 200, 'ciphertext table read')
        rows = json.loads(payload)
        if len(rows) != 1 or marker in payload.decode():
            raise RuntimeError('vault row is absent or contains plaintext')

        status, _, headers = request(web_port, 'GET', route, headers={
            **a, 'Origin': 'http://tauri.localhost',
        })
        expect_status(status, 200, 'cross-origin response probe')
        if 'Access-Control-Allow-Origin' in headers:
            raise RuntimeError('vault response grants cross-origin access')
        print('Two-account vault, ciphertext, no-store and CORS probes: OK')
    finally:
        if saved:
            status, _, _ = request(web_port, 'PUT', route, {'kind': kind, 'value': ''}, a)
            expect_status(status, 200, 'vault probe cleanup')


if __name__ == '__main__':
    main()
