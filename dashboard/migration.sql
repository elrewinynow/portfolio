-- Additive only. Customer answers, request intents and existing submission IDs stay unchanged.
CREATE TABLE IF NOT EXISTS dashboard_auth_challenges (id TEXT PRIMARY KEY,challenge TEXT NOT NULL,purpose TEXT NOT NULL CHECK(purpose IN ('registration','authentication')),expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0,1)),setup_hash TEXT);
CREATE INDEX IF NOT EXISTS dashboard_challenges_expiry ON dashboard_auth_challenges(expires_at);
CREATE TABLE IF NOT EXISTS dashboard_credentials (id TEXT PRIMARY KEY,owner_email TEXT NOT NULL UNIQUE,user_handle TEXT NOT NULL,public_key BLOB NOT NULL,counter INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),registration_flow TEXT NOT NULL UNIQUE REFERENCES dashboard_auth_challenges(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dashboard_sessions (token_hash TEXT PRIMARY KEY,credential_id TEXT NOT NULL REFERENCES dashboard_credentials(id),flow_id TEXT NOT NULL UNIQUE REFERENCES dashboard_auth_challenges(id),expires_at INTEGER NOT NULL,new_counter INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS dashboard_sessions_expiry ON dashboard_sessions(expires_at);
CREATE TABLE IF NOT EXISTS dashboard_auth_limits (bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS dashboard_auth_events (id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,credential_id TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS dashboard_register AFTER INSERT ON dashboard_credentials BEGIN UPDATE dashboard_auth_challenges SET used=1 WHERE id=NEW.registration_flow; INSERT INTO dashboard_auth_events(event,credential_id,created_at) VALUES('registered',NEW.id,NEW.created_at); END;
CREATE TRIGGER IF NOT EXISTS dashboard_session_open AFTER INSERT ON dashboard_sessions BEGIN UPDATE dashboard_auth_challenges SET used=1 WHERE id=NEW.flow_id; UPDATE dashboard_credentials SET counter=NEW.new_counter WHERE id=NEW.credential_id; INSERT INTO dashboard_auth_events(event,credential_id,created_at) VALUES('signed_in',NEW.credential_id,NEW.created_at); END;
CREATE TRIGGER IF NOT EXISTS dashboard_session_close AFTER DELETE ON dashboard_sessions BEGIN INSERT INTO dashboard_auth_events(event,credential_id,created_at) VALUES('session_closed',OLD.credential_id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TABLE IF NOT EXISTS brief_reviews (
 brief_id TEXT PRIMARY KEY REFERENCES brief_submissions(id),
 notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL CHECK(version>=1),
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brief_review_commands (
 request_key TEXT PRIMARY KEY, intent_hash TEXT NOT NULL,
 brief_id TEXT NOT NULL REFERENCES brief_submissions(id),
 actor_email TEXT NOT NULL, actor_sub TEXT NOT NULL,
 expected_version INTEGER NOT NULL CHECK(expected_version>=0),
 result_version INTEGER NOT NULL CHECK(result_version=expected_version+1),
 before_status TEXT NOT NULL, after_status TEXT NOT NULL CHECK(after_status IN ('new','reviewing','reviewed','archived')),
 notes TEXT NOT NULL CHECK(length(notes)<=8000), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS brief_review_history ON brief_review_commands(brief_id,created_at);
CREATE TRIGGER IF NOT EXISTS brief_review_command_immutable_update BEFORE UPDATE ON brief_review_commands
BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_REVIEW_HISTORY'); END;
CREATE TRIGGER IF NOT EXISTS brief_review_command_immutable_delete BEFORE DELETE ON brief_review_commands
BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_REVIEW_HISTORY'); END;
CREATE TRIGGER IF NOT EXISTS brief_review_apply AFTER INSERT ON brief_review_commands
BEGIN
 INSERT INTO brief_reviews(brief_id,notes,version,updated_at,updated_by)
 VALUES(NEW.brief_id,NEW.notes,NEW.result_version,NEW.created_at,NEW.actor_email)
 ON CONFLICT(brief_id) DO UPDATE SET notes=excluded.notes,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
 UPDATE brief_submissions SET status=NEW.after_status WHERE id=NEW.brief_id;
END;
