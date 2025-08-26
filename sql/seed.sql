-- Insert test regions
INSERT INTO regions (region_id, region_name) VALUES
    (10000002, 'The Forge'),
    (10000043, 'Domain');

-- Insert test stations
INSERT INTO stations (station_id, station_name, region_id) VALUES
    (60003760, 'Jita IV - Moon 4 - Caldari Navy Assembly Plant', 10000002),
    (60008494, 'Amarr VIII (Oris) - Emperor Family Academy', 10000043);

-- Insert example order (Jita)
INSERT INTO orders (
    order_id, type_id, region_id, station_id, price,
    volume_remain, volume_total, is_buy_order, duration
) VALUES (
    123456789, 34, 10000002, 60003760, 5.50,
    100000, 100000, 0, 90
);

-- Insert example price history
INSERT INTO price_history (
    region_id, type_id, date, average, highest, lowest, order_count, volume
) VALUES (
    10000002, 34, '2025-08-01', 5.25, 5.60, 5.10, 250, 1000000
);

-- Insert example aggregated order
INSERT INTO aggregated_orders (
    region_id, type_id, buy_price, sell_price, volume_buy, volume_sell
) VALUES (
    10000002, 34, 5.10, 5.55, 200000, 150000
);
