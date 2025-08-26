// src/components/EVEAuth.jsx
// EVE Online SSO Authentication Component

import { useState, useEffect } from 'react';
import {
    getLoginUrl,
    handleAuthCallback,
    loadStoredTokens,
    isAuthenticated,
    getCharacterInfo,
    clearTokens,
    verifyScopes
} from '../utils/esiAuth.js';
import './EVEAuth.css';

export default function EVEAuth() {
    const [authStatus, setAuthStatus] = useState('checking'); // checking, logged_out, logged_in, error
    const [characterInfo, setCharacterInfo] = useState(null);
    const [hasRequiredScopes, setHasRequiredScopes] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        initializeAuth();
    }, []);

    async function initializeAuth() {
        try {
            // Check if we have stored tokens
            const hasTokens = loadStoredTokens();

            if (hasTokens && isAuthenticated()) {
                // Get character info and verify scopes
                const charInfo = await getCharacterInfo();
                const scopesValid = await verifyScopes();

                setCharacterInfo(charInfo);
                setHasRequiredScopes(scopesValid);
                setAuthStatus('logged_in');
            } else {
                setAuthStatus('logged_out');
            }
        } catch (error) {
            console.error('Auth initialization failed:', error);
            setErrorMessage(error.message);
            setAuthStatus('error');
        }
    }

    // Handle OAuth callback when user returns from EVE SSO
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const error = urlParams.get('error');

        if (error) {
            setErrorMessage(`EVE SSO Error: ${error}`);
            setAuthStatus('error');
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
        }

        if (code && state) {
            handleAuthCallback(code, state)
                .then(() => {
                    initializeAuth();
                    // Clean up URL
                    window.history.replaceState({}, document.title, window.location.pathname);
                })
                .catch(error => {
                    setErrorMessage(error.message);
                    setAuthStatus('error');
                    // Clean up URL
                    window.history.replaceState({}, document.title, window.location.pathname);
                });
        }
    }, []);

    function handleLogin() {
        const loginUrl = getLoginUrl();
        window.location.href = loginUrl;
    }

    function handleLogout() {
        clearTokens();
        setCharacterInfo(null);
        setHasRequiredScopes(false);
        setAuthStatus('logged_out');
    }

    if (authStatus === 'checking') {
        return (
            <div className="eve-auth eve-auth--loading">
                <div className="eve-auth__spinner">🔄</div>
                <span>Checking EVE authentication...</span>
            </div>
        );
    }

    if (authStatus === 'error') {
        return (
            <div className="eve-auth eve-auth--error">
                <div className="eve-auth__error">
                    <span className="eve-auth__error-icon">⚠️</span>
                    <div>
                        <strong>Authentication Error</strong>
                        <br />
                        {errorMessage}
                    </div>
                    <button
                        onClick={() => {
                            setErrorMessage('');
                            setAuthStatus('logged_out');
                        }}
                        className="eve-auth__retry-btn"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    if (authStatus === 'logged_out') {
        return (
            <div className="eve-auth eve-auth--logged-out">
                <div className="eve-auth__login-prompt">
                    <div className="eve-auth__icon">🚀</div>
                    <h3>Enhanced Market Data Access</h3>
                    <p>
                        Log in with your EVE Online account to access player structure
                        information and enhanced market data.
                    </p>
                    <ul className="eve-auth__benefits">
                        <li>✅ Access to player structure market orders</li>
                        <li>✅ Complete station and structure names</li>
                        <li>✅ Enhanced location resolution</li>
                        <li>✅ More accurate market data</li>
                    </ul>
                    <button
                        onClick={handleLogin}
                        className="eve-auth__login-btn"
                    >
                        <img
                            src="https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-black-small.png"
                            alt="LOG IN with EVE Online"
                        />
                    </button>
                    <p className="eve-auth__note">
                        We only request read-only permissions for market and structure data.
                        Your account security is never compromised.
                    </p>
                </div>
            </div>
        );
    }

    if (authStatus === 'logged_in') {
        return (
            <div className="eve-auth eve-auth--logged-in">
                <div className="eve-auth__character-info">
                    <div className="eve-auth__character">
                        <img
                            src={`https://images.evetech.net/characters/${characterInfo.CharacterID}/portrait?size=64`}
                            alt={characterInfo.CharacterName}
                            className="eve-auth__portrait"
                        />
                        <div className="eve-auth__details">
                            <strong>{characterInfo.CharacterName}</strong>
                            <br />
                            <span className="eve-auth__status">
                                {hasRequiredScopes ? (
                                    <span className="eve-auth__status--success">
                                        ✅ Enhanced access enabled
                                    </span>
                                ) : (
                                    <span className="eve-auth__status--warning">
                                        ⚠️ Limited scopes - some features may be restricted
                                    </span>
                                )}
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="eve-auth__logout-btn"
                        title="Logout"
                    >
                        🚪
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
