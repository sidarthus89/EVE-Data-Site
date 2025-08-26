import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import Layout from './layouts/Layout.jsx';
import Home from './pages/Home';
import Privacy from './pages/Privacy';

// Lazy load heavy feature components
const Market = lazy(() => import('./features/Market/Market.jsx'));
const Appraisal = lazy(() => import('./features/Appraisal/Appraisal.jsx'));
const HeatMap = lazy(() => import('./features/HeatMap/HeatMap.jsx'));
const StationTrading = lazy(() => import('./features/TradeTools/StationTrading.jsx'));
const StationHauling = lazy(() => import('./features/TradeTools/StationHauling.jsx'));
const RegionHauling = lazy(() => import('./features/TradeTools/RegionHauling.jsx'));
const Ores = lazy(() => import('./features/Ores/Ores'));
const Minerals = lazy(() => import('./features/Minerals/Minerals.jsx'));
const MarketDistribution = lazy(() => import('./features/Market/MarketDistribution.jsx'));

// Loading component
const PageLoader = () => (
  <div style={{
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '200px',
    fontSize: '16px',
    color: '#666'
  }}>
    Loading...
  </div>
);

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="market" element={
          <Suspense fallback={<PageLoader />}>
            <Market />
          </Suspense>
        } />
        <Route path="appraisal" element={
          <Suspense fallback={<PageLoader />}>
            <Appraisal />
          </Suspense>
        } />
        <Route path="heat-map" element={
          <Suspense fallback={<PageLoader />}>
            <HeatMap />
          </Suspense>
        } />
        <Route path="minerals" element={
          <Suspense fallback={<PageLoader />}>
            <Minerals />
          </Suspense>
        } />
        <Route path="ores" element={
          <Suspense fallback={<PageLoader />}>
            <Ores />
          </Suspense>
        } />
        <Route path="station-trading" element={
          <Suspense fallback={<PageLoader />}>
            <StationTrading />
          </Suspense>
        } />
        <Route path="station-hauling" element={
          <Suspense fallback={<PageLoader />}>
            <StationHauling />
          </Suspense>
        } />
        <Route path="region-hauling" element={
          <Suspense fallback={<PageLoader />}>
            <RegionHauling />
          </Suspense>
        } />
        <Route path="privacy" element={<Privacy />} />
      </Route>
    </Routes>
  );
}

export default App;