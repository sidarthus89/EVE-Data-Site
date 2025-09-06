-- Enhanced Locations Schema for EVE-Data-Site
-- This replaces the static locations.json with a dynamic database-driven approach

-- Drop existing tables if they exist (be careful in production!)
IF OBJECT_ID('esi_update_log', 'U') IS NOT NULL DROP TABLE esi_update_log;
IF OBJECT_ID('locations', 'U') IS NOT NULL DROP TABLE locations;

-- Enhanced locations table
CREATE TABLE locations
(
    location_id BIGINT PRIMARY KEY,
    location_name NVARCHAR(255) NOT NULL,
    location_type NVARCHAR(50) NOT NULL,
    -- 'station', 'structure', 'system', 'region', 'constellation'
    region_id INT,
    region_name NVARCHAR(255),
    constellation_id INT,
    constellation_name NVARCHAR(255),
    system_id INT,
    system_name NVARCHAR(255),
    security_status DECIMAL(4,3),
    -- EVE security goes from -1.000 to 1.000
    is_npc BIT DEFAULT 0,
    structure_type_id INT,
    -- For player structures (citadels, refineries, etc.)
    corporation_id BIGINT,
    -- Owner corporation for player structures
    alliance_id BIGINT,
    -- Owner alliance for player structures
    last_updated DATETIME2 DEFAULT GETDATE(),
    is_active BIT DEFAULT 1,
    -- Additional metadata
    x_coordinate FLOAT,
    y_coordinate FLOAT,
    z_coordinate FLOAT,
    -- Indexing for performance
    -- indexes created separately below
);

-- ESI update tracking
CREATE TABLE esi_update_log
(
    id INT IDENTITY(1,1) PRIMARY KEY,
    update_type NVARCHAR(100) NOT NULL,
    -- 'regions', 'systems', 'stations', 'structures', 'full_sync'
    started_at DATETIME2 DEFAULT GETDATE(),
    completed_at DATETIME2,
    records_processed INT DEFAULT 0,
    records_added INT DEFAULT 0,
    records_updated INT DEFAULT 0,
    records_deactivated INT DEFAULT 0,
    errors_count INT DEFAULT 0,
    error_details NVARCHAR(MAX),
    status NVARCHAR(50) DEFAULT 'running',
    -- 'running', 'completed', 'failed', 'cancelled'
    esi_version NVARCHAR(20) DEFAULT 'latest',
    -- Performance tracking
    duration_seconds INT,
    -- indexes created separately below
);

-- Regions reference table (for faster lookups)
CREATE TABLE regions
(
    region_id INT PRIMARY KEY,
    region_name NVARCHAR(255) NOT NULL UNIQUE,
    description NVARCHAR(MAX),
    last_updated DATETIME2 DEFAULT GETDATE(),
    -- indexes created separately below
);

-- Systems reference table (for faster lookups)
CREATE TABLE systems
(
    system_id INT PRIMARY KEY,
    system_name NVARCHAR(255) NOT NULL,
    region_id INT NOT NULL,
    constellation_id INT,
    security_status DECIMAL(4,3),
    security_class NVARCHAR(20),
    -- 'highsec', 'lowsec', 'nullsec', 'wormhole'
    last_updated DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (region_id) REFERENCES regions(region_id)
);

-- Create indexes for locations
CREATE INDEX IX_locations_region ON locations (region_id, is_active);
CREATE INDEX IX_locations_system ON locations (system_id, is_active);
CREATE INDEX IX_locations_type ON locations (location_type, is_active);
CREATE INDEX IX_locations_updated ON locations (last_updated);
CREATE INDEX IX_locations_name ON locations (location_name);

-- Create indexes for esi_update_log
CREATE INDEX IX_esi_log_type_status ON esi_update_log (update_type, status);
CREATE INDEX IX_esi_log_started ON esi_update_log (started_at);

-- Create indexes for regions
CREATE INDEX IX_regions_name ON regions (region_name);

-- Create indexes for systems
CREATE INDEX IX_systems_region ON systems (region_id);
CREATE INDEX IX_systems_security ON systems (security_status);
CREATE INDEX IX_systems_name ON systems (system_name);

GO

-- Market-accessible structures cache
IF OBJECT_ID('market_structure_cache', 'U') IS NULL
CREATE TABLE market_structure_cache
(
    structure_id BIGINT PRIMARY KEY,
    last_checked DATETIME2 DEFAULT GETDATE(),
    last_ok BIT,
    last_status_code INT,
    etag NVARCHAR(200)
);

GO

-- Create views for common queries
CREATE OR ALTER VIEW v_active_stations
AS
    SELECT
        l.location_id,
        l.location_name AS name,
        l.location_type AS type,
        l.region_id,
        l.region_name,
        l.system_id,
        l.system_name,
        l.security_status AS security,
        l.is_npc AS isNPC,
        l.structure_type_id,
        l.corporation_id,
        l.alliance_id,
        CASE 
        WHEN l.security_status >= 0.5 THEN 'highsec'
        WHEN l.security_status > 0.0 THEN 'lowsec'
        WHEN l.security_status <= 0.0 THEN 'nullsec'
        ELSE 'unknown'
    END AS security_class
    FROM locations l
    WHERE l.is_active = 1
        AND l.location_type IN ('station', 'structure');
GO

