-- Regions
CREATE TABLE IF NOT EXISTS regions (
    region_id INTEGER PRIMARY KEY,
    region_name TEXT
);

-- Systems
CREATE TABLE IF NOT EXISTS systems (
    system_id INTEGER PRIMARY KEY,
    system_name TEXT,
    constellation_id INTEGER,
    region_id INTEGER,
    security_status REAL,
    FOREIGN KEY (region_id) REFERENCES regions(region_id)
);

-- Stations
CREATE TABLE IF NOT EXISTS stations (
    station_id INTEGER PRIMARY KEY,
    station_name TEXT,
    type_id INTEGER,
    system_id INTEGER,
    region_id INTEGER,
    owner_id INTEGER,
    services TEXT,
    FOREIGN KEY (system_id) REFERENCES systems(system_id),
    FOREIGN KEY (region_id) REFERENCES regions(region_id)
);

-- Market Orders (raw ESI fields)
CREATE TABLE IF NOT EXISTS market_orders (
    order_id INTEGER PRIMARY KEY,
    type_id INTEGER,
    region_id INTEGER,
    location_id INTEGER,
    system_id INTEGER,
    station_id INTEGER,
    price REAL,
    volume_total INTEGER,
    volume_remain INTEGER,
    min_volume INTEGER,
    is_buy_order BOOLEAN,
    duration INTEGER,
    issued TIMESTAMP,
    range TEXT
);

-- Price History
CREATE TABLE IF NOT EXISTS price_history (
    region_id INTEGER,
    type_id INTEGER,
    date DATE,
    average REAL,
    highest REAL,
    lowest REAL,
    order_count INTEGER,
    volume BIGINT,
    PRIMARY KEY (region_id, type_id, date)
);

-- Aggregated Orders (lightweight summary per type/region)
CREATE TABLE IF NOT EXISTS aggregated_orders (
    region_id INTEGER,
    type_id INTEGER,
    min_sell REAL,
    max_buy REAL,
    avg_sell REAL,
    avg_buy REAL,
    PRIMARY KEY (region_id, type_id)
);

-- Market Metrics (optional analytics layer)
CREATE TABLE IF NOT EXISTS market_metrics (
    region_id INTEGER,
    type_id INTEGER,
    median_price REAL,
    avg_price REAL,
    total_volume BIGINT,
    total_isk_value REAL,
    last_updated TIMESTAMP,
    PRIMARY KEY (region_id, type_id)
);

-- Indexes for query speed
CREATE INDEX IF NOT EXISTS idx_orders_region_type ON market_orders(region_id, type_id);
CREATE INDEX IF NOT EXISTS idx_price_history_region_type_date ON price_history(region_id, type_id, date);
CREATE INDEX IF NOT EXISTS idx_aggregated_region_type ON aggregated_orders(region_id, type_id);
CREATE INDEX IF NOT EXISTS idx_metrics_region_type ON market_metrics(region_id, type_id);