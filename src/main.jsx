import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';

// Using BrowserRouter with basename for GitHub Pages
// This allows clean URLs (no #) but requires proper 404.html handling

// Derive basename from Vite's BASE_URL to support both prod and dev GH Pages repos
const rawBase = (import.meta.env.BASE_URL || '/');
const normalizedBase = rawBase.replace(/\/+$/, ''); // strip trailing slash
const basename = (normalizedBase === '' || normalizedBase === '/') ? undefined : normalizedBase;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
