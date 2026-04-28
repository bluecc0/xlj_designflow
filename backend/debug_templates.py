import os, sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, '.')
from dotenv import load_dotenv
load_dotenv('../.env')

from penpot_client import PenpotClient

client = PenpotClient(
    base_url=os.environ['PENPOT_BASE_URL'],
    access_token=os.environ['PENPOT_ACCESS_TOKEN'],
)
fid = os.environ['PENPOT_FILE_ID']
f = client.get_file(fid)
print('Main file name:', f.get('name') or f.get('~:name'))
print('Main file project-id:', f.get('project-id') or f.get('~:project-id'))

teams = client._rpc('get-teams') or []
print(f'Teams: {len(teams)}')
for t in teams:
    tid = t.get('id') or t.get('~:id', '')
    tname = t.get('name') or t.get('~:name', '')
    projs = client.get_team_projects(tid) or []
    for p in projs:
        pid = p.get('id') or p.get('~:id', '')
        pname = p.get('name') or p.get('~:name', '')
        marker = ' <== HAS 模板' if '模板' in pname else ''
        print(f'  [{tname}] project: {pname!r}{marker}')
        if '模板' in pname:
            files = client.get_project_files(pid) or []
            for pf in files:
                pfname = pf.get('name') or pf.get('~:name', '')
                pfid = pf.get('id') or pf.get('~:id', '')
                has_marker = '模板' in pfname
                print(f'    file: {pfname!r}  matches={has_marker}')
                if has_marker:
                    try:
                        fdata = client.get_file(pfid)
                        frames = client.parse_frames(fdata)
                        print(f'      -> frames: {len(frames)}')
                        for fr in frames[:3]:
                            print(f'         {fr.get("name")!r}')
                    except Exception as e:
                        print(f'      -> ERROR: {e}')
