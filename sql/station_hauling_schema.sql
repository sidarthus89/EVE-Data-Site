SELECT TOP 50
    sell.type_id,
    sell.location_id AS origin_id,
    buy.location_id AS destination_id,
    sell.price AS sell_price,
    buy.price AS buy_price,
    (buy.price - sell.price) AS profit_per_unit,
    ((buy.price - sell.price) / sell.price * 100) AS profit_margin,
    CASE 
        WHEN sell.volume_remain < buy.volume_remain THEN sell.volume_remain
        ELSE buy.volume_remain
    END AS max_volume
FROM market_orders_live sell
    JOIN market_orders_live buy ON sell.type_id = buy.type_id
WHERE sell.is_buy_order = 0
    AND buy.is_buy_order = 1
    AND sell.location_id = @origin_id
    AND buy.location_id = @destination_id
    AND buy.price > sell.price
    AND sell.volume_remain > 0
    AND buy.volume_remain > 0
ORDER BY profit_margin DESC
