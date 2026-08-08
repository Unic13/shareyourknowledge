-- ==========================================
-- 1. ADMIN USERS
-- ==========================================
CREATE TABLE admin_users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) DEFAULT 'editor',   -- super_admin, admin, editor
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 2. SUBJECT CONTENT
-- ==========================================
CREATE TABLE subject_content (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    subject VARCHAR(200) NOT NULL,
    color VARCHAR(20) DEFAULT '#6C3FF5',
    data JSONB NOT NULL,
    created_by BIGINT REFERENCES admin_users(id),
    updated_by BIGINT REFERENCES admin_users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subject_content_data
ON subject_content
USING GIN(data);

-- ==========================================
-- 3. ADMIN <-> SUBJECT PERMISSION
-- ==========================================
CREATE TABLE admin_subjects (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id BIGINT NOT NULL
        REFERENCES admin_users(id)
        ON DELETE CASCADE,
    subject_id BIGINT NOT NULL
        REFERENCES subject_content(id)
        ON DELETE CASCADE,
    can_edit BOOLEAN DEFAULT TRUE,
    can_publish BOOLEAN DEFAULT FALSE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(admin_id, subject_id)
);

-- ==========================================
-- 4. UPDATE HISTORY / AUDIT LOG
-- ==========================================
CREATE TABLE subject_update_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject_id BIGINT NOT NULL
        REFERENCES subject_content(id)
        ON DELETE CASCADE,
    admin_id BIGINT
        REFERENCES admin_users(id),
    action VARCHAR(30) NOT NULL,   -- CREATE / UPDATE / DELETE / PUBLISH
    message TEXT,
    old_data JSONB,
    new_data JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
