// src/layouts/Layout.jsx
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import './Layout.css';

const GA_ID = 'G-DGNCY3H8X5';
const GA_SCRIPT_SRC = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;

function loadGAScriptsOnce() {
    // Avoid injecting twice
    if (typeof window === 'undefined') return;
    if (window.gtag) return; // already initialized

    // Avoid duplicate script tag
    if (!document.querySelector(`script[src="${GA_SCRIPT_SRC}"]`)) {
        const script1 = document.createElement('script');
        script1.async = true;
        script1.src = GA_SCRIPT_SRC;
        document.head.appendChild(script1);
    }

    if (!document.querySelector(`script[data-gtag-config="${GA_ID}"]`)) {
        const script2 = document.createElement('script');
        script2.setAttribute('data-gtag-config', GA_ID);
        script2.innerHTML = `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = window.gtag || gtag;
            gtag('js', new Date());
            gtag('config', '${GA_ID}', { send_page_view: false });
        `;
        document.head.appendChild(script2);
    }
}

function sendPageView(pathname, search = '') {
    if (typeof window === 'undefined') return;
    if (!window.gtag) return;
    try {
        window.gtag('event', 'page_view', {
            page_path: pathname + search,
            page_location: window.location.href,
            page_title: document.title,
        });
    } catch (e) {
        // swallow errors in case gtag isn't ready yet
        // caller may retry on next navigation
        // console.warn('gtag page_view failed', e);
    }
}

export default function Layout() {
    const [cookieConsent, setCookieConsent] = useState(null);
    const location = useLocation();

    useEffect(() => {
        // Inject favicon into <head>
        const favicon = document.createElement('link');
        favicon.rel = 'icon';
        favicon.type = 'image/svg+xml';
        favicon.href = '/favicon.svg';
        document.head.appendChild(favicon);

        const stored = localStorage.getItem('cookieConsent');
        if (stored !== null) {
            setCookieConsent(stored === 'true');
        }

        return () => {
            try {
                if (favicon && document.head.contains(favicon)) {
                    document.head.removeChild(favicon);
                }
            } catch (e) { /* ignore */ }
        };
    }, []);

    useEffect(() => {
        if (cookieConsent === true) {
            loadGAScriptsOnce();
            sendPageView(location.pathname, location.search);
        }
    }, [cookieConsent]);

    useEffect(() => {
        if (cookieConsent === true) {
            sendPageView(location.pathname, location.search);
        }
    }, [location, cookieConsent]);

    function handleConsent(choice) {
        localStorage.setItem('cookieConsent', String(choice));
        setCookieConsent(choice);
    }

    return (
        <>
            <nav className="global-nav" role="navigation">
                <div className="nav-left">
                    <Link to="/" className="eve-button" data-page="index">
                        <img
                            src="favicon.svg"
                            className="nav-icon"
                            loading="lazy"
                            width="22"
                            height="22"
                            alt="Logo"
                        />
                        EVE Data Site
                    </Link>
                </div>

                <div className="nav-links">
                    {/* 🔽 Market Dropdown */}
                    <div className="nav-dropdown">
                        <span className="eve-button">Market Tools▾</span>
                        <div className="nav-dropdown-menu">
                            <Link to="/market" className="eve-button">Full Market</Link>
                            {/* <Link to="/appraisal" className="eve-button">Appraisal</Link>*/}
                            {/* <div className="nav-subdropdown">
                                <span className="eve-button">Resource Pricing ▸</span>
                                <div className="nav-submenu">
                                    <Link to="/ores" className="eve-button">Ores</Link>
                                    <Link to="/minerals" className="eve-button">Minerals</Link>
                                </div>
                            </div>*/}
                        </div>
                    </div>
                    <div className="nav-dropdown">
                        <span className="eve-button">Trade Tools▾</span>
                        <div className="nav-dropdown-menu">
                            {/*<Link to="/station-trading" className="eve-button">Station Trading</Link>
                            <Link to="/station-hauling" className="eve-button">Station to Station</Link>*/}
                            <Link to="/region-hauling" className="eve-button">Region to Region</Link>
                        </div>
                    </div>

                    {/* 💬 Support Dropdown */}
                    <div className="nav-dropdown">
                        <span className="eve-button">Support ▾</span>
                        <div className="nav-dropdown-menu">
                            <a
                                href="https://github.com/sidarthus89/EVE-Data-Site/issues/new/choose"
                                target="_blank"
                                rel="noreferrer"
                                className="eve-button"
                            >
                                Report Issue
                            </a>
                            <a
                                href="https://paypal.me/pologoalie8908"
                                target="_blank"
                                rel="noreferrer"
                                className="eve-button"
                            >
                                Donate
                            </a>
                        </div>
                    </div>
                </div>
            </nav>

            <div className="layout-wrapper">
                <main className="layout-content">
                    <Outlet />
                </main>

                <footer className="global-footer">
                    <div className="footer-content">
                        <p>&copy; 2025 EVE Data Site. Not affiliated with CCP Games</p>
                    </div>
                </footer>

                {cookieConsent === null && (
                    <>
                        {/* 🔲 Dim overlay */}
                        <div className="cookie-backdrop" />

                        {/* 🍪 Modal-style cookie consent */}
                        <div id="cookieConsent" className="cookie-popup-modal">
                            <p>
                                We use cookies to improve your experience. By using this site, you accept our use of cookies.{' '}
                                <Link to="/privacy">Learn more</Link>
                            </p>
                            <div className="cookie-actions">
                                <button onClick={() => handleConsent(true)}>Accept</button>
                                <button onClick={() => handleConsent(false)}>Reject</button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </>
    );
}
