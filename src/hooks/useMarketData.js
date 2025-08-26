// useMarketData.js
import { useState, useEffect, useMemo } from 'react';
import { fetchMarketOrders, fetchMarketHistory } from '../utils/market.js';
import { debounce } from '../utils/cache';

// Debounced market data fetching
const debouncedFetchMarketOrders = debounce((typeID, regionRef, callback) => {
    fetchMarketOrders(typeID, regionRef)
        .then(callback)
        .catch(console.error);
}, 300);

export function useMarketOrders(typeID, regionRef) {
    const [orders, setOrders] = useState({ buyOrders: [], sellOrders: [] });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!typeID || !regionRef) return;

        setLoading(true);
        setError(null);

        debouncedFetchMarketOrders(typeID, regionRef, (data) => {
            setOrders(data);
            setLoading(false);
        });
    }, [typeID, regionRef]);

    return { orders, loading, error };
}

export function useMarketHistory(typeID, regionID) {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!typeID || !regionID) return;

        setLoading(true);
        setError(null);

        fetchMarketHistory(regionID, typeID)
            .then(data => {
                setHistory(data);
                setLoading(false);
            })
            .catch(err => {
                setError(err);
                setLoading(false);
            });
    }, [typeID, regionID]);

    // Memoize processed data
    const processedHistory = useMemo(() => {
        return history.map(item => ({
            ...item,
            date: new Date(item.date).getTime(),
        }));
    }, [history]);

    return { history: processedHistory, loading, error };
}

export function useLocations() {
    const [locations, setLocations] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetch('/data/regions.json')
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                setLocations(data);
                setLoading(false);
            })
            .catch(err => {
                setError(err);
                setLoading(false);
            });
    }, []);

    return { locations, loading, error };
}
