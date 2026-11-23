ALTER TABLE profiles ADD COLUMN write_paused INTEGER NOT NULL DEFAULT 0 CHECK(write_paused IN (0, 1));
ALTER TABLE profiles ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0 CHECK(ignored IN (0, 1));
UPDATE profiles SET ignored = 1 WHERE pairing_state = 'revoked';
CREATE INDEX IF NOT EXISTS idx_profiles_instance_id ON profiles(instance_id);
