-- These two tables are referenced by api/data.js (registrations, attempts,
-- and the stats aggregation) but weren't part of the schema.sql you pasted
-- (only admin_users / subject_content / admin_subjects /
-- subject_update_logs were included). Below is a reasonable shape. If you
-- already have equivalent tables with different names/columns, just edit
-- the GraphQL query strings at the top of api/data.js instead of creating
-- these — and remember to track whichever tables you use in Hasura.

CREATE TABLE IF NOT EXISTS registrations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(200),
    email VARCHAR(255),
    phone VARCHAR(30),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attempts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_email VARCHAR(255),
    subject VARCHAR(20) NOT NULL,       -- matches subject_content.code, e.g. 'SQL'
    chapter_id VARCHAR(100),
    chapter_title VARCHAR(255),
    question_id VARCHAR(100),
    is_correct BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attempts_subject ON attempts(subject);
CREATE INDEX IF NOT EXISTS idx_attempts_created_at ON attempts(created_at);

-- Referenced by api/feedback.js. Also not in your original schema.sql —
-- adjust column names/types here (and in api/feedback.js) if you already
-- have an equivalent table.
CREATE TABLE IF NOT EXISTS feedback (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id VARCHAR(255) DEFAULT 'guest',
    subject VARCHAR(20),                -- nullable: general app feedback vs subject-specific
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_subject ON feedback(subject);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at);
