import { Link } from 'react-router-dom';

export default function Home() {
    // Provide a scrollable area sized between fixed nav (48px) and footer (32px)
    // Parent containers have overflow hidden, so we create an internal scroll context here.
    const scrollAreaStyle = {
        overflowY: 'auto',
        height: 'calc(100vh - 48px - 32px)',
        boxSizing: 'border-box',
        paddingRight: '8px'
    };
    return (
        <section className="home" style={scrollAreaStyle}>
                   <div style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            padding: '1rem 1.5rem',
            borderRadius: '8px',
            margin: '1rem',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#fff', fontSize: '1.3rem' }}>🚀 New EVE Data Website Coming Soon!</h2>
            <p style={{ margin: '0', color: '#f0f0f0', lineHeight: '1.6' }}>
                We're building an enhanced version of this site with improved performance, new features, and better data updates.
                Stay tuned for the launch!
            </p>
        </div>
        </section>

    );
}
