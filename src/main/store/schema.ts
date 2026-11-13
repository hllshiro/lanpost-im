export const SCHEMA_VERSION = 5

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  peer_key TEXT UNIQUE,
  title TEXT NOT NULL,
  avatar TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  draft TEXT NOT NULL DEFAULT '',
  last_message_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  remote_seq INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  nwt_id TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_messages_time ON messages(created_at);

CREATE TABLE IF NOT EXISTS qgroups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  announcement TEXT NOT NULL DEFAULT '',
  master TEXT NOT NULL DEFAULT '',
  info_version INTEGER NOT NULL DEFAULT 0,
  user_version INTEGER NOT NULL DEFAULT 0,
  allow_other_add INTEGER NOT NULL DEFAULT 0,
  photo_md5 TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS qgroup_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS file_tasks (
  id TEXT PRIMARY KEY,
  message_id INTEGER REFERENCES messages(id),
  conversation_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0,
  file_id TEXT NOT NULL DEFAULT '',
  packet_id INTEGER NOT NULL DEFAULT 0,
  path TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  received INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_tasks_conv ON file_tasks(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS peers (
  key TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  port INTEGER NOT NULL,
  user TEXT NOT NULL,
  host TEXT NOT NULL,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  corporation TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  sign TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 0,
  corp_id TEXT NOT NULL DEFAULT '',
  online INTEGER NOT NULL DEFAULT 0,
  ready INTEGER NOT NULL DEFAULT 0,
  alias TEXT NOT NULL DEFAULT '',
  last_seen INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS group_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  peer_key TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, peer_key)
);

-- 图片按 md5 缓存：同一张图再次收到时直接用本地文件，不再走文件通道
CREATE TABLE IF NOT EXISTS image_cache (
  md5 TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 对端头像：id 是对端公布的 USER_FACE 文件号，md5 指向本机缓存
CREATE TABLE IF NOT EXISTS peer_avatars (
  peer_key TEXT PRIMARY KEY,
  avatar_id INTEGER NOT NULL DEFAULT 0,
  avatar_md5 TEXT NOT NULL DEFAULT ''
);
`
