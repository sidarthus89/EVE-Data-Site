-- seed_npc_locations.sql
-- Script to seed the database with existing NPC station data from locations.json

-- First, ensure we have the schema
IF NOT EXISTS (SELECT *
FROM sys.tables
WHERE name = 'locations')
BEGIN
    PRINT 'Error: locations table does not exist. Please run locations_schema.sql first.'
    RETURN
END

-- Clear existing data (optional - remove if you want to preserve existing data)
-- DELETE FROM locations WHERE is_npc = 1;
-- DELETE FROM systems WHERE 1=1;
-- DELETE FROM regions WHERE 1=1;

-- Sample data based on common EVE regions and systems
-- This would normally be populated from your locations.json file

-- Insert major trade hub regions
INSERT INTO regions
    (region_id, region_name, description)
VALUES
    (10000002, 'The Forge', 'Home to Jita, the largest trade hub in New Eden'),
    (10000043, 'Domain', 'Amarr Empire heartland and major trade hub'),
    (10000032, 'Sinq Laison', 'Gallente Federation region with Dodixie trade hub'),
    (10000030, 'Heimatar', 'Minmatar Republic region with Rens trade hub'),
    (10000042, 'Metropolis', 'Minmatar Republic region with Hek trade hub');

-- Insert major trade hub systems
INSERT INTO systems
    (system_id, system_name, region_id, constellation_id, security_status, security_class)
VALUES
    (30000142, 'Jita', 10000002, 20000020, 0.946, 'highsec'),
    (30002187, 'Amarr', 10000043, 20000020, 0.900, 'highsec'),
    (30002659, 'Dodixie', 10000032, 20000020, 0.900, 'highsec'),
    (30002510, 'Rens', 10000030, 20000020, 0.900, 'highsec'),
    (30002053, 'Hek', 10000042, 20000020, 0.900, 'highsec');

-- Insert major trade hub stations using the stored procedure
EXEC sp_upsert_location 
    @location_id = 60003760,
    @location_name = 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    @location_type = 'station',
    @region_id = 10000002,
    @region_name = 'The Forge',
    @system_id = 30000142,
    @system_name = 'Jita',
    @security_status = 0.946,
    @is_npc = 1;

EXEC sp_upsert_location 
    @location_id = 60008494,
    @location_name = 'Amarr VIII (Oris) - Emperor Family Academy',
    @location_type = 'station',
    @region_id = 10000043,
    @region_name = 'Domain',
    @system_id = 30002187,
    @system_name = 'Amarr',
    @security_status = 0.900,
    @is_npc = 1;

EXEC sp_upsert_location 
    @location_id = 60011866,
    @location_name = 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
    @location_type = 'station',
    @region_id = 10000032,
    @region_name = 'Sinq Laison',
    @system_id = 30002659,
    @system_name = 'Dodixie',
    @security_status = 0.900,
    @is_npc = 1;

EXEC sp_upsert_location 
    @location_id = 60004588,
    @location_name = 'Rens VI - Moon 8 - Brutor Tribe Treasury',
    @location_type = 'station',
    @region_id = 10000030,
    @region_name = 'Heimatar',
    @system_id = 30002510,
    @system_name = 'Rens',
    @security_status = 0.900,
    @is_npc = 1;

EXEC sp_upsert_location 
    @location_id = 60005686,
    @location_name = 'Hek VIII - Moon 12 - Boundless Creation Factory',
    @location_type = 'station',
    @region_id = 10000042,
    @region_name = 'Metropolis',
    @system_id = 30002053,
    @system_name = 'Hek',
    @security_status = 0.900,
    @is_npc = 1;

-- Insert corresponding systems as locations
EXEC sp_upsert_location 
    @location_id = 30000142,
    @location_name = 'Jita',
    @location_type = 'system',
    @region_id = 10000002,
    @region_name = 'The Forge',
    @system_id = 30000142,
    @system_name = 'Jita',
    @security_status = 0.946,
    @is_npc = 1;

EXEC sp_upsert_location 
    @location_id = 30002187,
    @location_name = 'Amarr',
    @location_type = 'system',
    @region_id = 10000043,
    @region_name = 'Domain',
    @system_id = 30002187,
    @system_name = 'Amarr',
    @security_status = 0.900,
    @is_npc = 1;

EXEC sp_upsert_location 
    @location_id = 30002659,
    @location_name = 'Dodixie',
    @location_type = 'system',
    @region_id = 10000032,
    @region_name = 'Sinq Laison',
    @system_id = 30002659,
    @system_name = 'Dodixie',
    @security_status = 0.900,
    @is_npc = 1;

EXEC sp_upsert_location 
    @location_id = 30002510,
    @location_name = 'Rens',
    @location_type = 'system',
    @region_id = 10000030,
    @region_name = 'Heimatar',
    @system_id = 30002510,
    @system_name = 'Rens',
    @security_status = 0.900,
    @is_npc = 1;

EXEC sp_upsert_location 
    @location_id = 30002053,
    @location_name = 'Hek',
    @location_type = 'system',
    @region_id = 10000042,
    @region_name = 'Metropolis',
    @system_id = 30002053,
    @system_name = 'Hek',
    @security_status = 0.900,
    @is_npc = 1;

-- Log the initial seed operation
INSERT INTO esi_update_log
    (update_type, started_at, completed_at, status, records_processed, records_added, duration_seconds)
VALUES
    ('initial_seed', GETDATE(), GETDATE(), 'completed', 10, 10, 0);

-- Verify the data was inserted correctly
SELECT 'Regions inserted:' as info, COUNT(*) as count
FROM regions;
SELECT 'Systems inserted:' as info, COUNT(*) as count
FROM systems;
SELECT 'Locations inserted:' as info, COUNT(*) as count
FROM locations;
SELECT 'Stations:' as info, COUNT(*) as count
FROM v_active_stations
WHERE location_type = 'station';
SELECT 'Systems as locations:' as info, COUNT(*) as count
FROM v_active_stations
WHERE location_type = 'system';

-- Show sample data
SELECT TOP 5
    *
FROM v_region_summary
ORDER BY station_count DESC;
SELECT TOP 5
    *
FROM v_active_stations
WHERE location_type = 'station'
ORDER BY location_name;

PRINT 'Database seeded with initial NPC location data.';
PRINT 'Next steps:';
PRINT '1. Deploy the ESI sync Azure Function to get complete EVE data';
PRINT '2. Deploy the locations API Azure Function to serve this data';
PRINT '3. Update your frontend to use the new database endpoints';
