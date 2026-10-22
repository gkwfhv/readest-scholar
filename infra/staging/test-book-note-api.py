#!/usr/bin/env python3
"""Exercise note conflict ordering through a loopback Scholar Web candidate.

Uses a synthetic staging account. It deletes its unique probe row and history
on exit; run only against the isolated staging database and URLs.
"""

import argparse
import json
import pathlib
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--auth-file', type=pathlib.Path, required=True)
parser.add_argument('--runtime-env', type=pathlib.Path, required=True)
parser.add_argument('--candidate-url', default='http://127.0.0.1:3137')
parser.add_argument('--supabase-url', default='http://127.0.0.1:8130')
parser.add_argument('--db-container', default='scholar-staging-db')
parser.add_argument('--test-restore', action='store_true', help='also exercise the note restore RPC')
args = parser.parse_args()
for url in (args.candidate_url, args.supabase_url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost'):
        parser.error('probe URLs must use loopback HTTP')

account = json.loads(args.auth_file.read_text())
account_id = str(uuid.UUID(account['user_id']))
env = dict(
    line.split('=', 1)
    for line in args.runtime_env.read_text().splitlines()
    if '=' in line and not line.startswith('#')
)
key = env['SUPABASE_ANON_KEY']


def request(url, method='GET', body=None, token=None, single=False):
    headers = {'apikey': key, 'content-type': 'application/json'}
    if token:
        headers['authorization'] = 'Bearer ' + token
    if single:
        headers['Accept'] = 'application/vnd.pgrst.object+json'
    payload = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            f'{method} {urllib.parse.urlsplit(url).path} HTTP {exc.code}: '
            f'{exc.read()[:250]!r}'
        ) from exc


_, auth = request(
    args.supabase_url + '/auth/v1/token?grant_type=password',
    'POST',
    {'email': account['email'], 'password': account['password']},
)
token = auth['access_token']
book_hash = 'phase3-api-conflict-' + uuid.uuid4().hex
note_id = 'probe-note'
rest = args.supabase_url + '/rest/v1'
filter_query = urllib.parse.urlencode({
    'user_id': 'eq.' + account_id,
    'book_hash': 'eq.' + book_hash,
    'id': 'eq.' + note_id,
})
read_url = rest + '/book_notes?' + filter_query
history_url = rest + '/book_note_conflict_versions?' + urllib.parse.urlencode({
    'book_hash': 'eq.' + book_hash,
})


def push(text, updated, deleted=None):
    note = {
        'bookHash': book_hash,
        'id': note_id,
        'type': 'annotation',
        'note': text,
        'createdAt': updated,
        'updatedAt': updated,
        'deletedAt': deleted,
    }
    status, data = request(args.candidate_url + '/api/sync', 'POST', {'notes': [note]}, token)
    assert status == 200 and len(data['notes']) == 1, (status, data)
    return data['notes'][0]


def current():
    rows = request(read_url, token=token)[1]
    assert len(rows) == 1, len(rows)
    return rows[0]


def archive_count():
    return len(request(history_url, token=token)[1])


try:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    first_at = int(now.timestamp() * 1000)
    initial = push('live edit', first_at)
    assert push('live edit', first_at)['note'] == 'live edit'
    assert archive_count() == 0, 'identical initial retry created false history'
    server_at = datetime.fromisoformat(initial['updated_at'].replace('Z', '+00:00'))
    stale_at = int((server_at - timedelta(days=2)).timestamp() * 1000)
    stale_delete = int((server_at - timedelta(days=1)).timestamp() * 1000)
    late_delete = int((server_at + timedelta(days=1)).timestamp() * 1000)
    newer_edit = int((server_at + timedelta(days=2)).timestamp() * 1000)
    assert push('stale delete', stale_at, stale_delete)['note'] == 'live edit'
    assert current()['note'] == 'live edit' and archive_count() == 1
    assert push('stale delete', stale_at, stale_delete)['note'] == 'live edit'
    assert archive_count() == 1
    assert push('later delete', stale_at, late_delete)['deleted_at'] is not None
    assert current()['deleted_at'] is not None
    assert push('tied live edit', late_delete)['deleted_at'] is not None
    assert push('newer live edit', newer_edit)['note'] == 'newer live edit'
    assert current()['note'] == 'newer live edit' and current()['deleted_at'] is None
    assert archive_count() == 4
    if args.test_restore:
        versions = request(history_url, token=token)[1]
        prior = next(v for v in versions if v['source'] == 'previous'
                     and v['row_data']['note'] == 'live edit')
        reviewed = current()
        restore_request = {
            'p_user_id': account_id,
            'p_book_hash': book_hash,
            'p_note_id': note_id,
            'p_source': prior['source'],
            'p_version_hash': prior['version_hash'],
            'p_expected_current': reviewed,
        }
        restored = request(rest + '/rpc/restore_book_note_version_v1',
                           'POST', restore_request, token, single=True)[1]
        assert restored['note'] == 'live edit' and archive_count() == 5
        try:
            request(rest + '/rpc/restore_book_note_version_v1',
                    'POST', restore_request, token, single=True)
        except RuntimeError as exc:
            assert 'HTTP 409' in str(exc), str(exc)
        else:
            raise AssertionError('stale restore succeeded')
        print('note restore RPC passed: archived version restored; stale CAS rejected')
    print('note API fault probe passed: retry/stale/delete/tie/revive and four archived versions')
finally:
    sql = (
        "DELETE FROM public.book_note_conflict_versions "
        f"WHERE user_id='{account_id}' AND book_hash='{book_hash}'; "
        "DELETE FROM public.book_notes "
        f"WHERE user_id='{account_id}' AND book_hash='{book_hash}' AND id='{note_id}';"
    )
    subprocess.run(
        ['docker', 'exec', '-i', args.db_container, 'psql', '-q', '-v', 'ON_ERROR_STOP=1',
         '-U', 'supabase_admin', '-d', 'postgres'],
        input=sql, text=True, check=True, capture_output=True,
    )