CREATE OR ALTER VIEW v_market_order_locations
AS
    SELECT
        mo.order_id,
        mo.type_id,
        mo.region_id,
        mo.location_id,
        mo.system_id,
        mo.station_id,
        mo.price,
        mo.volume_total,
        mo.volume_remain,
        mo.min_volume,
        mo.is_buy_order,
        mo.duration,
        mo.issued,
        mo.range,
        loc.name,
        loc.region_name,
        loc.security,
        loc.type,
        loc.isNPC
    FROM market_orders mo
        LEFT JOIN v_active_stations loc ON mo.location_id = loc.location_id;
GO

CREATE INDEX IX_locations_location_id ON locations (location_id);
GO


CREATE VIEW v_region_summary
AS
    SELECT
        r.region_id,
        r.region_name,
        COUNT(CASE WHEN l.location_type = 'station' AND l.is_npc = 1 THEN 1 END) as npc_stations,
        COUNT(CASE WHEN l.location_type = 'structure' AND l.is_npc = 0 THEN 1 END) as player_structures,
        COUNT(CASE WHEN l.location_type = 'system' THEN 1 END) as systems,
        MIN(s.security_status) as min_security,
        MAX(s.security_status) as max_security,
        COUNT(CASE WHEN s.security_status >= 0.5 THEN 1 END) as highsec_systems,
        COUNT(CASE WHEN s.security_status > 0.0 AND s.security_status < 0.5 THEN 1 END) as lowsec_systems,
        COUNT(CASE WHEN s.security_status <= 0.0 THEN 1 END) as nullsec_systems
    FROM regions r
        LEFT JOIN systems s ON r.region_id = s.region_id
        LEFT JOIN locations l ON r.region_id = l.region_id AND l.is_active = 1
    GROUP BY r.region_id, r.region_name;
GO

-- Insert initial data from existing regions (you'll need to populate this)
-- This will be populated by the ESI sync function

-- Example stored procedures for common operations
GO
CREATE PROCEDURE sp_upsert_location
    @location_id BIGINT,
    @location_name NVARCHAR(255),
    @location_type NVARCHAR(50),
    @region_id INT = NULL,
    @region_name NVARCHAR(255) = NULL,
    @constellation_id INT = NULL,
    @constellation_name NVARCHAR(255) = NULL,
    @system_id INT = NULL,
    @system_name NVARCHAR(255) = NULL,
    @security_status DECIMAL(4,3) = NULL,
    @is_npc BIT = 0,
    @structure_type_id INT = NULL,
    @corporation_id BIGINT = NULL,
    @alliance_id BIGINT = NULL,
    @x_coordinate FLOAT = NULL,
    @y_coordinate FLOAT = NULL,
    @z_coordinate FLOAT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    MERGE locations AS target
    USING (SELECT
        @location_id as location_id,
        @location_name as location_name,
        @location_type as location_type,
        @region_id as region_id,
        @region_name as region_name,
        @constellation_id as constellation_id,
        @constellation_name as constellation_name,
        @system_id as system_id,
        @system_name as system_name,
        @security_status as security_status,
        @is_npc as is_npc,
        @structure_type_id as structure_type_id,
        @corporation_id as corporation_id,
        @alliance_id as alliance_id,
        @x_coordinate as x_coordinate,
        @y_coordinate as y_coordinate,
        @z_coordinate as z_coordinate
    ) AS source ON target.location_id = source.location_id
    
    WHEN MATCHED THEN
        UPDATE SET
            location_name = source.location_name,
            region_id = COALESCE(source.region_id, target.region_id),
            region_name = COALESCE(source.region_name, target.region_name),
            constellation_id = COALESCE(source.constellation_id, target.constellation_id),
            constellation_name = COALESCE(source.constellation_name, target.constellation_name),
            system_id = COALESCE(source.system_id, target.system_id),
            system_name = COALESCE(source.system_name, target.system_name),
            security_status = COALESCE(source.security_status, target.security_status),
            structure_type_id = COALESCE(source.structure_type_id, target.structure_type_id),
            corporation_id = COALESCE(source.corporation_id, target.corporation_id),
            alliance_id = COALESCE(source.alliance_id, target.alliance_id),
            x_coordinate = COALESCE(source.x_coordinate, target.x_coordinate),
            y_coordinate = COALESCE(source.y_coordinate, target.y_coordinate),
            z_coordinate = COALESCE(source.z_coordinate, target.z_coordinate),
            last_updated = GETDATE(),
            is_active = 1
    
    WHEN NOT MATCHED THEN
        INSERT (location_id, location_name, location_type, region_id, region_name, 
                constellation_id, constellation_name, system_id, system_name, security_status, 
                is_npc, structure_type_id, corporation_id, alliance_id, 
                x_coordinate, y_coordinate, z_coordinate, last_updated, is_active)
        VALUES (source.location_id, source.location_name, source.location_type, 
                source.region_id, source.region_name, source.constellation_id, source.constellation_name,
                source.system_id, source.system_name, source.security_status, 
                source.is_npc, source.structure_type_id, source.corporation_id, source.alliance_id,
                source.x_coordinate, source.y_coordinate, source.z_coordinate, GETDATE(), 1);
END;
GO

-- Grant permissions (adjust as needed for your Azure SQL setup)
-- GRANT SELECT, INSERT, UPDATE ON locations TO [your-azure-function-user];
-- GRANT SELECT, INSERT, UPDATE ON esi_update_log TO [your-azure-function-user];
-- GRANT SELECT ON v_active_stations TO [your-azure-function-user];
-- GRANT SELECT ON v_region_summary TO [your-azure-function-user];
