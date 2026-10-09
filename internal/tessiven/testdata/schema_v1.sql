-- Frozen schema from the first distributed Tessiven canvas library.
CREATE TABLE __redeven_db_meta (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  db_kind TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_at_unix_ms INTEGER NOT NULL DEFAULT 0,
  last_migrated_from_version INTEGER NOT NULL DEFAULT 0,
  last_migrated_to_version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO __redeven_db_meta VALUES (1, 'tessiven_canvas_library', 100, 100, 0, 1);
CREATE TABLE canvases (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, latest_version INTEGER NOT NULL CHECK(latest_version > 0), archived INTEGER NOT NULL CHECK(archived IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE versions (canvas_id TEXT NOT NULL REFERENCES canvases(id), number INTEGER NOT NULL CHECK(number > 0), document_yaml TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL, source TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(canvas_id,number));
CREATE TABLE requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL);
CREATE TRIGGER versions_immutable_update BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT, 'Tessiven versions are immutable'); END;
CREATE TRIGGER versions_immutable_delete BEFORE DELETE ON versions BEGIN SELECT RAISE(ABORT, 'Tessiven versions are immutable'); END;
PRAGMA user_version=1;
