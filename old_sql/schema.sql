-- SQL Server Schema

-- Regions
IF NOT EXISTS (SELECT *
FROM sysobjects
WHERE name='regions' AND xtype='U')
CREATE TABLE regions
(
    region_id INT PRIMARY KEY,
    region_name NVARCHAR(255)
);

-- Systems  
IF NOT EXISTS (SELECT *
FROM sysobjects
WHERE name='systems' AND xtype='U')
CREATE TABLE systems
(
    system_id INT PRIMARY KEY,
    system_name NVARCHAR(255),
    constellation_id INT,
    region_id INT,
    security_status FLOAT,
    FOREIGN KEY (region_id) REFERENCES regions(region_id)
);

-- Stations
IF NOT EXISTS (SELECT *
FROM sysobjects
WHERE name='stations' AND xtype='U')
CREATE TABLE stations
(
    station_id BIGINT PRIMARY KEY,
    station_name NVARCHAR(255),
    type_id INT,
    system_id INT,
    region_id INT,
    owner_id INT,
    services NVARCHAR(MAX),
    FOREIGN KEY (system_id) REFERENCES systems(system_id),
    FOREIGN KEY (region_id) REFERENCES regions(region_id)
);

-- Market Orders
IF NOT EXISTS (SELECT *
FROM sysobjects
WHERE name='market_orders' AND xtype='U')
CREATE TABLE market_orders
(
    order_id BIGINT PRIMARY KEY,
    type_id INT,
    region_id INT,
    location_id BIGINT,
    system_id INT,
    station_id BIGINT,
    price FLOAT,
    volume_total INT,
    volume_remain INT,
    min_volume INT,
    is_buy_order BIT,
    duration INT,
    issued DATETIME2,
    range NVARCHAR(50)
);

-- Price History
IF NOT EXISTS (SELECT *
FROM sysobjects
WHERE name='price_history' AND xtype='U')
CREATE TABLE price_history
(
    region_id INT NOT NULL,
    type_id INT NOT NULL,
    date DATE NOT NULL,
    average FLOAT,
    highest FLOAT,
    lowest FLOAT,
    order_count INT,
    volume BIGINT,
    PRIMARY KEY (region_id, type_id, date)
);

-- Aggregated Orders
IF NOT EXISTS (SELECT *
FROM sysobjects
WHERE name='aggregated_orders' AND xtype='U')
CREATE TABLE aggregated_orders
(
    region_id INT NOT NULL,
    type_id INT NOT NULL,
    min_sell FLOAT,
    max_buy FLOAT,
    avg_sell FLOAT,
    avg_buy FLOAT,
    PRIMARY KEY (region_id, type_id)
);

-- Market Metrics
IF NOT EXISTS (SELECT *
FROM sysobjects
WHERE name='market_metrics' AND xtype='U')
CREATE TABLE market_metrics
(
    region_id INT NOT NULL,
    type_id INT NOT NULL,
    median_price FLOAT,
    avg_price FLOAT,
    total_volume BIGINT,
    total_isk_value FLOAT,
    last_updated DATETIME2,
    PRIMARY KEY (region_id, type_id)
);

-- Indexes
IF NOT EXISTS (SELECT *
FROM sys.indexes
WHERE name='idx_orders_region_type')
CREATE INDEX idx_orders_region_type ON market_orders(region_id, type_id);

IF NOT EXISTS (SELECT *
FROM sys.indexes
WHERE name='idx_price_history_region_type_date')
CREATE INDEX idx_price_history_region_type_date ON price_history(region_id, type_id, date);

IF NOT EXISTS (SELECT *
FROM sys.indexes
WHERE name='idx_aggregated_region_type')
CREATE INDEX idx_aggregated_region_type ON aggregated_orders(region_id, type_id);

IF NOT EXISTS (SELECT *
FROM sys.indexes
WHERE name='idx_metrics_region_type')
CREATE INDEX idx_metrics_region_type ON market_metrics(region_id, type_id);