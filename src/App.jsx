import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import Layout from './layouts/Layout.jsx';
import Home from './pages/Home';
import Privacy from './pages/Privacy';

// Lazy load heavy feature components
const Market = lazy(() => import('./features/Market/Market.jsx'));
const Appraisal = lazy(() => import('./features/Appraisal/Appraisal.jsx'));
const RegionHauling = lazy(() => import('./features/TradeTools/RegionHauling.jsx'));

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