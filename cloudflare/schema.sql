CREATE TABLE IF NOT EXISTS brief_settings (name TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS brief_limits (bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS brief_limits_expiry ON brief_limits(expires_at);
CREATE TABLE IF NOT EXISTS brief_challenges (token_hash TEXT PRIMARY KEY,ip_hash TEXT NOT NULL,issued_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS brief_challenges_expiry ON brief_challenges(expires_at);
CREATE TABLE IF NOT EXISTS brief_submissions (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, intent_hash TEXT NOT NULL,
 submitted_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewing','reviewed','archived')),
 schema_version INTEGER NOT NULL DEFAULT 1, brand TEXT NOT NULL, contact_name TEXT NOT NULL,
 phone TEXT, email TEXT, answers_json TEXT NOT NULL CHECK(json_valid(answers_json)),
 token_hash TEXT NOT NULL UNIQUE, ip_bucket TEXT NOT NULL, day_bucket TEXT NOT NULL, bucket_expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS briefs_status_date ON brief_submissions(status,submitted_at);
CREATE TRIGGER IF NOT EXISTS brief_accept_limit BEFORE INSERT ON brief_submissions
BEGIN
 SELECT CASE WHEN (SELECT count FROM brief_limits WHERE bucket=NEW.ip_bucket)>=5 OR (SELECT count FROM brief_limits WHERE bucket=NEW.day_bucket)>=100 THEN RAISE(ABORT,'BRIEF_RATE_LIMIT') END;
END;
CREATE TRIGGER IF NOT EXISTS brief_accept_count AFTER INSERT ON brief_submissions
BEGIN
 INSERT INTO brief_limits(bucket,count,expires_at) VALUES(NEW.ip_bucket,1,NEW.bucket_expires_at) ON CONFLICT(bucket) DO UPDATE SET count=count+1;
 INSERT INTO brief_limits(bucket,count,expires_at) VALUES(NEW.day_bucket,1,NEW.bucket_expires_at) ON CONFLICT(bucket) DO UPDATE SET count=count+1;
END;
