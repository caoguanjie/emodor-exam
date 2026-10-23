-- 018_mobile_auth: canonical unique phone identities and client-aware durable sessions.
-- The runner's read-only preflight rejects invalid/duplicate normalized phones before any write.

-- @step normalize_phone
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM sys_user WHERE phone IS NOT NULL AND (phone = '' OR phone REGEXP '[[:space:]-]')) = 0 THEN 1 ELSE 0 END AS complete;
UPDATE sys_user SET phone = NULLIF(REGEXP_REPLACE(phone, '[[:space:]-]', ''), '') WHERE phone IS NOT NULL;

-- @step unique_phone
-- @check SELECT CASE WHEN (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sys_user' AND INDEX_NAME='uk_sys_user_phone')=1 AND (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sys_user' AND INDEX_NAME='uk_sys_user_phone' AND NON_UNIQUE=0 AND COLUMN_NAME='phone' AND SEQ_IN_INDEX=1)=1 THEN 1 ELSE 0 END AS complete;
CREATE UNIQUE INDEX uk_sys_user_phone ON sys_user (phone);

-- @step session_client
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='auth_session' AND COLUMN_NAME='client' AND DATA_TYPE='varchar' AND COLUMN_TYPE='varchar(16)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='pc') THEN 1 ELSE 0 END AS complete;
ALTER TABLE auth_session ADD COLUMN client VARCHAR(16) NOT NULL DEFAULT 'pc' AFTER user_id;

-- @step session_auth_method
-- @check SELECT CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='auth_session' AND COLUMN_NAME='auth_method' AND DATA_TYPE='varchar' AND COLUMN_TYPE='varchar(16)' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='password') THEN 1 ELSE 0 END AS complete;
ALTER TABLE auth_session ADD COLUMN auth_method VARCHAR(16) NOT NULL DEFAULT 'password' AFTER client;
