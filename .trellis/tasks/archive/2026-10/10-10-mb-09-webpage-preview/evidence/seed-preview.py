
import json, sqlite3, sys
db, port = sys.argv[1], sys.argv[2]
base = "http://127.0.0.1:" + port

def node(chrome, parent, position, kind, title, url, folder):
    payload = {
        "chromeId": chrome, "parentId": parent, "position": position, "kind": kind,
        "title": title, "url": url, "folderType": folder, "unmodifiable": None,
        "dateAdded": None, "dateLastUsed": None,
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

profiles = [
    ("pa09", "ia09", "资料 A", "chrome-extension://" + ("a" * 32), "sa09", [
        ("1", None, 0, "folder", "书签栏", None, "bookmarks-bar"),
        ("10", "1", 0, "bookmark", "探针 A", base + "/a", None),
        ("11", "1", 1, "bookmark", "打不开的网页", "http://127.0.0.1:1/mb09-fail", None),
        ("12", "1", 2, "bookmark", "脚本链接", "javascript:void(0)", None),
    ]),
    ("pb09", "ib09", "资料 B", "chrome-extension://" + ("b" * 32), "sb09", [
        ("1", None, 0, "folder", "书签栏", None, "bookmarks-bar"),
        ("10", "1", 0, "bookmark", "探针 B", base + "/b", None),
    ]),
]
con = sqlite3.connect(db, timeout=5)
row = con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'").fetchone()
if row is None:
    raise SystemExit("NO_SCHEMA")
con.execute("DELETE FROM bookmark_tags")
con.execute("DELETE FROM bookmark_metadata")
con.execute("DELETE FROM source_cursors")
con.execute("DELETE FROM bookmarks_cache")
con.execute("DELETE FROM profiles")
for pid, iid, name, origin, sid, nodes in profiles:
    con.execute("INSERT INTO profiles(id,instance_id,source_epoch,display_name,pairing_state,last_synced_at,paired_origin,credential_reference) VALUES(?,?,1,?,'paired',NULL,?,NULL)", (pid, iid, name, origin))
    con.execute("INSERT INTO source_cursors(profile_id,source_epoch,session_id,last_seq,revision) VALUES(?,1,?,1,1)", (pid, sid))
    for chrome, parent, pos, kind, title, url, folder in nodes:
        con.execute("INSERT INTO bookmarks_cache(profile_id,source_epoch,chrome_id,parent_id,position,node_kind,title,url,folder_type,unmodifiable,node_json,revision,deleted_at) VALUES(?,1,?,?,?,?,?,?,?,NULL,?,1,NULL)", (pid, chrome, parent, pos, kind, title, url, folder, node(chrome, parent, pos, kind, title, url, folder)))
con.commit()
con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
print("SEED_OK")
