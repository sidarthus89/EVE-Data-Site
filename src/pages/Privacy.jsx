// src/pages/Privacy.jsx
import './Privacy.css';
export default function Privacy() {
    return (
        <section className="privacy">
            <h1>Privacy Policy</h1>
            <p>
                Your privacy is important to us. This EVE Data Site is committed to handling your data responsibly and transparently.
                This page explains how we use cookies and what data we store in your browser.
            </p>

            <h2>Cookies & Local Storage</h2>
            <p>
                We use cookies and browser local storage to enhance your experience. Specifically, we store:
            </p>
            <ul>
                <li><strong>Cached Site State:</strong> For faster loading and smoother browsing by storing UI preferences and temporary data.</li>
                <li><strong>Quickbar Items:</strong> Your pinned or favorited items are saved locally in your browser.</li>
            </ul>

            <h2>What We Do <em>Not</em> Do</h2>
            <ul>
                <li>No tracking cookies.</li>
                <li>No personal information is collected or stored.</li>
                <li>No analytics, advertising, or third-party cookies.</li>
            </ul>

            <h2>GDPR Compliance (EU Users)</h2>
            <p>
                Under the General Data Protection Regulation (GDPR), we do not collect or process any personal data that would require consent or data subject rights enforcement.
                However, because we use local storage, EU users are informed of this usage upon visiting the site.
            </p>
            <p>
                You may clear local data at any time via your browser settings. Since we store no personally identifiable information (PII), no further action is required to comply with GDPR's data access or deletion rights.
            </p>

            <h2>US-Based Disclosures (CCPA / CPRA)</h2>
            <p>
                We do not sell or share user data. All data stored is strictly local to your browser. No personal data is collected, used, or sold, in accordance with California Consumer Privacy Act (CCPA) and California Privacy Rights Act (CPRA).
            </p>
            <p>
                Since no personal data is collected, no "Do Not Sell My Info" mechanism is required.
            </p>

            <h2>Controlling or Deleting Cookies</h2>
            <p>
                You can manage or delete cookies and local storage through your browser settings. This will reset your cached site state and quickbar.
            </p>

            <h2>Changes</h2>
            <p>
                This policy may be updated if the site’s use of cookies or local storage changes. Please check back periodically.
            </p>

            <h2>Contact</h2>
            <p>
                If you have questions or concerns about this policy or your data, please{' '}
                <a
                    href="https://github.com/sidarthus89/EVE-Data-Site/issues/new/choose"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    contact the site maintainer via a GitHub issue
                </a>.
            </p>
        </section>
    );
}
