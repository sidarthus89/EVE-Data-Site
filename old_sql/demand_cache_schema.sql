-- Additional tables for demand-driven caching

-- Cache metadata to track what data we have and when it was updated
CREATE TABLE IF NOT EXISTS cache_metadata (
    region_id INTEGER,
    type_id INTEGER,
    last_updated TIMESTAMP,
    last_requested TIMESTAMP,
    request_count INTEGER DEFAULT 1,
    is_popular BOOLEAN DEFAULT FALSE,
    data_age_minutes INTEGER DEFAULT 0,
    PRIMARY KEY (region_id, type_id)
);

-- Popular items tracking (for prioritizing background updates)
CREATE TABLE IF NOT EXISTS popular_items (
    type_id INTEGER,
    region_id INTEGER,
    total_requests INTEGER DEFAULT 0,
    recent_requests INTEGER DEFAULT 0, -- Requests in last 24 hours
    last_spike TIMESTAMP,
    priority_score REAL DEFAULT 0,
    PRIMARY KEY (type_id, region_id)
);

-- Request patterns (to understand user behavior)
CREATE TABLE IF NOT EXISTS request_patterns (
    pattern_id INTEGER PRIMARY KEY AUTOINCREMENT,
    type_id INTEGER,
    region_id INTEGER,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    response_time_ms INTEGER,
    cache_hit BOOLEAN DEFAULT FALSE,
    user_agent TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cache_metadata_updated ON cache_metadata(last_updated);
CREATE INDEX IF NOT EXISTS idx_cache_metadata_requested ON cache_metadata(last_requested);
CREATE INDEX IF NOT EXISTS idx_popular_items_score ON popular_items(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_request_patterns_time ON request_patterns(requested_at);
